"""Orchestration manager.

Responsibilities:
* Queue analysis and approval jobs in the durable PostgreSQL job table.
* Run background workers (in every API process) that claim jobs, stream events
  from ai-services, persist each event, and broadcast it to WebSockets.
* Keep runs moving: transient failures are retried with backoff, permanent
  ones fail fast with a clear message, crashed workers' jobs are recovered via
  lease expiry, and projects left "running" with no job are resumed.
"""
from __future__ import annotations

import asyncio
import json
import os
import socket
from typing import Any, AsyncIterator

import httpx

from app.core.config import settings
from app.core.logging import get_logger
from app.services.event_bus import event_bus
from app.services import projects as project_service
from app.services import orchestration_store
from app.services.ai_client import ai_services

logger = get_logger("orchestrator")

_POLL_SECONDS = 2.0
_RECONCILE_SECONDS = 60.0
_HEARTBEAT_SECONDS = max(5.0, settings.job_lease_seconds / 4)
_CANCEL_POLL_SECONDS = 3.0

_workers: list[asyncio.Task] = []
_shutdown = asyncio.Event()
_wake = asyncio.Event()


class RunError(Exception):
    """A run attempt failed; ``retryable`` decides between backoff and failing.

    ``outage`` marks failures to reach ai-services at all (deploy, crash): those
    say nothing about the run, so they wait without spending its attempts.
    """

    def __init__(self, message: str, *, retryable: bool, outage: bool = False) -> None:
        super().__init__(message)
        self.retryable = retryable
        self.outage = outage


async def enqueue_analysis(
    project_id: str, target_agents: list[str] | None = None, *, resume: bool = False
) -> tuple[int | None, bool]:
    """Queue a workflow run. Runs always continue from the project's last
    checkpoint; ``resume`` only records that this was a retry/recovery."""
    request = {"kind": "run", "resume": resume, "target_agents": target_agents or []}
    job = await orchestration_store.submit(project_id, request)
    _wake.set()
    logger.info("Queued %s job for project %s (job=%s, new=%s)",
                "resume" if resume else "run", project_id, *job)
    return job


async def enqueue_approval(
    project_id: str, phase: str, approved: bool, feedback: str
) -> tuple[int | None, bool]:
    request = {"kind": "approval", "phase": phase, "approved": approved, "feedback": feedback}
    job = await orchestration_store.submit(project_id, request)
    _wake.set()
    logger.info("Queued approval job for project %s phase %s (job=%s, new=%s)",
                project_id, phase, *job)
    return job


def _classify(exc: BaseException) -> RunError:
    if isinstance(exc, RunError):
        return exc
    if isinstance(exc, httpx.HTTPStatusError):
        code = exc.response.status_code
        retryable = code >= 500 or code in (408, 409, 425, 429)
        return RunError(f"AI service returned HTTP {code}", retryable=retryable)
    if isinstance(exc, (httpx.ConnectError, httpx.ConnectTimeout)) or (
        isinstance(exc, OSError) and not isinstance(exc, TimeoutError)
    ):
        return RunError(f"AI service unreachable: {str(exc) or type(exc).__name__}",
                        retryable=True, outage=True)
    if isinstance(exc, (httpx.TransportError, asyncio.TimeoutError, ConnectionError)):
        return RunError(f"AI service connection lost: {str(exc) or type(exc).__name__}", retryable=True)
    # Unknown errors (DB blips, bugs) get the bounded retry budget rather than
    # stranding the run; a deterministic bug simply exhausts it and fails.
    return RunError(f"{type(exc).__name__}: {exc}", retryable=True)


async def _with_idle_timeout(
    stream: AsyncIterator[dict[str, Any]], seconds: float
) -> AsyncIterator[dict[str, Any]]:
    iterator = stream.__aiter__()
    while True:
        try:
            event = await asyncio.wait_for(iterator.__anext__(), timeout=seconds)
        except StopAsyncIteration:
            return
        except asyncio.TimeoutError:
            raise RunError(f"AI service sent nothing for {int(seconds)}s", retryable=True)
        yield event


async def _consume(job_id: int, project_id: str, stream: AsyncIterator[dict[str, Any]]) -> None:
    """Persist and broadcast every event until the run reaches a terminal state."""
    async for event in _with_idle_timeout(stream, settings.stream_idle_timeout_seconds):
        if _shutdown.is_set():
            raise asyncio.CancelledError
        etype = event.get("type")
        if etype == "heartbeat":  # keep-alive while an agent is mid-LLM-call
            continue

        if etype in ("error", "run_failed"):
            # Raised before persisting so a retry that later succeeds does not
            # leave a stale error event in the replay log.
            raise RunError(
                str(event.get("message") or "Unknown AI error"),
                retryable=bool(event.get("retryable", False)),
            )

        await event_bus.publish(project_id, event)
        await orchestration_store.append_event(job_id, project_id, event)
        await project_service.apply_event(project_id, event)

        if etype == "paused_for_approval":
            await project_service.set_status(project_id, "awaiting_approval", error=None)
            await orchestration_store.finish(job_id, "complete")
            logger.info("Run %s paused for approval (%s)", project_id, event.get("pending_approval"))
            return
        if etype == "run_complete":
            await project_service.set_status(project_id, "complete", progress=100, error=None)
            await orchestration_store.finish(job_id, "complete")
            logger.info("Run %s complete", project_id)
            return

    # A stream that ends without a terminal event was cut off mid-run.
    raise RunError("AI stream ended before the run finished", retryable=True)


async def _run_job(job_id: int, project_id: str, request: dict[str, Any]) -> None:
    if request.get("kind") == "approval":
        stream = ai_services.approve_workflow(
            project_id, str(request.get("phase", "")),
            bool(request.get("approved")), str(request.get("feedback", "")),
            decision_id=str(job_id),
        )
    else:
        try:
            idea, title = await _project_inputs(project_id)
        except LookupError as exc:
            raise RunError(str(exc), retryable=False)
        # Always resume: a new project has no checkpoint and starts fresh, while
        # a retried or recovered run continues from where it stopped.
        stream = ai_services.stream_workflow(project_id, idea, title, resume=True)
    await project_service.set_status(project_id, "running", error=None)
    kickoff_log = {
        "type": "log",
        "agent": "ceo",
        "level": "info",
        "message": f"Orchestrating specialist pipeline for: {title or 'Project'}",
        "ts": datetime.now(timezone.utc).isoformat(),
    }
    await event_bus.publish(project_id, kickoff_log)
    await orchestration_store.append_event(job_id, project_id, kickoff_log)
    await project_service.apply_event(project_id, kickoff_log)
    await asyncio.wait_for(_consume(job_id, project_id, stream), timeout=settings.run_timeout_seconds)


async def _handle_failure(
    job_id: int, project_id: str, attempt: int, err: RunError, age: float = 0.0
) -> None:
    message = str(err)[:1000]
    if err.outage and age < settings.run_timeout_seconds:
        logger.warning("Run %s: %s; waiting for ai-services", project_id, message)
        await orchestration_store.requeue(job_id, 30, message, refund_attempt=True)
        await project_service.set_status(
            project_id, "queued", error=f"{message} — waiting for it to come back",
        )
        return
    if err.retryable and attempt < settings.job_max_attempts:
        delay = min(120, 10 * 2 ** (attempt - 1))
        logger.warning("Run %s attempt %d failed (retrying in %ds): %s",
                       project_id, attempt, delay, message)
        await orchestration_store.requeue(job_id, delay, message)
        await project_service.set_status(
            project_id, "queued",
            error=f"{message} — retrying automatically in {delay}s "
                  f"(attempt {attempt + 1} of {settings.job_max_attempts})",
        )
        return
    logger.error("Run %s failed after %d attempt(s): %s", project_id, attempt, message)
    await orchestration_store.finish(job_id, "failed", error=message)
    await project_service.settle_active_nodes(project_id, "failed")
    await project_service.set_status(project_id, "failed", error=message)


async def _heartbeat(job_id: int, worker_id: str, owner: asyncio.Task) -> None:
    """Renew the lease, and abandon the run promptly if it was stopped or taken over."""
    loop = asyncio.get_running_loop()
    renewed = loop.time()
    while True:
        await asyncio.sleep(_CANCEL_POLL_SECONDS)
        try:
            if loop.time() - renewed >= _HEARTBEAT_SECONDS:
                alive = await orchestration_store.heartbeat(job_id, worker_id)
                renewed = loop.time()
            else:
                alive = await orchestration_store.is_running(job_id, worker_id)
            if not alive:
                logger.warning("Job %d was stopped or reassigned; abandoning it", job_id)
                owner.cancel()
                return
        except Exception as exc:  # DB blip: keep trying until the lease would lapse
            logger.warning("Heartbeat for job %d failed: %s", job_id, exc)


async def _process(worker_id: str, job_id: int, project_id: str,
                   request: dict[str, Any], attempt: int, age: float) -> None:
    if attempt > settings.job_max_attempts:
        await _handle_failure(job_id, project_id, attempt, RunError(
            "Run kept getting interrupted (worker restarts); giving up", retryable=False))
        return
    run = asyncio.create_task(_run_job(job_id, project_id, request))
    beat = asyncio.create_task(_heartbeat(job_id, worker_id, run))
    try:
        await run
    except asyncio.CancelledError:
        if _shutdown.is_set():
            # Hand the job straight back instead of waiting for the lease to lapse.
            await asyncio.shield(orchestration_store.requeue(
                job_id, 0, "Interrupted by shutdown", refund_attempt=True))
            raise
        logger.warning("Job %d for %s was stopped or taken over", job_id, project_id)
    except Exception as exc:
        await _handle_failure(job_id, project_id, attempt, _classify(exc), age)
    finally:
        beat.cancel()


async def _project_inputs(project_id: str) -> tuple[str, str | None]:
    doc = await project_service.get_project(project_id)
    if not doc:
        raise LookupError(f"project {project_id} not found")
    inputs = doc.get("manager_inputs") or {}
    enriched = doc["idea"]
    if inputs:
        enriched += "\n\nMANAGER-PROVIDED DELIVERY CONSTRAINTS (authoritative):\n" + json.dumps(inputs)
    return enriched, doc.get("title")


async def _worker(worker_id: str) -> None:
    logger.info("Orchestrator worker %s online", worker_id)
    while not _shutdown.is_set():
        try:
            claimed = await orchestration_store.claim(worker_id, settings.job_lease_seconds)
            if claimed is None:
                _wake.clear()
                try:
                    await asyncio.wait_for(_wake.wait(), timeout=_POLL_SECONDS)
                except asyncio.TimeoutError:
                    pass
                continue
            job_id, project_id, request, attempt, age = claimed
            logger.info("Worker %s claimed job %d (%s, attempt %d) for %s",
                        worker_id, job_id, request.get("kind", "run"), attempt, project_id)
            await _process(worker_id, job_id, project_id, request, attempt, age)
        except asyncio.CancelledError:
            break
        except Exception:
            logger.exception("Worker %s error; continuing", worker_id)
            await asyncio.sleep(5)
    logger.info("Orchestrator worker %s stopped", worker_id)


async def _reconciler() -> None:
    """Recover projects stranded as queued/running with no job behind them.

    Recently stalled runs are resumed automatically. Long-abandoned ones are
    marked failed instead, so a restart never silently spends LLM quota
    re-running old projects; the user can still resume them with Retry.
    """
    while not _shutdown.is_set():
        try:
            stale_after = settings.job_lease_seconds * 2
            for project_id, idle in await orchestration_store.orphaned_projects(stale_after):
                if idle <= settings.auto_resume_window_seconds:
                    logger.warning("Project %s was stranded without a job; resuming it", project_id)
                    await enqueue_analysis(project_id, resume=True)
                else:
                    logger.warning("Project %s was stranded %.0fh ago; marking it failed",
                                   project_id, idle / 3600)
                    await project_service.set_status(
                        project_id, "failed",
                        error="Run was interrupted. Click Retry to resume from where it stopped.",
                    )
        except asyncio.CancelledError:
            break
        except Exception as exc:
            logger.warning("Reconciler pass failed: %s", exc)
        try:
            await asyncio.wait_for(_shutdown.wait(), timeout=_RECONCILE_SECONDS)
        except asyncio.TimeoutError:
            pass


def start_workers() -> None:
    _shutdown.clear()
    prefix = f"{socket.gethostname()}:{os.getpid()}"
    for i in range(max(1, settings.worker_count)):
        _workers.append(asyncio.create_task(_worker(f"{prefix}:{i + 1}")))
    _workers.append(asyncio.create_task(_reconciler()))


async def stop_workers() -> None:
    _shutdown.set()
    _wake.set()
    for task in _workers:
        task.cancel()
    for task in _workers:
        try:
            await task
        except (asyncio.CancelledError, Exception):
            pass
    _workers.clear()


async def stop_run(project_id: str, new_status: str = "stopped") -> bool:
    """Stop or pause a queued or running workflow. Finished agents' work is kept, and
    Run resumes from the checkpoint. Returns False if nothing was running."""
    cancelled = await orchestration_store.cancel_active(project_id, f"{new_status.capitalize()} by user")
    doc = await project_service.get_project(project_id, "system")
    curr_status = doc.get("status") if doc else None
    if not cancelled and curr_status not in ("running", "queued"):
        return False
    await project_service.settle_active_nodes(project_id, "idle")
    await project_service.set_status(project_id, new_status, error=None)
    logger.info("Run %s %s (cancelled_jobs=%d)", project_id, new_status, cancelled)
    return True
