"""Orchestration manager.

Responsibilities:
* Enqueue analysis jobs into the in-memory job queue.
* Run background worker(s) that pop jobs and drive the workflow.
* Stream events directly from ai-services over HTTP, persist every event to
  PostgreSQL / Supabase, buffer events in the in-memory event bus, and broadcast
  them to connected WebSockets.
"""
from __future__ import annotations

import asyncio
import json
from typing import Any

from app.core.config import settings
from app.core.logging import get_logger
from app.services.event_bus import event_bus
from app.services import projects as project_service
from app.services import orchestration_store
from app.services.ai_client import ai_services

logger = get_logger("orchestrator")

_workers: list[asyncio.Task] = []
_shutdown = asyncio.Event()


async def enqueue_analysis(project_id: str) -> None:
    await event_bus.enqueue_job(project_id)
    logger.info("Enqueued analysis job for project %s", project_id)


async def enqueue_approval(project_id: str, phase: str, approved: bool, feedback: str) -> None:
    """Start an approval stream consumption task immediately."""
    logger.info("Starting approval task for project %s (phase: %s)", project_id, phase)
    task = asyncio.create_task(_consume_approval(project_id, phase, approved, feedback))
    _workers.append(task)
    task.add_done_callback(_workers.remove)


async def _consume_run(project_id: str) -> None:
    """Stream events from ai-services, buffer in memory, and persist to database."""
    deadline = asyncio.get_event_loop().time() + settings.run_timeout_seconds
    attempt = 0
    inputs_ready = False
    idea, title = "", None

    while not _shutdown.is_set():
        try:
            idea, title = await _project_inputs(project_id)
            inputs_ready = True
            break
        except Exception as exc:
            logger.error("Failed to load project inputs for %s: %s", project_id, exc)
            await project_service.set_status(project_id, "failed", error=f"Project inputs error: {exc}")
            return

    if not inputs_ready:
        return

    # Create a durable job row so the WebSocket stream can replay events
    job_id = await orchestration_store.enqueue(project_id)
    if job_id is None:
        logger.error("Failed to create orchestration job for %s", project_id)
        await project_service.set_status(project_id, "failed", error="Failed to create orchestration job")
        return
    logger.info("Created orchestration job %d for project %s", job_id, project_id)

    while not _shutdown.is_set():
        try:
            attempt += 1
            logger.info("Connecting to AI service stream for project %s (attempt %d)", project_id, attempt)
            async for event in ai_services.stream_workflow(project_id, idea, title):
                if _shutdown.is_set():
                    break

                # Broadcast to WebSockets & buffer in memory
                await event_bus.publish(project_id, event)

                # Persist event to the orchestration_events table for replay
                await orchestration_store.append_event(job_id, project_id, event)

                # Persist to Supabase / PostgreSQL
                await project_service.apply_event(project_id, event)

                if event.get("type") == "paused_for_approval":
                    logger.info("Run %s paused for approval", project_id)
                    await project_service.set_status(project_id, "awaiting_approval")
                    await orchestration_store.finish(job_id, "complete")
                    return
                if event.get("type") == "run_complete":
                    await project_service.set_status(project_id, "complete", progress=100)
                    await orchestration_store.finish(job_id, "complete")
                    logger.info("Run %s complete", project_id)
                    return
                if event.get("type") == "run_failed" or event.get("type") == "error":
                    missing = event.get("message", "Unknown error")
                    await project_service.set_status(
                        project_id, "failed", error=f"Incomplete AI output: {missing}"
                    )
                    await orchestration_store.finish(job_id, "failed", error=missing)
                    logger.error("Run %s failed: %s", project_id, missing)
                    return

            # If stream finished cleanly without explicit run_complete / run_failed
            doc = await project_service.get_project(project_id)
            if doc and doc.get("status") == "running":
                await project_service.set_status(project_id, "complete", progress=100)
            await orchestration_store.finish(job_id, "complete")
            return

        except Exception as exc:
            if asyncio.get_event_loop().time() >= deadline:
                logger.error("AI service recovery deadline exceeded for %s: %s", project_id, exc)
                await project_service.set_status(project_id, "failed", error="AI service recovery deadline exceeded")
                await orchestration_store.finish(job_id, "failed", error="AI service recovery deadline exceeded")
                return

            delay = min(15.0, 2 ** min(attempt, 4))
            logger.warning(
                "AI service stream error for %s (attempt %d); retrying in %.0fs: %s",
                project_id,
                attempt,
                delay,
                exc,
            )
            await project_service.set_status(
                project_id, "queued", error=f"AI service reconnecting (attempt {attempt})"
            )
            await asyncio.sleep(delay)


async def _consume_approval(project_id: str, phase: str, approved: bool, feedback: str) -> None:
    """Stream events from ai-services after an approval, buffer in memory, and persist to database."""
    # Create or reuse a job row for the approval phase
    job_id = await orchestration_store.enqueue(project_id)
    if job_id is None:
        logger.error("Failed to create orchestration job for approval on %s", project_id)
        await project_service.set_status(project_id, "failed", error="Failed to create orchestration job")
        return

    try:
        async for event in ai_services.approve_workflow(project_id, phase, approved, feedback):
            if _shutdown.is_set():
                break

            await event_bus.publish(project_id, event)
            await orchestration_store.append_event(job_id, project_id, event)
            await project_service.apply_event(project_id, event)

            if event.get("type") == "run_complete":
                await project_service.set_status(project_id, "complete", progress=100)
                await orchestration_store.finish(job_id, "complete")
                logger.info("Run %s complete", project_id)
                return
            if event.get("type") == "paused_for_approval":
                logger.info("Run %s paused for approval again", project_id)
                await project_service.set_status(project_id, "awaiting_approval")
                await orchestration_store.finish(job_id, "complete")
                return
            if event.get("type") == "run_failed" or event.get("type") == "error":
                error_msg = event.get("message", "Unknown error")
                await project_service.set_status(project_id, "failed", error=error_msg)
                await orchestration_store.finish(job_id, "failed", error=error_msg)
                return
                
        # If stream finishes
        doc = await project_service.get_project(project_id)
        if doc and doc.get("status") == "running":
            await project_service.set_status(project_id, "complete", progress=100)
        await orchestration_store.finish(job_id, "complete")
    except Exception as exc:
        logger.error("Approval stream error for %s: %s", project_id, exc)
        await project_service.set_status(project_id, "failed", error=f"Approval stream error: {exc}")
        await orchestration_store.finish(job_id, "failed", error=str(exc))


async def _project_inputs(project_id: str) -> tuple[str, str | None]:
    doc = await project_service.get_project(project_id)
    if not doc:
        raise RuntimeError(f"project {project_id} not found")
    inputs = doc.get("manager_inputs") or {}
    enriched = doc["idea"]
    if inputs:
        enriched += "\n\nMANAGER-PROVIDED DELIVERY CONSTRAINTS (authoritative):\n" + json.dumps(inputs)
    return enriched, doc.get("title")


async def _worker(worker_id: int) -> None:
    logger.info("Orchestrator worker %d online", worker_id)
    while not _shutdown.is_set():
        try:
            project_id = await event_bus.dequeue_job(timeout=2.0)
            if project_id is None:
                continue
            logger.info("Worker %d picked up project %s", worker_id, project_id)
            await project_service.set_status(project_id, "running", progress=0)
            await _consume_run(project_id)
            event_bus.mark_job_done()
        except asyncio.CancelledError:
            break
        except Exception:
            logger.exception("Worker %d encountered an error", worker_id)
            await asyncio.sleep(1)
    logger.info("Orchestrator worker %d stopped", worker_id)


def start_workers() -> None:
    _shutdown.clear()
    for i in range(max(1, settings.worker_count)):
        _workers.append(asyncio.create_task(_worker(i + 1)))


async def stop_workers() -> None:
    _shutdown.set()
    for task in _workers:
        task.cancel()
    for task in _workers:
        try:
            await task
        except (asyncio.CancelledError, Exception):
            pass
    _workers.clear()