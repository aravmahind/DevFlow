"""Model router.

Maps each agent to a model + generation parameters. The default model comes
from ``LLM_MODEL``; any agent can be overridden with ``LLM_MODEL_<AGENT>``
(e.g. ``LLM_MODEL_RISK=llama3.1``). This lets us route heavier reasoning
agents to stronger models while keeping cheap agents on a fast one.
"""
from __future__ import annotations

import os
from dataclasses import dataclass

from utils.env import load_runtime_env
from utils.logging import get_logger

load_runtime_env()
logger = get_logger("llm.router")


DEFAULT_MODEL = os.getenv("LLM_MODEL", "openai/gpt-oss-120b")
SMART_MODEL = os.getenv("LLM_MODEL_SMART", DEFAULT_MODEL)
FAST_MODEL = os.getenv("LLM_MODEL_FAST", "openai/gpt-oss-20b")
SECONDARY_MODEL = os.getenv("LLM_MODEL_SECONDARY", "openai/gpt-oss-20b")


@dataclass(frozen=True)
class ModelConfig:
    model: str
    temperature: float
    max_tokens: int


_PROFILES: dict[str, ModelConfig] = {
    # SMART agents use FAST_MODEL (gpt-oss-20b) because the 120b reasoning model
    # burns its entire max_tokens budget on hidden reasoning_content, leaving
    # nothing for visible .content output (finish_reason=length, empty JSON).
    "requirement_agent": ModelConfig(FAST_MODEL, 0.4, 4096),
    "architect_agent": ModelConfig(FAST_MODEL, 0.35, 4096),
    "sprint_planner_agent": ModelConfig(FAST_MODEL, 0.3, 4096),
    "github_monitor": ModelConfig(FAST_MODEL, 0.3, 1500),
    "risk_agent": ModelConfig(FAST_MODEL, 0.4, 1500),
    "deployment_advisor": ModelConfig(FAST_MODEL, 0.4, 2000),
}


def _groq_otpm_cap() -> int | None:
    """Return the Groq output-token ceiling, or None when not on Groq."""
    from llm.client import LLM_PROVIDER
    if LLM_PROVIDER.lower() != "groq":
        return None
    return int(os.getenv("GROQ_MAX_OUTPUT_TOKENS", "6000"))


def resolve(agent_id: str) -> ModelConfig:
    base = _PROFILES.get(agent_id, ModelConfig(DEFAULT_MODEL, 0.4, 2000))
    override = os.getenv(f"LLM_MODEL_{agent_id.upper()}")
    if override:
        logger.info("Agent %s routed to override model %s", agent_id, override)
        base = ModelConfig(override, base.temperature, base.max_tokens)

    # Clamp max_tokens to Groq's per-model OTPM ceiling to avoid hard 429 rejections
    cap = _groq_otpm_cap()
    if cap is not None and base.max_tokens > cap:
        logger.warning(
            "Agent %s max_tokens %d exceeds Groq OTPM cap %d; clamping to %d",
            agent_id, base.max_tokens, cap, cap,
        )
        return ModelConfig(base.model, base.temperature, cap)
    return base


def all_models() -> set[str]:
    return {resolve(a).model for a in _PROFILES} | {FAST_MODEL, SECONDARY_MODEL}
