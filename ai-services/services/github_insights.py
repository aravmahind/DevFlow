"""Repository intelligence for linked GitHub repos.

* ``analyze_commits`` classifies commits and maps each onto the project's plan
  items (backlog tasks / requirements), marking whether it completes the item.
* ``summarize_repo`` writes a short status narrative from the tracker context.
* ``repo_chat`` answers questions grounded in the repo briefing the backend
  assembles (README, tree, contributors, plan status, commit log).
"""
from __future__ import annotations

import asyncio
import json
import re
from typing import Any, Awaitable, Callable, Literal

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from pydantic import BaseModel, Field

from llm.langchain_client import get_chat_model
from llm.router import FAST_MODEL, SMART_MODEL
from utils.logging import get_logger
from workflows.agent_graph import _structured

logger = get_logger("github_insights")

Category = Literal["feature", "fix", "refactor", "docs", "test", "chore"]


class ItemMatch(BaseModel):
    key: str = Field(description="Plan item key such as T3 or R1, copied exactly from the list")
    completion: Literal["partial", "complete"] = Field(
        description="complete only when this commit plausibly finishes the item; otherwise partial"
    )


class CommitInsight(BaseModel):
    sha: str
    summary: str = Field(description="One plain-English sentence describing what the commit does")
    category: Category
    area: str = Field(default="", description="Short product/code area, e.g. 'auth', 'payments API', 'UI'")
    items: list[ItemMatch] = Field(default_factory=list)


class CommitBatch(BaseModel):
    commits: list[CommitInsight] = Field(default_factory=list)


class ItemVerdict(BaseModel):
    key: str = Field(description="Plan item key from the evidence section, e.g. T4")
    status: Literal["implemented", "in_progress"]
    reason: str = Field(default="", description="One short clause citing the deciding commits")


class RepoReport(BaseModel):
    summary: str = Field(description="3-5 sentence status summary of the codebase and delivery progress")
    tech_stack: list[str] = Field(default_factory=list)
    highlights: list[str] = Field(default_factory=list, description="Up to 5 notable recent developments")
    gaps: list[str] = Field(default_factory=list, description="Up to 4 planned items with no code yet, or risks")
    item_verdicts: list[ItemVerdict] = Field(
        default_factory=list,
        description="One verdict per item listed under ITEM EVIDENCE, judged from all of its commits together",
    )


ANALYZE_PROMPT = (
    "You map git commits onto a software project's plan. For each commit, write a one-sentence "
    "summary, pick a category, name the code area, and list the plan items it implements. "
    "Match an item only when the commit message or changed files clearly relate to it; most "
    "commits match zero or one item, never more than three. Use 'complete' when the commit "
    "delivers the core capability the item describes (e.g. 'Add refreshTokens endpoint' completes "
    "a refresh-token item, 'Add email service' completes an email item), and 'partial' for "
    "scaffolding, follow-up tweaks, fixes, or work covering only part of the item. Return exactly one entry per input commit, keeping its sha."
)

CHAT_PROMPT = (
    "You are Devflow's repository analyst. You answer questions about a GitHub repository linked "
    "to a project: what it contains, how it is structured, what has been implemented against the "
    "plan, who built which feature, and recent activity. Ground every answer in the briefing "
    "below; cite short commit shas and contributor names when relevant. If the briefing does not "
    "contain the answer, say so plainly instead of guessing. Use concise markdown: short "
    "paragraphs, bullet lists, and bold for names of features or people."
)


def _is_rate_limited(exc: Exception) -> bool:
    if getattr(exc, "status_code", None) == 429 or "ratelimit" in type(exc).__name__.lower():
        return True
    return bool(re.search(r"(?:error|status)\s*code\s*[:=]\s*429\b|rate_limit_exceeded", str(exc), re.I))


def _is_daily_quota(exc: Exception) -> bool:
    """Daily token quotas cannot recover within a retry window."""
    return bool(re.search(r"tokens\s+per\s+day|\bTPD\b", str(exc), re.I))


def _retry_delay(exc: Exception, attempt: int) -> float:
    """Honor the provider's retry hint ("try again in 12.5s"), with a small buffer."""
    headers = getattr(getattr(exc, "response", None), "headers", None) or {}
    try:
        if headers.get("retry-after"):
            return min(float(headers["retry-after"]) + 2.0, 120.0)
    except (TypeError, ValueError):
        pass
    match = re.search(r"try again in\s+(\d+(?:\.\d+)?)\s*(ms|s|m)?", str(exc), re.I)
    if match:
        delay = float(match.group(1))
        unit = (match.group(2) or "s").lower()
        delay = delay / 1000 if unit == "ms" else delay * 60 if unit == "m" else delay
        return min(delay + 2.0, 120.0)
    return min(15.0 * attempt, 120.0)


async def _invoke(label: str, call: Callable[[str], Awaitable[Any]], rate_retries: int = 4) -> Any:
    """Try the smart model, then the fast one; wait out per-minute throttles on each."""
    last_exc: Exception | None = None
    for model_name in (SMART_MODEL, FAST_MODEL):
        for attempt in range(1, rate_retries + 1):
            try:
                return await call(model_name)
            except Exception as exc:
                last_exc = exc
                logger.warning("%s with %s failed: %s", label, model_name, str(exc)[:200])
                if not _is_rate_limited(exc) or _is_daily_quota(exc) or attempt == rate_retries:
                    break
                await asyncio.sleep(_retry_delay(exc, attempt))
    raise RuntimeError(f"{label} failed: {last_exc}")


def _model(model_name: str, temperature: float, max_tokens: int) -> Any:
    """Chat model for tracker tasks. gpt-oss models otherwise spend most of max_tokens
    on hidden reasoning and return empty content; low effort is plenty for these."""
    model = get_chat_model(model=model_name, temperature=temperature, max_tokens=max_tokens)
    return model.bind(reasoning_effort="low") if "gpt-oss" in model_name else model


def _with_schema(messages: list[Any], schema: type[BaseModel]) -> list[Any]:
    """The shared Groq parser reads JSON from the reply text (tool calls are unreliable
    on gpt-oss), so the schema goes into the prompt."""
    instruction = (
        "\n\nRespond with ONLY one JSON object, no prose or markdown, matching this JSON Schema:\n"
        + json.dumps(schema.model_json_schema(), separators=(",", ":"))
    )
    return [SystemMessage(content=str(messages[0].content) + instruction), *messages[1:]]


def _items_text(items: list[dict[str, Any]]) -> str:
    return "\n".join(
        f"{i.get('key')} | {i.get('title')} | epic: {i.get('epic', '')} | {i.get('category', '')}"
        for i in items
    ) or "(no plan items)"


def _commits_text(commits: list[dict[str, Any]]) -> str:
    blocks = []
    for c in commits:
        files = ", ".join(c.get("files") or [])[:500]
        blocks.append(
            f"sha: {c.get('sha')}\nauthor: {c.get('author')}\nmessage: {c.get('message', '')[:600]}"
            + (f"\nfiles: {files}" if files else "")
        )
    return "\n---\n".join(blocks)


async def analyze_commits(items: list[dict[str, Any]], commits: list[dict[str, Any]]) -> CommitBatch:
    if not commits:
        return CommitBatch()
    messages = [
        SystemMessage(content=ANALYZE_PROMPT),
        HumanMessage(content=f"PLAN ITEMS:\n{_items_text(items)}\n\nCOMMITS:\n{_commits_text(commits)}"),
    ]

    async def call(model_name: str) -> CommitBatch:
        model = _model(model_name, 0.1, min(2500, 120 * len(commits) + 500))
        return await _structured(model, CommitBatch).ainvoke(_with_schema(messages, CommitBatch))

    return await _invoke("Commit analysis", call)


async def summarize_repo(context: str) -> RepoReport:
    messages = [
        SystemMessage(content=(
            "Write a delivery status report for a project manager from this repository briefing. "
            "Be specific: reference real features, numbers, and people from the briefing; never invent. "
            "For every item under ITEM EVIDENCE, give a verdict judged from all its commits together: "
            "'implemented' when the commits jointly deliver the item's core capability, otherwise "
            "'in_progress'. These are observations from Git history, not verified by tests: say "
            "'appears complete' rather than 'done' or 'production-ready'. Keep the summary consistent "
            "with your verdicts."
        )),
        HumanMessage(content=context),
    ]

    async def call(model_name: str) -> RepoReport:
        model = _model(model_name, 0.2, 2000)
        return await _structured(model, RepoReport).ainvoke(_with_schema(messages, RepoReport))

    return await _invoke("Repo summary", call)


async def repo_chat(context: str, message: str, history: list[dict[str, str]] | None = None) -> str:
    messages: list[Any] = [SystemMessage(content=f"{CHAT_PROMPT}\n\n--- REPOSITORY BRIEFING ---\n{context}")]
    for turn in (history or [])[-6:]:
        content = str(turn.get("content", ""))[:1500]
        if turn.get("role") == "user" and content:
            messages.append(HumanMessage(content=content))
        elif turn.get("role") == "assistant" and content:
            messages.append(AIMessage(content=content))
    messages.append(HumanMessage(content=message[:2000]))

    async def call(model_name: str) -> str:
        model = _model(model_name, 0.3, 2000)
        response = await model.ainvoke(messages)
        reply = str(response.content).strip()
        if not reply:
            raise RuntimeError("empty reply (token budget spent on reasoning)")
        return reply

    # Chat is interactive: wait out at most one short throttle per model.
    return await _invoke("Repo chat", call, rate_retries=2)
