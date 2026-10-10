"""Deterministic auto-assignment of backlog tasks to project members.

Each task goes to the member whose role and specialization best fit the task's
category and required skills; ties go to whoever has the least work assigned
so far (by estimated days), so load stays balanced. Testers take QA work,
developers everything else; managers are only used when nobody else is on
the project.
"""
from __future__ import annotations

import re
from typing import Any

# Specialization -> task categories / keywords it covers.
_SPECIALIZATION_AREAS: dict[str, set[str]] = {
    "frontend": {"frontend", "ui", "ux", "web", "client", "react", "css"},
    "backend": {"backend", "api", "server", "database", "db", "auth", "integration"},
    "full stack": {"frontend", "backend", "api", "ui", "web", "fullstack"},
    "mobile": {"mobile", "ios", "android", "app"},
    "devops": {"infra", "infrastructure", "devops", "deployment", "ci", "cd", "cloud", "docker", "kubernetes"},
    "security": {"security", "auth", "compliance", "encryption"},
    "data engineering": {"data", "etl", "pipeline", "analytics", "database", "warehouse"},
    "machine learning": {"ai", "ml", "model", "llm", "nlp", "recommendation"},
    "qa automation": {"qa", "test", "testing", "e2e", "automation"},
    "manual testing": {"qa", "test", "testing", "uat"},
    "performance testing": {"qa", "performance", "load", "testing"},
}
_QA = {"qa", "test", "testing", "uat", "e2e"}


def _words(*values: Any) -> set[str]:
    text = " ".join(" ".join(v) if isinstance(v, list) else str(v or "") for v in values)
    return set(re.findall(r"[a-z0-9#+]+", text.lower()))


def _fit(member: dict[str, Any], task_words: set[str]) -> int:
    spec = str(member.get("specialization") or "").strip().lower()
    if not spec:
        return 0
    areas = _SPECIALIZATION_AREAS.get(spec)
    if areas is not None:
        return 3 * len(areas & task_words)
    # Language specializations (Python, TypeScript, ...) match required skills.
    return 3 if spec in task_words else 0


def _name(member: dict[str, Any]) -> str:
    full = f"{member.get('first_name', '')} {member.get('last_name', '')}".strip()
    return full or member.get("email") or member["user_id"]


def auto_assign(
    tasks: list[dict[str, Any]], members: list[dict[str, Any]], *, overwrite: bool = False,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Return (updated tasks, assignments made). Tasks already assigned to a
    current member are kept unless ``overwrite``."""
    pool = [m for m in members if m.get("role") != "manager"] or list(members)
    if not pool:
        return tasks, []
    member_ids = {m["user_id"] for m in members}
    load: dict[str, float] = {m["user_id"]: 0.0 for m in pool}

    def days(task: dict[str, Any]) -> float:
        try:
            return max(0.5, float(task.get("estimated_days") or 1))
        except (TypeError, ValueError):
            return 1.0

    updated = [dict(t) for t in tasks]
    pending: list[int] = []
    for i, task in enumerate(updated):
        if not overwrite and task.get("assignee_id") in member_ids:
            if task["assignee_id"] in load:
                load[task["assignee_id"]] += days(task)
            continue
        if str(task.get("status") or "").lower() in ("done", "complete", "completed"):
            continue
        pending.append(i)

    # Big tasks first, so balancing has room to even out with small ones.
    pending.sort(key=lambda i: -days(updated[i]))
    made: list[dict[str, Any]] = []
    for i in pending:
        task = updated[i]
        task_words = _words(task.get("category"), task.get("required_skills"),
                            task.get("assigned_to"), task.get("title"))
        is_qa = bool(_QA & _words(task.get("category"))) or bool(_QA & _words(task.get("assigned_to")))
        preferred = [m for m in pool if (m.get("role") == "tester") == is_qa] or pool
        best = max(
            preferred,
            key=lambda m: (_fit(m, task_words), -load[m["user_id"]]),
        )
        fit = _fit(best, task_words)
        load[best["user_id"]] += days(task)
        task["assignee_id"] = best["user_id"]
        reason = (f"matches {best.get('specialization')} for {task.get('category') or 'this task'}"
                  if fit else "best available capacity")
        task["assignment_reason"] = f"Auto-assigned to {_name(best)}: {reason}."
        made.append({"task_index": i, "title": task.get("title"), "assignee_id": best["user_id"],
                     "assignee": _name(best), "reason": reason})
    made.sort(key=lambda a: a["task_index"])
    return updated, made
