"""WebSocket streaming of orchestration events to the browser.

On connect the client receives a full snapshot, then durable events for the
current PostgreSQL-backed job. Polling the append-only event table makes the
stream work across multiple API replicas without process-local pub/sub state.
"""
from __future__ import annotations

import asyncio

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.core.auth import websocket_user
from app.core.logging import get_logger
from app.services import projects as project_service
from app.services import orchestration_store

logger = get_logger("api.stream")
router = APIRouter()


@router.websocket("/projects/{project_id}/stream")
async def stream(websocket: WebSocket, project_id: str) -> None:
    try:
        user = await websocket_user(websocket)
    except Exception:
        await websocket.close(code=4401, reason="Authentication required")
        return
    await websocket.accept()

    doc = await project_service.get_project(project_id, user.id)
    if not doc:
        await websocket.send_json({"type": "error", "message": "project not found"})
        await websocket.close(code=4404)
        return

    # 1. Full snapshot so the client can render immediately.
    await websocket.send_json({"type": "snapshot", "project": doc})

    try:
        # If the run already finished, no live events will arrive.
        if doc.get("status") in ("complete", "failed", "stopped"):
            await websocket.send_json({"type": "stream_end"})
            return

        job_id = await orchestration_store.latest_job(project_id)
        if job_id is None:
            # If run was just triggered, give the worker process a moment to create the job record
            for _ in range(10):
                await asyncio.sleep(0.5)
                job_id = await orchestration_store.latest_job(project_id)
                if job_id is not None:
                    break

        if job_id is None:
            # No orchestration job active yet; stream cleanly finishes without bogus error
            await websocket.send_json({"type": "stream_end"})
            return

        max_event_id = 0
        idle_polls = 0
        while True:
            events = await orchestration_store.events_after(job_id, max_event_id)
            for event in events:
                max_event_id = max(max_event_id, int(event.get("event_id", 0)))
                await websocket.send_json(event)
                if event.get("type") in ("run_complete", "run_failed"):
                    await websocket.send_json({"type": "stream_end"})
                    return
            idle_polls = idle_polls + 1 if not events else 0
            if idle_polls >= 4:
                latest = await project_service.get_project(project_id, user.id)
                if latest and latest.get("status") in ("complete", "failed", "stopped"):
                    await websocket.send_json({"type": "stream_end"})
                    return
                # An approval or retry runs as a new job; follow it.
                newest = await orchestration_store.latest_job(project_id)
                if newest is not None and newest != job_id:
                    job_id, max_event_id = newest, 0
                idle_polls = 0
            await asyncio.sleep(0.75)

    except WebSocketDisconnect:
        logger.info("Client disconnected from %s stream", project_id)
    except asyncio.CancelledError:
        raise
    except Exception:
        logger.exception("Error in stream for project %s", project_id)
