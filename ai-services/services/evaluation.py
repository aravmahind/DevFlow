"""Deterministic specialist quality gates applied before optional LLM review."""
from __future__ import annotations

from typing import Any


def _count(data: dict[str, Any], key: str) -> int:
    value = data.get(key)
    return len(value) if isinstance(value, list) else 0


# The graph's agent ids differ from the gate names these checks were written
# against; without this map the gates for the live agents never ran.
_GATE_FOR_AGENT = {
    "requirement_agent": "product_manager",
    "architect_agent": "architect",
    "sprint_planner_agent": "sprint_planner",
    "risk_agent": "risk",
}


def evaluate_agent_output(agent_id: str, data: dict[str, Any]) -> tuple[list[str], dict[str, Any]]:
    agent_id = _GATE_FOR_AGENT.get(agent_id, agent_id)
    issues: list[str] = []
    metrics: dict[str, Any] = {}

    if agent_id == "ceo":
        for key, minimum in (("business_goals", 3), ("success_criteria", 3), ("key_decisions", 3)):
            metrics[key] = _count(data, key)
            if metrics[key] < minimum:
                issues.append(f"Add at least {minimum} concrete {key.replace('_', ' ')}.")
        if len(str(data.get("overview", ""))) < 120:
            issues.append("Make the project overview specific and at least two substantive sentences.")

    elif agent_id == "product_manager":
        gates = (("functional_requirements", 6), ("non_functional_requirements", 4), ("user_stories", 5))
        for key, minimum in gates:
            metrics[key] = _count(data, key)
            if metrics[key] < minimum:
                issues.append(f"Provide at least {minimum} {key.replace('_', ' ')}.")
        stories = data.get("user_stories") or []
        weak = sum(1 for story in stories if not story.get("acceptance_criteria"))
        metrics["stories_without_acceptance_criteria"] = weak
        if weak:
            issues.append("Give every user story testable Given/When/Then acceptance criteria.")

    elif agent_id == "architect":
        incomplete = []
        for layer in ("frontend", "backend", "database", "infrastructure"):
            value = data.get(layer) or {}
            if not value.get("components") or not value.get("technologies") or not value.get("decisions"):
                incomplete.append(layer)
        metrics["complete_layers"] = 4 - len(incomplete)
        if incomplete:
            issues.append(f"Add components, technologies, and justified decisions for: {', '.join(incomplete)}.")
        if _count(data, "scalability_plan") < 3:
            issues.append("Provide at least three concrete scalability measures.")

    elif agent_id == "sprint_planner":
        tasks = data.get("tasks") or []
        sprints = data.get("sprints") or []
        metrics.update(tasks=len(tasks), sprints=len(sprints), epics=_count(data, "epics"))
        if len(tasks) < 10:
            issues.append("Break the plan into at least 10 independently shippable tasks.")
        if len(sprints) < 3:
            issues.append("Plan at least three sequenced delivery sprints.")
        task_titles = {task.get("title") for task in tasks}
        invalid_refs = [
            title for sprint in sprints for title in (sprint.get("task_titles") or [])
            if title not in task_titles
        ]
        metrics["invalid_sprint_task_references"] = len(invalid_refs)
        if invalid_refs:
            issues.append("Make every sprint task_titles entry exactly match a real task title.")

    elif agent_id == "risk":
        risks = data.get("risks") or []
        metrics["risks"] = len(risks)
        categories = {risk.get("category") for risk in risks}
        metrics["risk_categories"] = len(categories)
        if len(risks) < 5:
            issues.append("Identify at least five material risks with concrete mitigations.")
        if len(categories) < 4:
            issues.append("Cover at least four distinct technical, product, delivery, security, or scalability categories.")

    elif agent_id == "team_allocation":
        members = data.get("members") or []
        metrics["roles"] = len(members)
        if len(members) < 3:
            issues.append("Define at least three accountable delivery roles.")
        if any(not member.get("responsibilities") or not member.get("owns_area") for member in members):
            issues.append("Give every role explicit responsibilities and an owned delivery area.")

    elif agent_id == "timeline":
        milestones = data.get("milestones") or []
        metrics["milestones"] = len(milestones)
        if len(milestones) < 3:
            issues.append("Provide at least three delivery milestones.")
        if any(not item.get("go_no_go_criteria") for item in milestones):
            issues.append("Give every milestone measurable go/no-go criteria.")

    elif agent_id == "integration":
        integrations = data.get("integrations") or []
        metrics["integrations"] = len(integrations)
        if len(integrations) < 3:
            issues.append("Specify at least three concrete integrations or platform services.")
        if any(not item.get("auth_method") or not item.get("rollback_steps") for item in integrations):
            issues.append("Document authentication and rollback steps for every integration.")
        if _count(data, "deployment_plan") < 3 or _count(data, "cicd_recommendations") < 3:
            issues.append("Provide detailed deployment and CI/CD runbooks.")

    return issues[:5], metrics
