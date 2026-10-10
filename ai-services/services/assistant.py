"""Project assistant — a grounded chat over a completed (or in-progress) plan.

Unlike the agents, this is a plain conversational completion (no schema). It is
given a compact summary of the project's plan so it answers from the real data
rather than hallucinating. Routed to the fast Groq model to keep it cheap.
"""
from __future__ import annotations

import json
import re
from typing import Any

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from langchain_core.utils.json import parse_partial_json

from llm.langchain_client import get_chat_model
from llm.router import FAST_MODEL, SECONDARY_MODEL
from workflows.agent_graph import _extract_json_object
from services.rag import format_retrieved_context, retrieve_for_agent
from prompts.context import (
    summarize_architecture,
    summarize_backlog,
    summarize_executive,
    summarize_requirements,
)
from utils.logging import get_logger
from pydantic import BaseModel, Field

logger = get_logger("assistant")

SYSTEM_PROMPT = (
    "You are Devflow's project assistant, embedded inside a software delivery workspace. "
    "You help a product manager / founder understand, refine, and act on THIS project's plan. "
    "Answer using only the project context provided — if something isn't in the plan, say so and "
    "suggest how to add it. Be concise and concrete: prefer short paragraphs and tight bullet lists, "
    "give specific numbers from the plan, and end with a suggested next step when useful. "
    "Never invent metrics that aren't in the context."
)

class AssistantEdit(BaseModel):
    op: str = Field(default="set", description="set | add | remove")
    path: str = Field(description="Existing JSON pointer path in the project, e.g. /executive_summary/tagline")
    value: Any = None

class AssistantCommand(BaseModel):
    reply: str
    edits: list[AssistantEdit] = Field(default_factory=list)


def _line(label: str, value: Any) -> str:
    return f"{label}: {value}" if value not in (None, "", []) else ""


def build_project_context(project: dict[str, Any]) -> str:
    """Assemble a compact, token-light briefing from the project document."""
    parts: list[str] = []
    title = project.get("title")
    idea = project.get("idea")
    if title:
        parts.append(f"# Project: {title}")
    if idea:
        parts.append(f"Original brief: {str(idea)[:600]}")

    execu = summarize_executive(project)
    if execu:
        parts.append("## Executive\n" + execu)

    reqs = summarize_requirements(project)
    if reqs:
        parts.append("## Requirements\n" + reqs)

    arch = summarize_architecture(project)
    if arch:
        parts.append("## Architecture\n" + arch)

    backlog = summarize_backlog(project)
    if backlog:
        parts.append("## Backlog\n" + backlog)

    risks = project.get("risks") if isinstance(project.get("risks"), dict) else None
    if risks:
        items = risks.get("risks", [])[:6]
        rl = [f"- [{r.get('severity')}] {r.get('title')} (mitigation: {str(r.get('mitigation',''))[:80]})" for r in items]
        parts.append(f"## Risks (overall {risks.get('overall_risk_level','?')})\n" + "\n".join(rl))

    team = project.get("team") if isinstance(project.get("team"), dict) else None
    if team:
        members = team.get("members", [])
        tm = [f"- {m.get('count',1)}× {m.get('seniority','')} {m.get('role','')}" for m in members[:8]]
        parts.append("## Team\n" + "\n".join(tm))

    cost = project.get("cost") if isinstance(project.get("cost"), dict) else None
    if cost:
        parts.append(
            f"## Cost\nMonthly ${cost.get('monthly_total_usd',0):,.0f}; "
            f"project total ${cost.get('project_total_usd',0):,.0f} over {cost.get('duration_months','?')} months."
        )

    timeline = project.get("timeline") if isinstance(project.get("timeline"), dict) else None
    if timeline:
        ms = timeline.get("milestones", [])
        tl = [f"- {m.get('title')} ({m.get('phase')}, +{m.get('start_week')}w for {m.get('duration_weeks')}w)" for m in ms[:6]]
        parts.append(f"## Timeline (total {timeline.get('total_duration_weeks','?')}w)\n" + "\n".join(tl))

    integ = project.get("integrations") if isinstance(project.get("integrations"), dict) else None
    if integ:
        names = ", ".join(i.get("name", "") for i in integ.get("integrations", [])[:8])
        parts.append("## Integrations\n" + names)

    if len(parts) <= 2:
        parts.append("(The plan is still being generated — only partial data is available so far.)")

    return "\n\n".join(p for p in parts if p)


# User-facing sections the assistant may read and edit, in the order the model
# sees them. Orchestration state, logs and ids are deliberately absent.
_EDITABLE_SECTIONS = (
    "title", "executive_summary", "requirements", "architecture", "backlog",
    "risks", "deployment_recommendations",
)
_VIEW_BUDGET = 16000

EDIT_INSTRUCTIONS = """You are Flowmate, and you can change this project's plan when the user asks.

Respond with ONE JSON object and nothing else:
{"reply": "<what you answered or changed, in plain language>",
 "edits": [{"op": "set" | "add" | "remove", "path": "/section/field/0/name", "value": <new value>}]}

Rules for edits:
- Paths are JSON pointers from the TOP of the EDITABLE PLAN below, always starting with the section
  name, e.g. /requirements/non_functional_requirements/2/description or /backlog/tasks/0/title.
  List items are addressed by index (0-based).
- "set" replaces an existing field or list item. "add" with a path ending in /- appends to a list
  (e.g. {"op":"add","path":"/requirements/user_stories/-","value":{...}}). "remove" deletes a list item.
- New list items must have the same fields as the existing items in that list.
- Only use paths that exist in the EDITABLE PLAN. Keep edits minimal: change only what was asked.
- For questions (no change requested) return "edits": [].
- Never claim a change in reply that is not in edits."""


def _editable_view(project: dict[str, Any], message: str) -> tuple[str, list[str]]:
    """JSON of the editable sections, fitted to a budget. Sections the message
    mentions are kept first; any that don't fit are named so the model knows."""
    view: dict[str, Any] = {}
    for key in _EDITABLE_SECTIONS:
        value = project.get(key)
        if value in (None, "", [], {}):
            continue
        if key == "architecture" and isinstance(value, dict):
            value = {k: v for k, v in value.items() if k not in ("diagram", "mermaid")}
        view[key] = value
    lowered = message.lower()
    mentioned = {"requirements": ("requirement", "story", "stories", "nfr", "scope"),
                 "backlog": ("task", "sprint", "epic", "backlog", "assign", "estimate"),
                 "architecture": ("architect", "stack", "database", "frontend", "backend", "infra"),
                 "risks": ("risk",), "executive_summary": ("summary", "goal", "tagline", "overview")}
    order = sorted(view, key=lambda k: 0 if any(w in lowered for w in mentioned.get(k, ())) else 1)
    kept: dict[str, Any] = {}
    omitted: list[str] = []
    size = 2
    for key in order:
        chunk = json.dumps(view[key], default=str, separators=(",", ":"))
        if size + len(chunk) > _VIEW_BUDGET:
            omitted.append(key)
            continue
        kept[key] = view[key]
        size += len(chunk) + len(key) + 4
    return json.dumps(kept, default=str, separators=(",", ":")), omitted


def _parse_command(text: str) -> AssistantCommand:
    text = re.sub(r"<think>.*?</think>", "", text or "", flags=re.S).strip()
    raw = _extract_json_object(text)
    if raw:
        for loader in (json.loads, parse_partial_json):
            try:
                data = loader(raw)
            except Exception:
                continue
            if isinstance(data, dict) and "reply" in data:
                edits = data.get("edits") or []
                if isinstance(edits, dict):
                    edits = [edits]
                clean = [
                    AssistantEdit(path=str(e["path"]), value=e.get("value"), op=str(e.get("op") or "set"))
                    for e in edits if isinstance(e, dict) and str(e.get("path", "")).startswith("/")
                ]
                return AssistantCommand(reply=str(data.get("reply") or ""), edits=clean)
    # Not JSON: treat as a plain conversational answer.
    return AssistantCommand(reply=text, edits=[])


def _repair_path(project: dict[str, Any], path: str) -> str:
    """Models sometimes drop the section prefix (/user_stories/- instead of
    /requirements/user_stories/-). Restore it when exactly one section owns the key."""
    parts = [p for p in path.split("/") if p]
    if not parts or parts[0] in project:
        return path
    owners = [key for key in _EDITABLE_SECTIONS
              if isinstance(project.get(key), dict) and parts[0] in project[key]]
    return f"/{owners[0]}{path}" if len(owners) == 1 else path


async def chat(
    project: dict[str, Any],
    message: str,
    history: list[dict[str, str]] | None = None,
) -> AssistantCommand:
    context = build_project_context(project)
    retrieved = await retrieve_for_agent(
        str(project.get("id", "")), "product_manager", message, limit=6
    )
    evidence = format_retrieved_context(retrieved, max_chars=4000)
    plan_json, omitted = _editable_view(project, message)
    omitted_note = (
        f"\n(Sections not shown for length, so not editable in this turn: {', '.join(omitted)}.)"
        if omitted else ""
    )
    system = (
        f"{SYSTEM_PROMPT}\n\n{EDIT_INSTRUCTIONS}\n\n"
        "When retrieved evidence materially supports an answer, cite its identifier exactly as "
        "[SOURCE kind:key#chunk].\n\n"
        f"--- PROJECT SUMMARY ---\n{context}\n\n--- RETRIEVED EVIDENCE ---\n{evidence}\n\n"
        f"--- EDITABLE PLAN (JSON) ---\n{plan_json}{omitted_note}"
    )
    messages: list[Any] = [SystemMessage(content=system)]
    for turn in (history or [])[-6:]:
        role = turn.get("role")
        content = str(turn.get("content", ""))[:1500]
        if role == "user" and content:
            messages.append(HumanMessage(content=content))
        elif role == "assistant" and content:
            messages.append(AIMessage(content=content))
    messages.append(HumanMessage(content=message[:2000]))

    last_exc: Exception | None = None
    for model_name in dict.fromkeys((FAST_MODEL, SECONDARY_MODEL)):
        model = get_chat_model(model=model_name, temperature=0.3, max_tokens=3000)
        if "gpt-oss" in model_name:
            model = model.bind(reasoning_effort="low")
        try:
            response = await model.ainvoke(messages)
        except Exception as exc:
            last_exc = exc
            logger.warning("Flowmate on %s failed: %s", model_name, str(exc)[:200])
            continue
        command = _parse_command(str(response.content))
        for edit in command.edits:
            edit.path = _repair_path(project, edit.path)
        return command
    raise RuntimeError(f"assistant unavailable: {last_exc}")
