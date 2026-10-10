"""Base agent abstraction.

Every Devflow agent shares the same execution shape: take the accumulated
project context, render a dedicated prompt, call the LLM for structured output,
and return a validated dict. The differences (role, prompt, schema, model) are
pure configuration, so a single ``Agent`` class is parameterized by metadata.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Callable, Type

from pydantic import BaseModel

if TYPE_CHECKING:
    from state.project_state import ProjectState

from llm.router import SECONDARY_MODEL, ModelConfig, resolve
from utils.logging import get_logger
from workflows.agent_graph import build_agent_graph

logger = get_logger("agents")


@dataclass(frozen=True)
class Agent:
    id: str
    name: str
    role: str
    node: str  # the orchestration-graph node this agent drives
    schema: Type[BaseModel]
    system_prompt: str
    build_user_prompt: Callable[[dict[str, Any]], str]

    async def run(
        self,
        ctx: "ProjectState",
        directive: str | None = None,
        model_config: ModelConfig | None = None,
    ) -> dict[str, Any]:
        """Execute the agent against the project context, returning a plain dict."""
        started = time.time()

        logger.info(
            "▶ %s (%s) starting%s",
            self.name,
            self.id,
            f" with directive: {directive[:60]}" if directive else "",
        )

        primary = model_config or resolve(self.id)
        try:
            result = await self._invoke(ctx, directive, primary)
        except Exception as exc:
            fallback = _fallback_for(primary, exc)
            if fallback is None:
                raise
            logger.warning(
                "%s failed on %s (%s); retrying once on fallback model %s",
                self.name, primary.model, str(exc)[:200], fallback.model,
            )
            result = await self._invoke(ctx, directive, fallback)

        elapsed = time.time() - started
        logger.info("✓ %s finished in %.1fs", self.name, elapsed)

        return result.model_dump(mode="json")

    async def _invoke(
        self, ctx: "ProjectState", directive: str | None, model_config: ModelConfig
    ) -> BaseModel:
        graph = build_agent_graph(
            agent_id=self.id,
            system_prompt=self.system_prompt,
            schema=self.schema,
            model_config=model_config,
            directive=directive,
        )
        state = await graph.ainvoke(
            {
                "context": ctx,
                "user_prompt": self.build_user_prompt(ctx),
            }
        )
        return state["result"]


def _fallback_for(primary: ModelConfig, exc: Exception) -> ModelConfig | None:
    """The secondary model to retry on, or None when switching cannot help.

    A deprecated/unknown model, an overloaded or throttled one, or a model that
    keeps producing unparseable output are all worth one attempt elsewhere.
    Bad credentials are not: every model on the provider would fail the same way.
    """
    if not SECONDARY_MODEL or SECONDARY_MODEL == primary.model:
        return None
    status = getattr(exc, "status_code", None)
    if not isinstance(status, int):
        status = getattr(getattr(exc, "response", None), "status_code", None)
    if status in (401, 403):
        return None
    return ModelConfig(
        SECONDARY_MODEL, primary.temperature, primary.max_tokens,
        reasoning_effort="low" if "gpt-oss" in SECONDARY_MODEL else None,
    )
