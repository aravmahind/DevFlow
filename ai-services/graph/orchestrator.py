"""DEVFLOW LangGraph Orchestrator — the stateful, iterative workflow engine.

Replaces the old linear ``workflows/engine.py`` with a LangGraph StateGraph that
supports human-in-the-loop approval, feedback loops, and iterative re-planning.

Architecture:
    Requirement Agent → [Human Approval] → Architect Agent → [Human Approval]
    → Sprint Planner Agent → [Human Approval] → GitHub Monitor → Risk Agent
    → Deployment Advisor → [Sprint Review] → (Re-plan | Next Sprint | Complete)

Key design decisions:
  - ``interrupt_before`` is used at approval nodes so LangGraph pauses execution,
    persists state to PostgreSQL, and waits for the manager to approve/reject.
  - Each agent node is a thin wrapper that: (1) reads relevant upstream state,
    (2) runs the agent's LangChain pipeline, (3) writes the output back to state.
  - Conditional edges route between "approved → next agent" and "changes → same agent".
  - The graph is compiled once at module load and reused for all projects (each
    project gets its own ``thread_id`` for state isolation via the checkpointer).
"""
from __future__ import annotations

import json
import time
from datetime import datetime, timezone
from typing import Any

from langgraph.graph import END, StateGraph

from agents.base import Agent
from agents.registry import get_agent, AGENTS
from llm.router import resolve
from state.project_state import ProjectState
from utils.logging import get_logger
from workflows.events import EventEmitter

logger = get_logger("graph.orchestrator")


# ── Utility: Get current timestamp ──────────────────────────────────────────

def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── Agent runner nodes ──────────────────────────────────────────────────────
# Each function is a LangGraph node. It reads from ProjectState, runs the
# agent, and returns a partial state update dict.

async def run_requirement_agent(state: ProjectState) -> dict[str, Any]:
    """Run the Requirement Agent and write structured requirements to state."""
    agent = get_agent("requirement_agent")
    logger.info("▶ Running %s for project %s", agent.name, state.get("project_id"))

    # Build context from state for the agent
    ctx: dict[str, Any] = {
        "idea": state.get("idea", ""),
        "title": state.get("title"),
        "project_id": state.get("project_id"),
    }

    # If manager requested changes, include their feedback in the context
    feedback_entries = state.get("manager_feedback", [])
    req_feedback = [f for f in feedback_entries if f.get("phase") == "requirements"]
    if req_feedback:
        ctx["manager_feedback"] = req_feedback[-1].get("feedback", "")

    # If there are prior requirements (re-run), include them for refinement
    if state.get("requirements"):
        ctx["prior_requirements"] = state["requirements"]

    data = await agent.run(ctx)
    return {
        "requirements": data,
        "current_phase": "requirements",
        "workflow_status": "running",
    }


async def run_architect_agent(state: ProjectState) -> dict[str, Any]:
    """Run the Architect Agent using confirmed requirements."""
    agent = get_agent("architect_agent")
    logger.info("▶ Running %s for project %s", agent.name, state.get("project_id"))

    ctx: dict[str, Any] = {
        "idea": state.get("idea", ""),
        "title": state.get("title"),
        "project_id": state.get("project_id"),
        "requirements": state.get("requirements", {}),
    }

    feedback_entries = state.get("manager_feedback", [])
    arch_feedback = [f for f in feedback_entries if f.get("phase") == "architecture"]
    if arch_feedback:
        ctx["manager_feedback"] = arch_feedback[-1].get("feedback", "")

    if state.get("architecture"):
        ctx["prior_architecture"] = state["architecture"]

    data = await agent.run(ctx)
    return {
        "architecture": data,
        "current_phase": "architecture",
        "workflow_status": "running",
    }


async def run_sprint_planner_agent(state: ProjectState) -> dict[str, Any]:
    """Run the Sprint Planner Agent (backlog + allocation + timeline)."""
    agent = get_agent("sprint_planner_agent")
    logger.info("▶ Running %s for project %s", agent.name, state.get("project_id"))

    ctx: dict[str, Any] = {
        "idea": state.get("idea", ""),
        "title": state.get("title"),
        "project_id": state.get("project_id"),
        "requirements": state.get("requirements", {}),
        "architecture": state.get("architecture", {}),
        "team_members": state.get("team_members", []),
    }

    feedback_entries = state.get("manager_feedback", [])
    sprint_feedback = [f for f in feedback_entries if f.get("phase") == "sprint_planning"]
    if sprint_feedback:
        ctx["manager_feedback"] = sprint_feedback[-1].get("feedback", "")

    if state.get("backlog"):
        ctx["prior_backlog"] = state["backlog"]

    data = await agent.run(ctx)
    return {
        "backlog": data,
        "current_phase": "sprint_planning",
        "workflow_status": "running",
    }


async def run_github_monitor(state: ProjectState) -> dict[str, Any]:
    """Run the GitHub Monitor Agent to analyze development progress."""
    agent = get_agent("github_monitor")
    logger.info("▶ Running %s for project %s", agent.name, state.get("project_id"))

    ctx: dict[str, Any] = {
        "idea": state.get("idea", ""),
        "project_id": state.get("project_id"),
        "backlog": state.get("backlog", {}),
        "current_sprint": state.get("current_sprint", 1),
    }

    data = await agent.run(ctx)
    return {
        "github_progress": data,
        "current_phase": "execution",
        "workflow_status": "running",
    }


async def run_risk_agent(state: ProjectState) -> dict[str, Any]:
    """Run the Risk Agent consuming all available project context."""
    agent = get_agent("risk_agent")
    logger.info("▶ Running %s for project %s", agent.name, state.get("project_id"))

    ctx: dict[str, Any] = {
        "idea": state.get("idea", ""),
        "project_id": state.get("project_id"),
        "requirements": state.get("requirements", {}),
        "architecture": state.get("architecture", {}),
        "backlog": state.get("backlog", {}),
        "github_progress": state.get("github_progress", {}),
        "current_sprint": state.get("current_sprint", 1),
    }

    data = await agent.run(ctx)
    return {
        "risks": data,
        "workflow_status": "running",
    }


async def run_deployment_advisor(state: ProjectState) -> dict[str, Any]:
    """Run the Deployment Advisor (recommendations only, no actual deployment)."""
    agent = get_agent("deployment_advisor")
    logger.info("▶ Running %s for project %s", agent.name, state.get("project_id"))

    ctx: dict[str, Any] = {
        "idea": state.get("idea", ""),
        "project_id": state.get("project_id"),
        "requirements": state.get("requirements", {}),
        "architecture": state.get("architecture", {}),
        "backlog": state.get("backlog", {}),
        "risks": state.get("risks", {}),
    }

    data = await agent.run(ctx)
    return {
        "deployment_recommendations": data,
        "workflow_status": "running",
    }


# ── Approval gate nodes ────────────────────────────────────────────────────
# These nodes simply set the ``pending_approval`` field. When LangGraph hits
# the ``interrupt_before`` on these nodes, execution pauses. The manager's
# decision is written to state via ``graph.aupdate_state()``, and execution
# resumes.

async def await_req_approval(state: ProjectState) -> dict[str, Any]:
    """Pause for manager to review requirements."""
    return {
        "pending_approval": "requirements",
        "workflow_status": "awaiting_approval",
    }


async def await_arch_approval(state: ProjectState) -> dict[str, Any]:
    """Pause for manager to review architecture."""
    return {
        "pending_approval": "architecture",
        "workflow_status": "awaiting_approval",
    }


async def await_sprint_approval(state: ProjectState) -> dict[str, Any]:
    """Pause for manager to review sprint plan."""
    return {
        "pending_approval": "sprint_planning",
        "workflow_status": "awaiting_approval",
    }


async def await_sprint_review(state: ProjectState) -> dict[str, Any]:
    """Pause for sprint review after execution phase."""
    return {
        "pending_approval": "sprint_review",
        "workflow_status": "awaiting_approval",
    }


# ── Conditional routing functions ───────────────────────────────────────────

def route_after_req_approval(state: ProjectState) -> str:
    """Route after requirement approval: approved → architect, changes → re-run."""
    approvals = state.get("approvals", {})
    req_approval = approvals.get("requirements", {})
    if req_approval.get("approved", False):
        return "approved"
    return "changes"


def route_after_arch_approval(state: ProjectState) -> str:
    """Route after architecture approval."""
    approvals = state.get("approvals", {})
    arch_approval = approvals.get("architecture", {})
    if arch_approval.get("approved", False):
        return "approved"
    return "changes"


def route_after_sprint_approval(state: ProjectState) -> str:
    """Route after sprint plan approval."""
    approvals = state.get("approvals", {})
    sprint_approval = approvals.get("sprint_planning", {})
    if sprint_approval.get("approved", False):
        return "approved"
    return "changes"


def route_sprint_review(state: ProjectState) -> str:
    """Route after sprint review: replan, next sprint, or complete."""
    approvals = state.get("approvals", {})
    review = approvals.get("sprint_review", {})

    if not review.get("approved", False):
        # Manager wants changes — go back to sprint planner
        return "replan"

    feedback = review.get("feedback", "").lower()
    if "complete" in feedback or "done" in feedback:
        return "complete"

    # Default: proceed to next sprint cycle
    return "next_sprint"


async def mark_complete(state: ProjectState) -> dict[str, Any]:
    """Terminal node: mark project as complete."""
    return {
        "workflow_status": "complete",
        "current_phase": "complete",
        "pending_approval": None,
    }


async def increment_sprint(state: ProjectState) -> dict[str, Any]:
    """Increment the sprint counter before starting the next cycle."""
    current = state.get("current_sprint", 1)
    return {
        "current_sprint": current + 1,
        "pending_approval": None,
        "workflow_status": "running",
    }


# ── Build the graph ─────────────────────────────────────────────────────────

def build_orchestrator_graph() -> StateGraph:
    """Build and return the (uncompiled) DEVFLOW orchestrator graph.

    The caller is responsible for compiling it with a checkpointer:
        graph = build_orchestrator_graph()
        compiled = graph.compile(checkpointer=..., interrupt_before=[...])
    """
    graph = StateGraph(ProjectState)

    # ── Agent nodes ──
    graph.add_node("requirement_agent", run_requirement_agent)
    graph.add_node("architect_agent", run_architect_agent)
    graph.add_node("sprint_planner_agent", run_sprint_planner_agent)
    graph.add_node("github_monitor", run_github_monitor)
    graph.add_node("risk_agent", run_risk_agent)
    graph.add_node("deployment_advisor", run_deployment_advisor)

    # ── Approval gate nodes ──
    graph.add_node("await_req_approval", await_req_approval)
    graph.add_node("await_arch_approval", await_arch_approval)
    graph.add_node("await_sprint_approval", await_sprint_approval)
    graph.add_node("await_sprint_review", await_sprint_review)

    # ── Utility nodes ──
    graph.add_node("mark_complete", mark_complete)
    graph.add_node("increment_sprint", increment_sprint)

    # ── Entry point ──
    graph.set_entry_point("requirement_agent")

    # ── Edges: Requirement → Approval → Architect ──
    graph.add_edge("requirement_agent", "await_req_approval")
    graph.add_conditional_edges(
        "await_req_approval",
        route_after_req_approval,
        {"approved": "architect_agent", "changes": "requirement_agent"},
    )

    # ── Edges: Architect → Approval → Sprint Planner ──
    graph.add_edge("architect_agent", "await_arch_approval")
    graph.add_conditional_edges(
        "await_arch_approval",
        route_after_arch_approval,
        {"approved": "sprint_planner_agent", "changes": "architect_agent"},
    )

    # ── Edges: Sprint Planner → Approval → Execution Phase ──
    graph.add_edge("sprint_planner_agent", "await_sprint_approval")
    graph.add_conditional_edges(
        "await_sprint_approval",
        route_after_sprint_approval,
        {"approved": "github_monitor", "changes": "sprint_planner_agent"},
    )

    # ── Edges: Execution chain ──
    graph.add_edge("github_monitor", "risk_agent")
    graph.add_edge("risk_agent", "deployment_advisor")
    graph.add_edge("deployment_advisor", "await_sprint_review")

    # ── Edges: Sprint Review → Re-plan / Next Sprint / Complete ──
    graph.add_conditional_edges(
        "await_sprint_review",
        route_sprint_review,
        {
            "replan": "sprint_planner_agent",
            "next_sprint": "increment_sprint",
            "complete": "mark_complete",
        },
    )

    graph.add_edge("increment_sprint", "github_monitor")
    graph.add_edge("mark_complete", END)

    return graph


# ── Compiled graph singleton ────────────────────────────────────────────────
# The compiled graph is created lazily on first use so the checkpointer
# can be initialized asynchronously.

_compiled_graph = None


async def get_compiled_graph():
    """Get or create the compiled orchestrator graph with checkpointing."""
    global _compiled_graph
    if _compiled_graph is not None:
        return _compiled_graph

    from graph.checkpointer import get_checkpointer

    checkpointer = await get_checkpointer()
    graph = build_orchestrator_graph()

    _compiled_graph = graph.compile(
        checkpointer=checkpointer,
        interrupt_before=[
            "await_req_approval",
            "await_arch_approval",
            "await_sprint_approval",
            "await_sprint_review",
        ],
    )

    logger.info("LangGraph orchestrator compiled with %d nodes", len(graph.nodes))
    return _compiled_graph
