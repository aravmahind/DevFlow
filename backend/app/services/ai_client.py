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
        self, project_id: str, idea: str, title: Optional[str], state_updates: Optional[dict[str, Any]] = None
    ) -> AsyncGenerator[dict[str, Any], None]:
        """Stream orchestration events in real time from ai-services over HTTP."""
        url = f"{self._base_url}/workflow/stream"
        payload = {
            "project_id": project_id, 
            "idea": idea, 
            "title": title,
            "state_updates": state_updates or {}
        }
        timeout = httpx.Timeout(settings.run_timeout_seconds, connect=15.0)

        async with httpx.AsyncClient(timeout=timeout) as client:
            async with client.stream("POST", url, json=payload, headers=self._headers) as resp:
                resp.raise_for_status()
                async for line in resp.aiter_lines():
                    line = line.strip()
                    if not line:
                        continue
                    if line.startswith("data:"):
                        line = line[5:].strip()
                    try:
                        event = json.loads(line)
                        yield event
                    except (json.JSONDecodeError, TypeError):
                        continue

    async def approve_workflow(
        self, project_id: str, phase: str, approved: bool, feedback: str = ""
    ) -> AsyncGenerator[dict[str, Any], None]:
        """Stream orchestration events in real time after human approval."""
        url = f"{self._base_url}/workflow/approve"
        payload = {
            "project_id": project_id,
            "phase": phase,
            "approved": approved,
            "feedback": feedback
        }
        timeout = httpx.Timeout(settings.run_timeout_seconds, connect=15.0)

        async with httpx.AsyncClient(timeout=timeout) as client:
            async with client.stream("POST", url, json=payload, headers=self._headers) as resp:
                resp.raise_for_status()
                async for line in resp.aiter_lines():
                    line = line.strip()
                    if not line:
                        continue
                    if line.startswith("data:"):
                        line = line[5:].strip()
                    try:
                        event = json.loads(line)
                        yield event
                    except (json.JSONDecodeError, TypeError):
                        continue

    async def chat(
        self, project: dict[str, Any], message: str, history: list[dict[str, str]]
    ) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=45.0) as client:
            resp = await client.post(
                f"{self._base_url}/assistant/chat",
                json={"project": project, "message": message, "history": history},
                headers=self._headers,
            )
            resp.raise_for_status()
            return resp.json()

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
