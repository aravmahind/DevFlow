"""Sprint Planner Agent prompt — backlog, task allocation, and timeline (merged).

This agent replaces the previous sprint_planner + team_allocation + timeline
agents. It produces a unified delivery plan including:
  - Epics and tasks with estimates and dependencies
  - Task-to-role allocation with reasoning
  - Sprint organization
  - Milestones and timeline
  - Recommended team roles
"""
from __future__ import annotations

from typing import Any

from prompts.context import build_base_context

SYSTEM_PROMPT = (
    "You are an expert Agile Delivery Lead, Scrum Master, and Resource Planner. "
    "Your job is to convert confirmed requirements and architecture into a complete, "
    "executable delivery plan.\n\n"
    "You must produce ALL of the following in a single output:\n\n"
    "1. BACKLOG:\n"
    "   - 3-6 epics grouping related work\n"
    "   - 10-18 tasks, each with: title, description, category, epic, estimated_days, "
    "     story_points (Fibonacci: 1,2,3,5,8,13), priority, sprint number, dependencies, "
    "     definition_of_done\n\n"
    "2. TASK ALLOCATION (for each task):\n"
    "   - required_skills: What skills are needed\n"
    "   - assigned_to: Which role/team member should do this task\n"
    "   - assignment_reason: WHY this person/role was chosen, considering:\n"
    "     * Required skills match\n"
    "     * Current workload balance\n"
    "     * Experience level appropriateness\n"
    "     * Task priority and dependencies\n\n"
    "3. SPRINT ORGANIZATION:\n"
    "   - Organize tasks into sequential sprints (2-week cadence by default)\n"
    "   - Each sprint has a clear, measurable goal\n"
    "   - Front-load foundational architecture and high-risk items\n"
    "   - Keep velocity realistic for the team size\n\n"
    "4. TIMELINE:\n"
    "   - 4-7 milestones spanning mvp → beta → production → scaling\n"
    "   - Each milestone has: title, phase, start_week, duration_weeks, deliverables, dependencies\n"
    "   - total_duration_weeks consistent with the requirements estimate\n"
    "   - critical_path: the sequence of tasks/milestones that determine the project end date\n\n"
    "5. TEAM ROLES:\n"
    "   - recommended_roles: 4-8 roles needed to deliver this project\n"
    "   - Each role: title, seniority, count, skills, responsibilities, allocation_pct\n"
    "   - staffing_notes: Overall staffing strategy\n\n"
    "IMPORTANT: The allocation must be CONSISTENT with the recommended roles. If you "
    "recommend 'Senior Backend Engineer', tasks assigned to that role must list skills "
    "that match. Every task must have an assigned_to value.\n\n"
    "If the manager provides feedback, adjust the plan accordingly while explaining "
    "what changed and why."
)


def build_user_prompt(ctx: dict[str, Any]) -> str:
    context = build_base_context(ctx, include=["executive", "requirements", "architecture"])

    parts = [
        f'Project: "{ctx.get("idea", "")}"',
        "",
        context,
    ]

    # Include team members if available
    team_members = ctx.get("team_members", [])
    if team_members:
        import json
        team_summary = json.dumps(team_members, default=str)[:1500]
        parts.append(f"\nRegistered Team Members:\n{team_summary}")
        parts.append(
            "\nAllocate tasks to these specific team members based on their skills "
            "and availability. Provide clear reasoning for each assignment."
        )
    else:
        parts.append(
            "\nNo specific team members are registered yet. Assign tasks to "
            "recommended ROLES (e.g., 'Senior Backend Engineer') instead of names."
        )

    # Include manager feedback if this is a re-run
    feedback = ctx.get("manager_feedback")
    if feedback:
        parts.append(
            f'\n\nMANAGER FEEDBACK (you MUST address these changes):\n"{feedback}"'
        )

    # Include prior backlog if refining
    prior = ctx.get("prior_backlog")
    if prior:
        import json
        compact = json.dumps(prior, default=str, ensure_ascii=False)[:3000]
        parts.append(f"\nPREVIOUS PLAN (refine based on feedback above):\n{compact}")

    parts.append(
        "\n\nProduce the complete delivery plan: epics, tasks (with allocation), "
        "sprints, milestones, recommended_roles, and staffing_notes."
    )

    return "\n".join(parts)