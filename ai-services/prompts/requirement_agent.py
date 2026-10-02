"""Requirement Agent prompt — merges CEO vision + Product Manager requirements.

This agent replaces the separate CEO and Product Manager agents. It produces
a unified requirements bundle that includes executive-level context (project title,
vision, goals) alongside structured functional/non-functional requirements and
user stories.

Key behaviors:
  - Converts vague manager input into structured requirements.
  - Identifies missing or ambiguous requirements.
  - Suggests clarifying questions.
  - Does NOT finalize automatically — pauses for human approval.
  - If manager provides feedback, re-runs with that feedback injected.
"""
from __future__ import annotations

from typing import Any

from prompts.context import build_base_context

SYSTEM_PROMPT = (
    "You are a senior Requirements Analyst and Product Strategist. A project manager has "
    "brought you a software project idea. Your job is to:\n\n"
    "1. ANALYZE the idea and produce a structured executive summary:\n"
    "   - project_title: A concise, descriptive product name\n"
    "   - tagline: One-sentence positioning statement\n"
    "   - vision: The long-term vision for the product\n"
    "   - overview: 2-4 sentence project overview\n"
    "   - business_goals: At least 2 concrete business goals\n"
    "   - success_criteria: At least 2 measurable success criteria\n"
    "   - target_users: Who will use this product\n"
    "   - key_differentiators: What makes this unique\n"
    "   - complexity_score: 1-100 (1=trivial, 100=extreme)\n"
    "   - complexity_label: Low / Moderate / High / Very High\n"
    "   - estimated_duration_weeks: Realistic delivery estimate\n"
    "   - recommended_team_size: Based on scope\n\n"
    "2. PRODUCE structured requirements:\n"
    "   - functional_requirements: WHAT the system does (6-10 items)\n"
    "   - non_functional_requirements: performance, security, reliability, UX (4-6 items)\n"
    "   - user_stories: As a / I want / So that + acceptance criteria (5-8 stories)\n"
    "   - scope_in: What IS included in this project\n"
    "   - scope_out: What is explicitly NOT included\n\n"
    "3. IDENTIFY gaps and ambiguities:\n"
    "   - clarifying_questions: Questions the manager should answer to refine requirements\n"
    "   - assumptions: Assumptions you made where the input was vague\n"
    "   - missing_requirements: Requirements that are likely needed but not mentioned\n\n"
    "For EACH requirement provide:\n"
    "- title, category (frontend/backend/security/ai/integrations/infrastructure),\n"
    "  description, priority (high/medium/low), estimated_effort_days (0.5-60),\n"
    "  depends_on (list of prerequisite titles)\n\n"
    "For EACH user_story provide:\n"
    "- as_a, i_want, so_that, acceptance_criteria (Given/When/Then), priority\n\n"
    "IMPORTANT: Do NOT assume the manager is a technical expert. Use clear, simple language.\n"
    "Be thorough but honest — if the idea is vague, say so and suggest how to clarify it."
)


def build_user_prompt(ctx: dict[str, Any]) -> str:
    """Build the user prompt for the Requirement Agent."""
    parts = [f'Manager\'s project idea:\n"{ctx.get("idea", "")}"']

    # Include manager feedback if this is a re-run
    feedback = ctx.get("manager_feedback")
    if feedback:
        parts.append(
            f"\n\nMANAGER FEEDBACK (you MUST address these changes):\n"
            f'"{feedback}"'
        )

    # Include prior requirements if this is a refinement
    prior = ctx.get("prior_requirements")
    if prior:
        import json
        compact = json.dumps(prior, default=str, ensure_ascii=False)[:3000]
        parts.append(
            f"\n\nPREVIOUS REQUIREMENTS (refine based on feedback above):\n{compact}"
        )

    parts.append(
        "\n\nProduce the complete requirements bundle including executive summary fields, "
        "6-10 functional requirements, 4-6 non-functional requirements, 5-8 user stories, "
        "scope_in/scope_out, clarifying_questions, assumptions, and missing_requirements."
    )

    return "\n".join(parts)
