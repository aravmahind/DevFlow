"""Centralized typed project state for the DEVFLOW LangGraph orchestrator.

This is the single state object that flows through the entire LangGraph graph.
Every agent reads from and writes to this state. LangGraph's checkpointer
persists it to PostgreSQL after every node execution, enabling:
  - Human-in-the-loop pause/resume
  - Crash recovery
  - Iterative re-planning from any checkpoint

Design decisions:
  - TypedDict (not Pydantic) because LangGraph state graphs require TypedDict.
  - All fields are optional (total=False) because the state is built up
    progressively as agents complete.
  - Agent outputs are stored as plain dicts (serialized Pydantic models) so the
    state is JSON-serializable for the checkpointer.
"""
from __future__ import annotations

from typing import Any, Literal, TypedDict


# ── Workflow phase and status literals ──────────────────────────────────────

Phase = Literal[
    "requirements",
    "architecture",
    "sprint_planning",
    "execution",
    "sprint_review",
    "complete",
]

WorkflowStatus = Literal[
    "running",
    "awaiting_approval",
    "complete",
    "failed",
]


# ── Sub-state types (plain TypedDicts for clarity) ──────────────────────────

class ApprovalRecord(TypedDict, total=False):
    """Record of a single human approval decision."""
    approved: bool
    feedback: str
    timestamp: str


class ManagerFeedbackEntry(TypedDict, total=False):
    """A single piece of manager feedback tied to a phase."""
    phase: str
    feedback: str
    timestamp: str


class TeamMemberRecord(TypedDict, total=False):
    """A team member's profile for task allocation."""
    id: str
    name: str
    role: str
    skills: list[str]
    availability_pct: int   # 0-100, percentage of time available
    current_workload: int   # number of currently assigned tasks
    experience_level: str   # junior, mid, senior, lead


class TaskAssignment(TypedDict, total=False):
    """An assignment of a task to a team member with reasoning."""
    task_title: str
    assignee_id: str
    assignee_name: str
    reason: str             # why this person was chosen


class SprintReviewRecord(TypedDict, total=False):
    """Record of a sprint review outcome."""
    sprint_number: int
    completed_tasks: list[str]
    incomplete_tasks: list[str]
    manager_notes: str
    decision: str           # "next_sprint" | "replan" | "complete"
    timestamp: str


# ── The main ProjectState ───────────────────────────────────────────────────

class ProjectState(TypedDict, total=False):
    """The centralized state object for the DEVFLOW LangGraph orchestrator.

    This state is:
    - Passed through every node in the LangGraph graph.
    - Automatically checkpointed to PostgreSQL after every node.
    - Resumable from any checkpoint after human approval or crash.
    """

    # ─── Identity ───────────────────────────────────────────────────────────
    project_id: str
    idea: str
    title: str

    # ─── Workflow Control ───────────────────────────────────────────────────
    current_phase: Phase
    workflow_status: WorkflowStatus

    # ─── Agent Outputs (plain dicts from Pydantic .model_dump()) ────────────
    requirements: dict[str, Any]              # RequirementsBundle output
    architecture: dict[str, Any]              # ArchitectureBundle output
    backlog: dict[str, Any]                   # SprintPlan + allocation output
    github_progress: dict[str, Any]           # GitHub monitoring data
    risks: dict[str, Any]                     # RiskBundle output
    deployment_recommendations: dict[str, Any]  # Deployment advisor output

    # ─── Team & Allocation ──────────────────────────────────────────────────
    team_members: list[TeamMemberRecord]
    assignments: list[TaskAssignment]

    # ─── Human-in-the-Loop ──────────────────────────────────────────────────
    approvals: dict[str, ApprovalRecord]      # { phase_name: ApprovalRecord }
    manager_feedback: list[ManagerFeedbackEntry]
    pending_approval: str | None              # which phase is waiting

    # ─── Sprint Tracking ────────────────────────────────────────────────────
    current_sprint: int
    sprint_history: list[SprintReviewRecord]

    # ─── Error Tracking ─────────────────────────────────────────────────────
    error: str | None
