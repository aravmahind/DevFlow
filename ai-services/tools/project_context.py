"""Agent-scoped project context retrieval (v2 — 6-agent roster).

Maps each agent to the upstream sections it depends on, so downstream
agents receive only what they need instead of the entire accumulated state.
"""
from __future__ import annotations

import json
from typing import Any

from langchain_core.tools import tool

DEPENDENCIES: dict[str, tuple[str, ...]] = {
    "requirement_agent": (),
    "architect_agent": ("requirements",),
    "sprint_planner_agent": ("requirements", "architecture"),
    "github_monitor": ("backlog",),
    "risk_agent": ("requirements", "architecture", "backlog", "github_progress"),
    "deployment_advisor": ("requirements", "architecture", "risks"),
}

_DERIVED_ARCHITECTURE_KEYS = {"diagram", "mermaid"}


def _pick(item: dict[str, Any], keys: tuple[str, ...]) -> dict[str, Any]:
    return {key: item.get(key) for key in keys if item.get(key) not in (None, "", [])}


def _compact_section(agent_id: str, key: str, value: Any) -> Any:
    """Keep decision-bearing fields while respecting provider prompt budgets."""
    if not isinstance(value, dict):
        return value
    if key == "executive_summary":
        return _pick(value, (
            "project_title", "vision", "business_goals", "success_criteria",
            "target_users", "key_decisions", "complexity_score",
            "estimated_duration_weeks", "recommended_team_size",
        ))
    if key == "requirements":
        req_keys = ("title", "category", "description", "priority", "estimated_effort_days", "depends_on")
        story_keys = ("as_a", "i_want", "so_that", "acceptance_criteria", "priority")
        limits = (8, 5, 5) if agent_id == "architect" else (10, 6, 4)
        return {
            "functional_requirements": [_pick(item, req_keys) for item in (value.get("functional_requirements") or [])[:limits[0]]],
            "non_functional_requirements": [_pick(item, req_keys) for item in (value.get("non_functional_requirements") or [])[:limits[1]]],
            "user_stories": [_pick(item, story_keys) for item in (value.get("user_stories") or [])[:limits[2]]],
            "scope_in": (value.get("scope_in") or [])[:10],
            "scope_out": (value.get("scope_out") or [])[:10],
        }
    if key == "architecture":
        layer_keys = ("summary", "components", "technologies", "decisions", "key_entities")
        result = {
            layer: _pick(value.get(layer) or {}, layer_keys)
            for layer in ("frontend", "backend", "database", "infrastructure")
        }
        result["technology_recommendations"] = (value.get("technology_recommendations") or [])[:8]
        result["scalability_plan"] = (value.get("scalability_plan") or [])[:8]
        result["integration_points"] = (value.get("integration_points") or [])[:8]
        return result
    if key == "backlog":
        task_keys = ("title", "category", "epic", "estimated_days", "story_points", "priority", "sprint", "dependencies")
        sprint_keys = ("number", "name", "goal", "task_titles")
        return {
            "methodology": value.get("methodology"),
            "sprint_length_weeks": value.get("sprint_length_weeks"),
            "tasks": [_pick(item, task_keys) for item in (value.get("tasks") or [])[:18]],
            "sprints": [_pick(item, sprint_keys) for item in (value.get("sprints") or [])[:8]],
        }
    return value


@tool
def select_project_context(agent_id: str, project_context: dict[str, Any]) -> str:
    """Return the authoritative project facts relevant to one specialist agent."""
    selected: dict[str, Any] = {
        "idea": str(project_context.get("idea", ""))[:2000],
        "title": project_context.get("title"),
    }
    for key in DEPENDENCIES.get(agent_id, ()):
        value = project_context.get(key)
        if key == "architecture" and isinstance(value, dict):
            value = {k: v for k, v in value.items() if k not in _DERIVED_ARCHITECTURE_KEYS}
        if value is not None:
            selected[key] = value
    result = json.dumps(selected, ensure_ascii=False, separators=(",", ":"), default=str)
    # Truncate to stay within free-tier TPM limits (~2500 chars ≈ 700 tokens)
    if len(result) > 2500:
        result = result[:2500] + '..."}'
    return result
