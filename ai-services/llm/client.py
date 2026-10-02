"""LLM client factory.

Wraps the OpenAI-compatible API. Three providers are supported via ``LLM_PROVIDER``:

* ``ollama`` — local inference at ``OLLAMA_BASE_URL`` (slow CPU → generous timeout).
* ``groq``   — Groq Cloud (https://api.groq.com/openai/v1). Fast + a generous free
  tier, which is the recommended default for Devflow. Key comes from
  ``GROQ_API_KEY`` (or the legacy ``GROQ_API`` used in this repo's .env). We allow a
  couple of retries so transient 429 rate-limits self-heal with backoff.
* anything else — a generic OpenAI-compatible endpoint (``OPENAI_BASE_URL``).
"""
from __future__ import annotations

import os

import httpx
from openai import AsyncOpenAI

from utils.env import load_runtime_env

load_runtime_env()

LLM_PROVIDER = os.getenv("LLM_PROVIDER", "groq")
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://host.docker.internal:11434")
LLM_MODEL = os.getenv("LLM_MODEL", "openai/gpt-oss-120b")
# Cloud APIs (Groq) are fast; don't make a stuck request hang for 10 minutes.
_default_timeout = "120" if LLM_PROVIDER.lower() != "ollama" else "600"
LLM_TIMEOUT = float(os.getenv("LLM_TIMEOUT_SECONDS", _default_timeout))

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "dummy-key-for-local")
OPENAI_BASE_URL = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1")

# Groq is OpenAI-compatible. The repo's .env historically used GROQ_API (no _KEY),
# so we accept either spelling.

def _normalize_groq_base_url(raw: str | None) -> str:
    configured = (raw or os.getenv("GROQ_BASE_URL", "https://api.groq.com")).strip().rstrip("/")
    if not configured:
        return "https://api.groq.com"
    if configured.endswith("/openai/v1"):
        return configured[:-len("/openai/v1")]
    if configured.endswith("/openai"):
        return configured[:-len("/openai")]
    return configured


GROQ_BASE_URL = _normalize_groq_base_url(os.getenv("GROQ_BASE_URL"))
GROQ_OPENAI_BASE_URL = f"{GROQ_BASE_URL}/openai/v1" if not GROQ_BASE_URL.endswith("/openai/v1") else GROQ_BASE_URL
GROQ_API_KEY = os.getenv("GROQ_API_KEY") or os.getenv("GROQ_API", "")

_client: AsyncOpenAI | None = None


def get_llm_client() -> AsyncOpenAI:
    """Return a process-wide AsyncOpenAI client configured for the provider."""
    global _client
    if _client is not None:
        return _client

    provider = LLM_PROVIDER.lower()
    timeout = httpx.Timeout(LLM_TIMEOUT, connect=15.0)
    if provider == "ollama":
        base_url = f"{OLLAMA_BASE_URL.rstrip('/')}/v1"
        _client = AsyncOpenAI(api_key="ollama", base_url=base_url, timeout=timeout, max_retries=0)
    elif provider == "groq":
        _client = AsyncOpenAI(
            api_key=GROQ_API_KEY or "missing-groq-key",
            base_url=GROQ_OPENAI_BASE_URL,
            timeout=timeout,
            max_retries=2,
        )
    else:
        _client = AsyncOpenAI(
            api_key=OPENAI_API_KEY, base_url=OPENAI_BASE_URL, timeout=timeout, max_retries=1
        )
    return _client


def get_model_name() -> str:
    return LLM_MODEL


def ollama_base_url() -> str:
    return OLLAMA_BASE_URL
