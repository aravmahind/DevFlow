"""LangChain chat-model factory for Groq, Ollama, and OpenAI-compatible providers."""
from __future__ import annotations

from typing import Any

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_openai import ChatOpenAI

from llm.client import (
    GROQ_API_KEY,
    GROQ_OPENAI_BASE_URL,
    LLM_PROVIDER,
    LLM_TIMEOUT,
    OLLAMA_BASE_URL,
    OPENAI_API_KEY,
    OPENAI_BASE_URL,
)
from utils.logging import get_logger

logger = get_logger("llm.langchain")


def get_chat_model(*, model: str, temperature: float, max_tokens: int) -> BaseChatModel:
    """Build a LangChain model configured for the active LLM provider."""
    provider = LLM_PROVIDER.lower()

    if provider == "groq":
        try:
            from langchain_groq import ChatGroq

            api_key = GROQ_API_KEY or "missing-groq-key"
            return ChatGroq(
                model=model,
                groq_api_key=api_key,
                temperature=temperature,
                max_tokens=max_tokens,
                request_timeout=LLM_TIMEOUT,
                # Retrying 429s natively on the client is safer than failing the node
                max_retries=3,
            )
        except Exception as exc:
            logger.warning("Failed to initialize ChatGroq, falling back to ChatOpenAI: %s", exc)
            return ChatOpenAI(
                model=model,
                api_key=GROQ_API_KEY or "missing-groq-key",
                base_url=GROQ_OPENAI_BASE_URL,
                temperature=temperature,
                max_tokens=max_tokens,
                timeout=LLM_TIMEOUT,
                max_retries=3,
            )

    if provider == "ollama":
        return ChatOpenAI(
            model=model,
            api_key="ollama",
            base_url=f"{OLLAMA_BASE_URL.rstrip('/')}/v1",
            temperature=temperature,
            max_tokens=max_tokens,
            timeout=LLM_TIMEOUT,
            max_retries=0,
        )

    return ChatOpenAI(
        model=model,
        api_key=OPENAI_API_KEY,
        base_url=OPENAI_BASE_URL,
        temperature=temperature,
        max_tokens=max_tokens,
        timeout=LLM_TIMEOUT,
        max_retries=1,
    )
