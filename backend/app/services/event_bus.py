"""In-memory event bus and buffer replay.

Replaces Redis pub/sub with zero external dependencies. The job queue lives in
PostgreSQL (``orchestration_store``) so it survives restarts.
Works identically in local dev and Docker container modes.
"""
from __future__ import annotations

import asyncio
from collections import defaultdict, deque
from typing import Any, AsyncGenerator

from app.core.logging import get_logger

logger = get_logger("services.event_bus")

_MAX_BUFFER_PER_PROJECT = 2000


class EventBus:
    def __init__(self) -> None:
        # project_id -> set of subscriber Queues
        self._subscribers: dict[str, set[asyncio.Queue]] = defaultdict(set)
        # project_id -> deque of buffered event dicts
        self._buffers: dict[str, deque[dict[str, Any]]] = defaultdict(
            lambda: deque(maxlen=_MAX_BUFFER_PER_PROJECT)
        )
        self._lock = asyncio.Lock()

    # ---- Pub/Sub & Buffering (Replaces Redis channel & Redis event buffer) ----

    async def publish(self, project_id: str, event: dict[str, Any]) -> None:
        """Publish an event to all active WebSocket/stream subscribers for a project."""
        self.buffer_event(project_id, event)

        async with self._lock:
            subs = list(self._subscribers.get(project_id, set()))

        for q in subs:
            try:
                q.put_nowait(event)
            except asyncio.QueueFull:
                logger.warning("Subscriber queue full for project %s; dropping oldest", project_id)
                try:
                    q.get_nowait()
                    q.put_nowait(event)
                except Exception:
                    pass

    def buffer_event(self, project_id: str, event: dict[str, Any]) -> None:
        """Append an event to the per-project replay buffer."""
        self._buffers[project_id].append(event)

    def get_buffer(self, project_id: str) -> list[dict[str, Any]]:
        """Return a copy of all buffered events for the project."""
        return list(self._buffers.get(project_id, []))

    def clear_buffer(self, project_id: str) -> None:
        """Clear the buffer for a project."""
        if project_id in self._buffers:
            self._buffers[project_id].clear()

    async def subscribe(self, project_id: str) -> AsyncGenerator[dict[str, Any], None]:
        """Subscribe to live events for a project."""
        q: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=1000)
        async with self._lock:
            self._subscribers[project_id].add(q)

        try:
            while True:
                event = await q.get()
                yield event
        finally:
            async with self._lock:
                self._subscribers[project_id].discard(q)
                if not self._subscribers[project_id]:
                    self._subscribers.pop(project_id, None)


# Global singleton event bus
event_bus = EventBus()