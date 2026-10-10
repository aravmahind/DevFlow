"""Failure classification and model-fallback rules for workflow runs."""
from types import SimpleNamespace

from agents.base import _fallback_for
from api.routes import _is_retryable
from llm.router import SECONDARY_MODEL, ModelConfig


class _StatusError(Exception):
    def __init__(self, status: int, message: str = "") -> None:
        super().__init__(message or f"HTTP {status}")
        self.status_code = status


def test_provider_errors_that_cannot_heal_are_not_retried():
    assert not _is_retryable(_StatusError(404, "model `x` does not exist"))
    assert not _is_retryable(_StatusError(401))
    assert not _is_retryable(_StatusError(400))


def test_transient_errors_are_retried():
    assert _is_retryable(_StatusError(429, "Rate limit reached ... tokens per minute (TPM)"))
    assert _is_retryable(_StatusError(503))
    assert _is_retryable(TimeoutError())
    assert _is_retryable(ValueError("Failed to parse JSON"))


def test_daily_quota_is_not_retried():
    assert not _is_retryable(_StatusError(429, "Rate limit reached ... tokens per day (TPD)"))


def test_status_code_on_response_is_honoured():
    exc = Exception("boom")
    exc.response = SimpleNamespace(status_code=502)
    assert _is_retryable(exc)


def test_fallback_switches_model_for_unknown_model_and_throttles():
    primary = ModelConfig("deprecated-model", 0.4, 4096)
    for exc in (_StatusError(404), _StatusError(429), ValueError("bad json")):
        fallback = _fallback_for(primary, exc)
        assert fallback is not None
        assert fallback.model == SECONDARY_MODEL
        assert fallback.max_tokens == 4096


def test_no_fallback_for_bad_credentials_or_same_model():
    assert _fallback_for(ModelConfig("deprecated-model", 0.4, 4096), _StatusError(401)) is None
    assert _fallback_for(ModelConfig(SECONDARY_MODEL, 0.4, 4096), _StatusError(404)) is None
