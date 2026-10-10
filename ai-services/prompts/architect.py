"""System Architect Agent prompt — architecture across all layers.

Updated for v2: Added requirement to explain decisions in simple terms
for non-technical managers, and to provide an architecture_rationale field.
"""
from __future__ import annotations

from typing import Any

from prompts.context import build_base_context

SYSTEM_PROMPT = (
    "You are a principal System Architect. Design a pragmatic, production-grade architecture "
    "for the product across four layers: frontend, backend, database, and infrastructure.\n\n"
    "For each layer give a summary, the key components, the recommended technologies, the "
    "important architectural decisions (and why), and key_entities (primary data models, schemas, "
    "or API endpoints relevant to that layer).\n\n"
    "Provide overall technology recommendations, a concrete scalability plan, and integration points. "
    "Provide data_flows: 5-10 directed edges showing how requests and data move between components, "
    "each {\"source\", \"target\", \"label\"} where source and target are component names copied exactly "
    "from the layers' components lists and label is what flows (e.g. 'REST/JSON', 'SQL queries', 'events'). "
    "Favor proven, modern, well-supported technologies. Keep choices internally consistent across layers. "
    "Commit to ONE specific technology per concern — pick a single frontend framework, a single primary database, etc. "
    "Never list alternatives like 'React, Angular, Vue' or 'MySQL, PostgreSQL'; decide and recommend the one you would build with.\n\n"
    "IMPORTANT: The project manager reviewing this architecture may NOT be a technical expert.\n"
    "- Explain each technology choice in simple terms (what it does, why it was chosen)\n"
    "- Avoid unexplained acronyms\n"
    "- Provide an 'architecture_rationale' field: a 3-5 sentence plain-language explanation of "
    "  why this architecture was chosen and how it serves the project's goals\n\n"
    "Respect all confirmed requirements from upstream."
)


def build_user_prompt(ctx: dict[str, Any]) -> str:
    context = build_base_context(ctx, include=["executive", "requirements"])

    # Extract key decisions from requirements (replaces old CEO key_decisions)
    reqs = ctx.get("requirements", {})
    decisions = []
    if isinstance(reqs, dict):
        decisions = reqs.get("key_differentiators", [])

    decisions_block = ""
    if decisions:
        decisions_block = (
            "\n\nKey Product Differentiators (architecture must support these):\n"
            + "\n".join(f"- {d}" for d in decisions)
        )

    # Include manager feedback if this is a re-run
    feedback = ctx.get("manager_feedback")
    feedback_block = ""
    if feedback:
        feedback_block = (
            f'\n\nMANAGER FEEDBACK (you MUST address these changes):\n"{feedback}"'
        )

    prior_block = ""
    prior = ctx.get("prior_architecture")
    if prior:
        import json
        compact = json.dumps(prior, default=str, ensure_ascii=False)[:3000]
        prior_block = f"\nPREVIOUS ARCHITECTURE (refine based on feedback):\n{compact}"

    return (
        f"Project: \"{ctx.get('idea', '')}\"\n\n"
        f"{context}{decisions_block}{feedback_block}{prior_block}\n\n"
        "Design the full architecture. Include an 'architecture_rationale' explaining "
        "in plain language why this design was chosen. Ensure the database layer lists "
        "main data entities, the backend lists services/modules and API routes, the "
        "frontend lists major UI surfaces, and infrastructure covers hosting and CI/CD."
    )