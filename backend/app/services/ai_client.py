import json
from typing import Any, AsyncGenerator, Optional

import httpx

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger("services.ai_client")


class AIServicesClient:
    def __init__(self, base_url: Optional[str] = None):
        self._base_url = (base_url or settings.ai_services_url).rstrip("/")

    @property
    def _headers(self) -> dict[str, str]:
        return (
            {"X-Devflow-Internal-Key": settings.ai_internal_api_key}
            if settings.ai_internal_api_key else {}
        )

    async def stream_workflow(
        self,
        project_id: str,
        idea: str,
        title: Optional[str],
        state_updates: Optional[dict[str, Any]] = None,
        *,
        resume: bool = False,
    ) -> AsyncGenerator[dict[str, Any], None]:
        """Stream orchestration events in real time from ai-services over HTTP.

        ``resume`` continues the project's graph from its last checkpoint (the
        node that failed, or the approval gate it is parked at) instead of
        starting over.
        """
        payload = {
            "project_id": project_id,
            "idea": idea,
            "title": title,
            "state_updates": state_updates or {},
            "resume": resume,
        }
        async for event in self._stream_ndjson("/workflow/stream", payload):
            yield event

    async def approve_workflow(
        self, project_id: str, phase: str, approved: bool, feedback: str = "",
        decision_id: Optional[str] = None,
    ) -> AsyncGenerator[dict[str, Any], None]:
        """Stream orchestration events in real time after human approval."""
        payload = {
            "project_id": project_id,
            "phase": phase,
            "approved": approved,
            "feedback": feedback,
            "decision_id": decision_id,
        }
        async for event in self._stream_ndjson("/workflow/approve", payload):
            yield event

    async def _stream_ndjson(
        self, path: str, payload: dict[str, Any]
    ) -> AsyncGenerator[dict[str, Any], None]:
        # The read timeout bounds silence between events, not the whole run;
        # the orchestrator enforces the overall run deadline.
        timeout = httpx.Timeout(settings.stream_idle_timeout_seconds, connect=15.0)
        async with httpx.AsyncClient(timeout=timeout) as client:
            async with client.stream(
                "POST", f"{self._base_url}{path}", json=payload, headers=self._headers
            ) as resp:
                if resp.is_error:
                    await resp.aread()
                    logger.warning("ai-services %s -> %d: %s", path, resp.status_code, resp.text[:300])
                resp.raise_for_status()
                async for line in resp.aiter_lines():
                    line = line.strip()
                    if line.startswith("data:"):
                        line = line[5:].strip()
                    if not line:
                        continue
                    try:
                        event = json.loads(line)
                    except (json.JSONDecodeError, TypeError):
                        continue
                    if isinstance(event, dict):
                        yield event

    async def chat(
        self, project: dict[str, Any], message: str, history: list[dict[str, str]]
    ) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=150.0) as client:
            resp = await client.post(
                f"{self._base_url}/assistant/chat",
                json={"project": project, "message": message, "history": history},
                headers=self._headers,
            )
            resp.raise_for_status()
            return resp.json()

    async def _post(self, path: str, payload: dict[str, Any], timeout: float) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.post(f"{self._base_url}{path}", json=payload, headers=self._headers)
            resp.raise_for_status()
            return resp.json()

    async def github_analyze(
        self, items: list[dict[str, Any]], commits: list[dict[str, Any]]
    ) -> dict[str, Any]:
        """Classify commits and map them onto plan items."""
        return await self._post("/github/analyze-commits", {"items": items, "commits": commits}, 400.0)

    async def github_summarize(self, context: str) -> dict[str, Any]:
        return await self._post("/github/summarize", {"context": context}, 400.0)

    async def github_chat(
        self, context: str, message: str, history: list[dict[str, str]]
    ) -> dict[str, Any]:
        return await self._post(
            "/github/chat", {"context": context, "message": message, "history": history}, 150.0
        )

    async def list_agents(self) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(f"{self._base_url}/agents", headers=self._headers)
            resp.raise_for_status()
            return resp.json()

    async def health(self) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(f"{self._base_url}/health")
            return resp.json()


ai_services = AIServicesClient()
