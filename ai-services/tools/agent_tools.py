"""Specialist tools for DEVFLOW agents (v2 — 6-agent roster).

Changes from v1:
  - Removed inter-agent consultation tools (agents no longer call each other
    directly; all coordination flows through the LangGraph orchestrator).
  - Remapped tools to the 6 new agent IDs.
  - Added GitHub analysis tools for the new github_monitor agent.
"""
from __future__ import annotations

import json
from typing import Any

from langchain_core.tools import tool

from tools.knowledge_databases import (
    AGILE_VELOCITY_DATABASE,
    ARCHITECTURE_KNOWLEDGE_BASE,
    COMPENSATION_RATE_CARD,
    DEVOPS_INTEGRATION_CATALOG,
    SECURITY_RISK_CATALOG,
)
from tools.text_tools import (
    extract_key_decisions,
    normalize_output_text,
    summarize_for_context,
    validate_json_structure,
)

# ============================================================================
# Requirement Agent Tools
# ============================================================================
@tool
def evaluate_market_and_business_model(domain: str = "", target_audience: str = "B2B") -> str:
    """Analyze market dynamics, monetization models, and value propositions for the project domain."""
    insights = {
        "domain": domain or "Software SaaS / Enterprise Platform",
        "target_audience": target_audience,
        "standard_monetization_models": [
            "Tiered Subscription (Free / Pro / Enterprise)",
            "Usage-based / Token-based consumption billing",
            "Seat-based licensing per active workspace user",
        ],
        "key_success_metrics": ["MRR / ARR Growth", "Net Revenue Retention (NRR > 110%)", "Time-to-Value (< 5 mins)", "User CAC Payback (< 12 months)"],
        "strategic_recommendation": "Focus on an effortless onboarding flow, rapid time-to-first-value, and defensible workflow integrations.",
    }
    return json.dumps(insights, indent=2)


@tool
def calculate_feature_prioritization(features_count: int = 6, complexity_tier: str = "medium") -> str:
    """Calculate RICE and MoSCoW distribution recommendations for scope definition."""
    recommendation = {
        "complexity_tier": complexity_tier,
        "recommended_distribution": {
            "Must_Have_MVP": "60% of total story points (Core user flow)",
            "Should_Have_V1": "25% of story points (Key differentiators & analytics)",
            "Could_Have_Future": "15% of story points (Nice-to-have automation)",
        },
        "quality_gates": [
            "Every requirement must include measurable acceptance criteria (Given / When / Then).",
            "Non-functional performance requirements (e.g. p95 latency < 300ms) must be specified.",
        ],
    }
    return json.dumps(recommendation, indent=2)


# ============================================================================
# System Architect Tools
# ============================================================================
@tool
def lookup_architecture_stack(stack_type: str = "nextjs_fastapi_postgres") -> str:
    """Look up authoritative architectural patterns, component recommendations, and data tiers."""
    stack_info = ARCHITECTURE_KNOWLEDGE_BASE["tech_stacks"].get(
        stack_type, ARCHITECTURE_KNOWLEDGE_BASE["tech_stacks"]["nextjs_fastapi_postgres"]
    )
    db_info = ARCHITECTURE_KNOWLEDGE_BASE["database_selection"]
    return json.dumps({"recommended_stack": stack_info, "database_guidelines": db_info}, indent=2)


@tool
def calculate_infrastructure_sizing(expected_concurrency: int = 500) -> str:
    """Calculate compute, database connection pooling, and caching requirements."""
    sizing = {
        "target_concurrency": expected_concurrency,
        "backend_workers": max(2, min(8, expected_concurrency // 100)),
        "db_pool_min_max": "min=5, max=25 connections with asyncpg",
        "redis_sizing": "Redis 7 with maxmemory 1GB and volatile-lru eviction policy",
        "load_balancer": "Nginx or Cloudflare reverse proxy with gzip and HTTP/2",
    }
    return json.dumps(sizing, indent=2)


# ============================================================================
# Sprint Planner Tools
# ============================================================================
@tool
def estimate_sprint_velocity(team_size: int = 4, sprint_weeks: int = 2) -> str:
    """Calculate realistic sprint point capacity, story point benchmarks, and buffer allocations."""
    base_velocity_per_dev = 10  # story points per 2-week sprint
    total_capacity = team_size * base_velocity_per_dev * (sprint_weeks / 2.0)
    buffer = total_capacity * 0.15

    return json.dumps({
        "team_size": team_size,
        "sprint_length_weeks": sprint_weeks,
        "nominal_capacity_points": total_capacity,
        "recommended_commit_points": round(total_capacity - buffer),
        "contingency_buffer_points": round(buffer),
        "story_point_scale": AGILE_VELOCITY_DATABASE["story_point_benchmarks"],
    }, indent=2)


@tool
def get_role_compensation_card(roles: list[str] | None = None) -> str:
    """Look up industry-standard hourly rates, monthly FTE costs, and skill sets for engineering roles."""
    all_roles = COMPENSATION_RATE_CARD["roles"]
    if roles:
        selected = {k: v for k, v in all_roles.items() if any(r.lower() in k.lower() for r in roles)}
        return json.dumps(selected or all_roles, indent=2)
    return json.dumps(all_roles, indent=2)


@tool
def calculate_critical_path_schedule(sprint_count: int = 4, has_external_dependencies: bool = False) -> str:
    """Calculate delivery timeline milestones, critical path buffers, and release readiness."""
    total_weeks = sprint_count * 2
    buffer_weeks = 2 if has_external_dependencies or sprint_count >= 4 else 1
    schedule = {
        "total_development_weeks": total_weeks,
        "stabilization_and_hardening_weeks": buffer_weeks,
        "total_estimated_delivery_weeks": total_weeks + buffer_weeks,
        "key_milestones": [
            "Milestone 1: Architectural Foundation & Core Data Models (Sprint 1)",
            f"Milestone 2: Functional MVP Feature Complete (Sprint {max(1, sprint_count // 2)})",
            f"Milestone 3: End-to-End Integration & Security Hardening (Sprint {sprint_count})",
            "Milestone 4: Production Staging Launch & UAT Sign-off",
        ],
    }
    return json.dumps(schedule, indent=2)


# ============================================================================
# Risk Analyst Tools
# ============================================================================
@tool
def lookup_security_threats(domain_category: str = "SaaS") -> str:
    """Retrieve security threat vectors, compliance standards, and actionable mitigations."""
    return json.dumps({
        "domain": domain_category,
        "core_threats": SECURITY_RISK_CATALOG["threats"],
        "compliance_standards": SECURITY_RISK_CATALOG["compliance_standards"],
    }, indent=2)


# ============================================================================
# Deployment Advisor Tools
# ============================================================================
@tool
def get_devops_blueprints() -> str:
    """Retrieve production-ready CI/CD pipelines, container orchestration, and observability standards."""
    return json.dumps(DEVOPS_INTEGRATION_CATALOG, indent=2)


# ============================================================================
# Shared text processing tools (available to all agents)
# ============================================================================
_TEXT_TOOLS = [
    summarize_for_context,
    normalize_output_text,
    extract_key_decisions,
    validate_json_structure,
]


# ============================================================================
# Agent-to-Tools Registry (v2 — no inter-agent consultation)
# ============================================================================
AGENT_SPECIALIST_TOOLS: dict[str, list[Any]] = {
    "requirement_agent": [
        evaluate_market_and_business_model,
        calculate_feature_prioritization,
        *_TEXT_TOOLS,
    ],
    "architect_agent": [
        lookup_architecture_stack,
        calculate_infrastructure_sizing,
        *_TEXT_TOOLS,
    ],
    "sprint_planner_agent": [
        estimate_sprint_velocity,
        get_role_compensation_card,
        calculate_critical_path_schedule,
        *_TEXT_TOOLS,
    ],
    "github_monitor": [
        *_TEXT_TOOLS,
    ],
    "risk_agent": [
        lookup_security_threats,
        *_TEXT_TOOLS,
    ],
    "deployment_advisor": [
        get_devops_blueprints,
        *_TEXT_TOOLS,
    ],
}


def get_tools_for_agent(agent_id: str) -> list[Any]:
    """Return the list of specialist tools assigned to a given agent."""
    return AGENT_SPECIALIST_TOOLS.get(agent_id, [])
