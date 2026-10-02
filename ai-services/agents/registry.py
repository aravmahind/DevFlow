"""The agent registry — the single source of truth for DEVFLOW's AI org (v2).

6 rationalized agents replacing the previous 8:
  - requirement_agent: Merges CEO + Product Manager
  - architect_agent: System architecture (kept)
  - sprint_planner_agent: Backlog + allocation + timeline (merges 3)
  - github_monitor: New — analyzes GitHub activity
  - risk_agent: Risk analysis (kept, enhanced)
  - deployment_advisor: Replaces Integration Agent
"""
from __future__ import annotations

from agents.base import Agent
from agents import schemas
from prompts import (
    architect,
    deployment_advisor,
    github_monitor,
    requirement_agent,
    risk,
    sprint_planner,
)

AGENTS: dict[str, Agent] = {
    "requirement_agent": Agent(
        id="requirement_agent",
        name="Requirement Agent",
        role="Requirements Analyst & Product Strategist",
        node="requirements",
        schema=schemas.RequirementsBundle,
        system_prompt=requirement_agent.SYSTEM_PROMPT,
        build_user_prompt=requirement_agent.build_user_prompt,
    ),
    "architect_agent": Agent(
        id="architect_agent",
        name="System Architect Agent",
        role="Principal System Architect",
        node="architecture",
        schema=schemas.ArchitectureBundle,
        system_prompt=architect.SYSTEM_PROMPT,
        build_user_prompt=architect.build_user_prompt,
    ),
    "sprint_planner_agent": Agent(
        id="sprint_planner_agent",
        name="Sprint Planner & Allocation Agent",
        role="Agile Delivery Lead",
        node="sprint_planning",
        schema=schemas.SprintPlan,
        system_prompt=sprint_planner.SYSTEM_PROMPT,
        build_user_prompt=sprint_planner.build_user_prompt,
    ),
    "github_monitor": Agent(
        id="github_monitor",
        name="GitHub Monitor Agent",
        role="Development Progress Analyst",
        node="execution",
        schema=schemas.GitHubProgressReport,
        system_prompt=github_monitor.SYSTEM_PROMPT,
        build_user_prompt=github_monitor.build_user_prompt,
    ),
    "risk_agent": Agent(
        id="risk_agent",
        name="Risk Agent",
        role="Risk Analyst",
        node="risk",
        schema=schemas.RiskBundle,
        system_prompt=risk.SYSTEM_PROMPT,
        build_user_prompt=risk.build_user_prompt,
    ),
    "deployment_advisor": Agent(
        id="deployment_advisor",
        name="Deployment Advisor",
        role="Infrastructure & Deployment Advisor",
        node="deployment",
        schema=schemas.DeploymentRecommendation,
        system_prompt=deployment_advisor.SYSTEM_PROMPT,
        build_user_prompt=deployment_advisor.build_user_prompt,
    ),
}


def get_agent(agent_id: str) -> Agent:
    if agent_id not in AGENTS:
        raise KeyError(f"unknown agent '{agent_id}'")
    return AGENTS[agent_id]
