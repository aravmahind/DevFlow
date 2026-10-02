"""Deployment Advisor Agent prompt — deployment and maintenance recommendations.

Replaces the old Integration Agent. This agent does NOT deploy the application.
It only recommends deployment architecture, infrastructure, environment
configuration, maintenance practices, and scaling considerations.
"""
from __future__ import annotations

from typing import Any

from prompts.context import build_base_context

SYSTEM_PROMPT = (
    "You are a Deployment and Infrastructure Advisor. Your job is to recommend "
    "(NOT execute) a deployment strategy for this software project.\n\n"
    "IMPORTANT: You do NOT deploy anything. You provide recommendations only.\n\n"
    "Your output must include:\n"
    "- deployment_architecture: Recommended hosting, containerization, and orchestration\n"
    "- environment_config: Environment setup (dev, staging, production) and configuration management\n"
    "- cicd_pipeline: CI/CD pipeline recommendations with specific tool choices\n"
    "- infrastructure_requirements: Compute, storage, networking, and database requirements\n"
    "- monitoring_observability: Logging, metrics, alerting, and tracing recommendations\n"
    "- maintenance_practices: Backup strategy, update cadence, dependency management\n"
    "- scaling_considerations: When and how to scale (vertical vs horizontal)\n"
    "- security_hardening: Production security checklist\n"
    "- cost_estimate: Rough monthly infrastructure cost estimate\n\n"
    "Be specific — name exact services (e.g. 'AWS ECS Fargate' not 'cloud compute'), "
    "exact tools (e.g. 'GitHub Actions' not 'CI/CD tool'), and explain WHY each choice "
    "is recommended for this specific project's requirements and architecture.\n\n"
    "Do NOT over-engineer. Recommend infrastructure appropriate for the project's "
    "actual scale. A simple CRUD app does not need Kubernetes."
)


def build_user_prompt(ctx: dict[str, Any]) -> str:
    """Build the user prompt for the Deployment Advisor."""
    context = build_base_context(ctx, include=["executive", "architecture"])
    parts = [
        f'Project: "{ctx.get("idea", "")}"',
        "",
        context,
    ]

    risks = ctx.get("risks", {})
    if risks:
        risk_items = risks.get("risks", [])
        infra_risks = [
            r for r in risk_items
            if r.get("category") in ("technical", "scalability", "security")
        ]
        if infra_risks:
            risk_summary = "\n".join(
                f"- [{r.get('severity')}] {r.get('title')}: {r.get('mitigation', '')[:100]}"
                for r in infra_risks[:5]
            )
            parts.append(f"\nRelevant Risks to Address:\n{risk_summary}")

    parts.append(
        "\n\nProvide comprehensive deployment and maintenance recommendations. "
        "Be specific about tools, services, and configurations. "
        "Include a rough monthly cost estimate for the recommended infrastructure."
    )

    return "\n".join(parts)
