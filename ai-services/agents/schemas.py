"""Structured output schemas for the DEVFLOW agent roster (v2 — LangGraph).

Changes from v1:
  - ExecutiveSummary merged INTO RequirementsBundle (the Requirement Agent
    produces both vision and requirements in one pass).
  - SprintPlan expanded to include task allocation (assignee, skills matching)
    and timeline (milestones). No separate TeamPlan or TimelinePlan.
  - New GitHubProgressReport for the GitHub Monitor Agent.
  - New DeploymentRecommendation replacing IntegrationBundle.
  - Removed: CEOReview, SupervisionDirective (replaced by human-in-the-loop).
  - Kept: RiskBundle (enhanced with GitHub progress awareness).
"""
from __future__ import annotations

from typing import Any, List, Literal

from pydantic import BaseModel, Field, model_validator

Priority = Literal["high", "medium", "low"]
Severity = Literal["critical", "high", "medium", "low"]
RequirementCategory = Literal[
    "frontend", "backend", "security", "ai", "integrations", "infrastructure"
]
RiskCategory = Literal["technical", "product", "delivery", "security", "scalability"]
MilestonePhase = Literal["mvp", "beta", "production", "scaling"]


def _ensure_lists(data: dict, *keys: str) -> dict:
    """Convert any string values to single-element lists for the given keys."""
    for key in keys:
        val = data.get(key)
        if isinstance(val, str):
            data[key] = [val]
    return data


# --------------------------------------------------------------------------- #
# Requirement Agent — Executive Summary + Requirements (merged)
# --------------------------------------------------------------------------- #
class RequirementItem(BaseModel):
    title: str = Field(default="")
    category: RequirementCategory = Field(default="backend")
    description: str = Field(default="")
    priority: Priority = "medium"
    estimated_effort_days: float = Field(
        default=1.0, ge=0.5, le=60,
        description="Rough effort estimate in developer-days",
    )
    depends_on: List[str] = Field(
        default_factory=list,
        description="Titles of other requirements this one depends on",
    )

    @model_validator(mode="before")
    @classmethod
    def normalize_req_fields(cls, data: Any) -> Any:
        if isinstance(data, dict):
            _ensure_lists(data, "depends_on")
            effort = data.get("estimated_effort_days")
            if effort is None or (isinstance(effort, (int, float)) and effort < 0.5):
                data["estimated_effort_days"] = 0.5
            if "category" in data and isinstance(data["category"], str):
                cat = data["category"].lower().strip().replace("-", "_")
                valid = {"frontend", "backend", "security", "ai", "integrations", "infrastructure"}
                if cat not in valid:
                    data["category"] = {
                        "ux": "frontend", "usability": "frontend",
                        "performance": "infrastructure", "scalability": "infrastructure",
                        "reliability": "infrastructure", "compliance": "security",
                        "data": "backend", "database": "backend",
                    }.get(cat, "backend")
                else:
                    data["category"] = cat
        return data


class UserStory(BaseModel):
    as_a: str = Field(default="user", description="The user role / persona")
    i_want: str = Field(default="", description="The capability desired")
    so_that: str = Field(default="", description="The value / outcome")
    acceptance_criteria: List[str] = Field(
        default_factory=list,
        description="Testable criteria, ideally in Given/When/Then format",
    )
    priority: Priority = "medium"

    @model_validator(mode="before")
    @classmethod
    def normalize_story_fields(cls, data: Any) -> Any:
        if isinstance(data, dict):
            _ensure_lists(data, "acceptance_criteria")
            if "as_a" not in data or not data["as_a"]:
                data["as_a"] = data.get("asA") or data.get("role") or data.get("user") or data.get("persona") or "user"
            if "i_want" not in data or not data["i_want"]:
                data["i_want"] = data.get("iWant") or data.get("want") or data.get("action") or data.get("capability") or data.get("title") or ""
            if "so_that" not in data or not data["so_that"]:
                data["so_that"] = data.get("soThat") or data.get("benefit") or data.get("value") or data.get("outcome") or ""
            if "acceptance_criteria" not in data or not data["acceptance_criteria"]:
                ac = data.get("acceptanceCriteria") or data.get("criteria") or []
                if isinstance(ac, str):
                    ac = [ac]
                data["acceptance_criteria"] = ac
        return data


class RequirementsBundle(BaseModel):
    """Output of the Requirement Agent — includes executive summary + requirements."""
    # Executive summary fields (merged from old CEO agent)
    project_title: str = Field(default="", description="A concise, descriptive product name")
    tagline: str = Field(default="", description="One-sentence positioning statement")
    vision: str = Field(default="", description="Long-term vision for the product")
    overview: str = Field(default="", description="2-4 sentence project overview")
    business_goals: List[str] = Field(default_factory=list)
    success_criteria: List[str] = Field(default_factory=list)
    target_users: List[str] = Field(default_factory=list)
    key_differentiators: List[str] = Field(default_factory=list)
    complexity_score: int = Field(default=50, ge=1, le=100, description="1=trivial, 100=extreme")
    complexity_label: Literal["Low", "Moderate", "High", "Very High"] = "Moderate"
    estimated_duration_weeks: int = Field(default=12, ge=1, le=260)
    recommended_team_size: int = Field(default=4, ge=1, le=200)

    # Requirements
    functional_requirements: List[RequirementItem] = Field(default_factory=list)
    non_functional_requirements: List[RequirementItem] = Field(default_factory=list)
    user_stories: List[UserStory] = Field(default_factory=list)
    scope_in: List[str] = Field(default_factory=list)
    scope_out: List[str] = Field(default_factory=list)

    # Gap analysis (new — helps the manager review)
    clarifying_questions: List[str] = Field(
        default_factory=list,
        description="Questions the manager should answer to refine requirements",
    )
    assumptions: List[str] = Field(
        default_factory=list,
        description="Assumptions made where the input was vague",
    )
    missing_requirements: List[str] = Field(
        default_factory=list,
        description="Requirements that are likely needed but not mentioned",
    )

    @model_validator(mode="before")
    @classmethod
    def normalize_bundle(cls, data: Any) -> Any:
        if isinstance(data, dict):
            _ensure_lists(
                data,
                "business_goals", "success_criteria", "target_users",
                "key_differentiators", "scope_in", "scope_out",
                "clarifying_questions", "assumptions", "missing_requirements",
            )
        return data


# --------------------------------------------------------------------------- #
# System Architect Agent — Architecture (kept mostly the same)
# --------------------------------------------------------------------------- #
def _normalize_key_entity(value: Any) -> str:
    """Coerce architecture key-entity objects into the string form the schema expects.

    The LLM can sometimes emit route-like dictionaries such as
    {"method": "POST", "path": "/login", "description": "Authenticate user"}
    instead of plain labels like "POST /login - Authenticate user".
    This helper turns that payload into the plain-text string the validator wants.
    """
    if isinstance(value, str):
        return value.strip()

    if isinstance(value, dict):
        method = str(value.get("method") or "").strip().upper()
        path = str(value.get("path") or value.get("route") or value.get("endpoint") or value.get("name") or "").strip()
        description = str(value.get("description") or value.get("summary") or value.get("detail") or "").strip()

        if method and path:
            entity = f"{method} {path}"
            if description:
                entity = f"{entity} - {description}"
            return entity

        if path:
            entity = path
            if description:
                entity = f"{entity} - {description}"
            return entity

        # Last-resort serializer for arbitrary dicts
        return " - ".join(f"{k}: {v}" for k, v in value.items() if v is not None)

    return str(value).strip()


class ArchitectureLayer(BaseModel):
    summary: str = Field(default="")
    components: List[str] = Field(default_factory=list)
    technologies: List[str] = Field(default_factory=list)
    decisions: List[str] = Field(default_factory=list)
    key_entities: List[str] = Field(
        default_factory=list,
        description="Primary data models or API endpoints relevant to this layer",
    )

    @model_validator(mode="before")
    @classmethod
    def normalize_layer(cls, data: Any) -> Any:
        if isinstance(data, dict):
            for key in ["components", "technologies", "decisions"]:
                val = data.get(key)
                if isinstance(val, str):
                    data[key] = [x.strip() for x in val.split(",") if x.strip()]

            # key_entities is the only field that may arrive as a list of dicts,
            # each dict representing an endpoint / route / entity description.
            key_entities = data.get("key_entities")
            if isinstance(key_entities, str):
                data["key_entities"] = [x.strip() for x in key_entities.split(",") if x.strip()]
            elif isinstance(key_entities, list):
                data["key_entities"] = [
                    _normalize_key_entity(item)
                    for item in key_entities
                    if str(item).strip()
                ]
        return data


class DataFlow(BaseModel):
    source: str = Field(default="", description="A component name, exactly as listed in a layer")
    target: str = Field(default="", description="A component name, exactly as listed in a layer")
    label: str = Field(default="", description="What flows, e.g. 'REST/JSON', 'SQL', 'events'")

    @model_validator(mode="before")
    @classmethod
    def from_string(cls, data: Any) -> Any:
        # Accept "Web App -> API Gateway: REST" as well as objects.
        if isinstance(data, str):
            head, _, label = data.partition(":")
            source, _, target = head.partition("->")
            return {"source": source.strip(), "target": target.strip(), "label": label.strip()}
        return data


class ArchitectureBundle(BaseModel):
    frontend: ArchitectureLayer = Field(default_factory=ArchitectureLayer)
    backend: ArchitectureLayer = Field(default_factory=ArchitectureLayer)
    database: ArchitectureLayer = Field(default_factory=ArchitectureLayer)
    infrastructure: ArchitectureLayer = Field(default_factory=ArchitectureLayer)
    technology_recommendations: List[str] = Field(default_factory=list)
    scalability_plan: List[str] = Field(default_factory=list)
    integration_points: List[str] = Field(default_factory=list)
    data_flows: List[DataFlow] = Field(
        default_factory=list,
        description="5-10 directed calls/data flows between components, used to draw the diagram",
    )
    # Explanation in simple terms for non-technical managers
    architecture_rationale: str = Field(
        default="",
        description="Plain-language explanation of why this architecture was chosen",
    )

    @model_validator(mode="before")
    @classmethod
    def normalize_arch(cls, data: Any) -> Any:
        if isinstance(data, dict):
            for key in ["technology_recommendations", "scalability_plan", "integration_points"]:
                val = data.get(key)
                if isinstance(val, str):
                    data[key] = [x.strip() for x in val.split("\n") if x.strip()]
        return data


# --------------------------------------------------------------------------- #
# Sprint Planner Agent — Backlog + Task Allocation + Timeline (merged)
# --------------------------------------------------------------------------- #
class Epic(BaseModel):
    title: str = Field(default="")
    description: str = Field(default="")


class TaskItem(BaseModel):
    title: str = Field(default="")
    description: str = Field(default="")
    category: str = Field(default="backend", description="e.g. frontend, backend, infra, ai, qa")
    epic: str = Field(default="", description="Title of the parent epic")
    estimated_days: float = Field(default=3.0, ge=0.5, le=60)
    story_points: int = Field(
        default=3, ge=1, le=13,
        description="Fibonacci story points: 1, 2, 3, 5, 8, 13",
    )
    priority: Priority = "medium"
    sprint: int = Field(default=1, ge=1)
    dependencies: List[str] = Field(default_factory=list, description="Titles of prerequisite tasks")
    definition_of_done: str = Field(
        default="",
        description="Specific criteria for marking this task complete",
    )
    # Task allocation fields (merged from old team_allocation agent)
    required_skills: List[str] = Field(
        default_factory=list,
        description="Skills needed to complete this task",
    )
    assigned_to: str = Field(
        default="",
        description="Name/role of the team member assigned to this task",
    )
    assignment_reason: str = Field(
        default="",
        description="Why this person/role was chosen for this task",
    )

    @model_validator(mode="before")
    @classmethod
    def normalize_task(cls, data: Any) -> Any:
        if isinstance(data, dict):
            _ensure_lists(data, "dependencies", "required_skills")
            if "description" not in data or not data["description"]:
                data["description"] = data.get("definition_of_done") or data.get("title") or ""
            if "estimated_days" not in data:
                data["estimated_days"] = float(data.get("estimate") or data.get("days") or 3.0)
            if "category" not in data:
                data["category"] = "backend"
        return data


class Sprint(BaseModel):
    number: int = Field(default=1, ge=1)
    name: str = Field(default="Sprint 1")
    goal: str = Field(default="")
    task_titles: List[str] = Field(default_factory=list)


class MilestoneItem(BaseModel):
    """Timeline milestone (merged from old timeline agent)."""
    title: str = Field(default="")
    description: str = Field(default="")
    phase: MilestonePhase = Field(default="mvp")
    start_week: int = Field(default=1, ge=0)
    duration_weeks: int = Field(default=2, ge=1, le=104)
    deliverables: List[str] = Field(default_factory=list)
    dependencies: List[str] = Field(default_factory=list)

    @model_validator(mode="before")
    @classmethod
    def normalize_milestone(cls, data: Any) -> Any:
        if isinstance(data, dict):
            if "phase" in data and isinstance(data["phase"], str):
                p = data["phase"].lower()
                valid = {"mvp", "beta", "production", "scaling"}
                data["phase"] = p if p in valid else "mvp"
            for key in ["deliverables", "dependencies"]:
                val = data.get(key)
                if isinstance(val, str):
                    data[key] = [x.strip() for x in val.split(",") if x.strip()]
        return data


class TeamRoleRecommendation(BaseModel):
    """Recommended team role (merged from old team_allocation agent)."""
    role: str = Field(default="")
    seniority: str = Field(default="Senior")
    count: int = Field(default=1, ge=1, le=20)
    skills: List[str] = Field(default_factory=list)
    responsibilities: List[str] = Field(default_factory=list)
    allocation_pct: int = Field(default=100, ge=10, le=100)

    @model_validator(mode="before")
    @classmethod
    def normalize_role(cls, data: Any) -> Any:
        if isinstance(data, dict):
            s = data.get("seniority", "Senior")
            if isinstance(s, str):
                s_map = {"junior": "Junior", "mid": "Mid", "senior": "Senior", "lead": "Lead", "principal": "Principal"}
                data["seniority"] = s_map.get(s.lower(), s.capitalize() if s else "Senior")
            for key in ["skills", "responsibilities"]:
                val = data.get(key)
                if isinstance(val, str):
                    data[key] = [x.strip() for x in val.split(",") if x.strip()]
        return data


class SprintPlan(BaseModel):
    """Unified output: backlog + task allocation + timeline (all from one agent)."""
    methodology: str = "Scrum"
    sprint_length_weeks: int = Field(default=2, ge=1, le=4)
    epics: List[Epic] = Field(default_factory=list)
    tasks: List[TaskItem] = Field(default_factory=list)
    sprints: List[Sprint] = Field(default_factory=list)
    # Timeline (merged from old timeline agent)
    milestones: List[MilestoneItem] = Field(default_factory=list)
    total_duration_weeks: int = Field(default=12, ge=1)
    critical_path: List[str] = Field(default_factory=list)
    # Team roles (merged from old team_allocation agent)
    recommended_roles: List[TeamRoleRecommendation] = Field(default_factory=list)
    staffing_notes: List[str] = Field(default_factory=list)


# --------------------------------------------------------------------------- #
# Risk Agent — Risk Analysis (enhanced for GitHub progress)
# --------------------------------------------------------------------------- #
class RiskItem(BaseModel):
    title: str = Field(default="")
    description: str = Field(default="")
    category: RiskCategory = Field(default="technical")
    severity: Severity = Field(default="medium")
    probability: int = Field(default=50, ge=0, le=100)
    impact: int = Field(default=50, ge=0, le=100)
    mitigation: str = Field(default="")
    cost_of_delay_per_week: str = Field(
        default="",
        description="Estimated business cost if this risk materializes",
    )
    compounds_with: List[str] = Field(
        default_factory=list,
        description="Titles of other risks this one amplifies",
    )

    @model_validator(mode="before")
    @classmethod
    def normalize_risk(cls, data: Any) -> Any:
        if isinstance(data, dict):
            if "category" in data and isinstance(data["category"], str):
                cat = data["category"].lower()
                valid = {"technical", "product", "delivery", "security", "scalability"}
                if cat not in valid:
                    data["category"] = "technical"
            if "severity" in data and isinstance(data["severity"], str):
                sev = data["severity"].lower()
                valid_sev = {"critical", "high", "medium", "low"}
                if sev not in valid_sev:
                    data["severity"] = "medium"
            cost = data.get("cost_of_delay_per_week")
            if cost is not None and not isinstance(cost, str):
                data["cost_of_delay_per_week"] = f"${cost:,}" if isinstance(cost, (int, float)) and not isinstance(cost, bool) else str(cost)
        return data


class RiskBundle(BaseModel):
    risks: List[RiskItem] = Field(default_factory=list)
    overall_risk_level: Literal["Low", "Moderate", "High", "Critical"] = "Moderate"
    summary: str = Field(default="")

    @model_validator(mode="before")
    @classmethod
    def normalize_risk_bundle(cls, data: Any) -> Any:
        if isinstance(data, dict):
            rl = data.get("overall_risk_level", "Moderate")
            if isinstance(rl, str):
                rl_map = {"low": "Low", "moderate": "Moderate", "medium": "Moderate", "high": "High", "critical": "Critical"}
                data["overall_risk_level"] = rl_map.get(rl.lower(), rl.capitalize() if rl else "Moderate")
        return data


# --------------------------------------------------------------------------- #
# GitHub Monitor Agent — Progress Report (new)
# --------------------------------------------------------------------------- #
class TaskProgress(BaseModel):
    """Progress estimate for a single task based on GitHub activity."""
    task_title: str = Field(default="")
    status: Literal["not_started", "in_progress", "likely_complete", "unknown"] = "unknown"
    evidence: str = Field(default="", description="What GitHub data supports this assessment")
    confidence: Literal["high", "medium", "low"] = "low"


class GitHubProgressReport(BaseModel):
    """Output of the GitHub Monitor Agent."""
    commit_summary: str = Field(default="", description="Overview of recent commit activity")
    pr_summary: str = Field(default="", description="PR statistics and status")
    branch_activity: List[str] = Field(default_factory=list, description="Active branches")
    task_progress: List[TaskProgress] = Field(default_factory=list)
    concerns: List[str] = Field(default_factory=list, description="Observed warning signs")
    recommendations: List[str] = Field(default_factory=list, description="Suggested actions")
    data_available: bool = Field(
        default=False,
        description="Whether GitHub data was actually available for analysis",
    )


# --------------------------------------------------------------------------- #
# Deployment Advisor — Recommendations (new, replaces IntegrationBundle)
# --------------------------------------------------------------------------- #
class DeploymentRecommendation(BaseModel):
    """Output of the Deployment Advisor Agent."""
    deployment_architecture: str = Field(default="", description="Hosting and orchestration recommendation")
    environment_config: List[str] = Field(default_factory=list, description="Environment setup recommendations")
    cicd_pipeline: List[str] = Field(default_factory=list, description="CI/CD pipeline steps")
    infrastructure_requirements: List[str] = Field(default_factory=list)
    monitoring_observability: List[str] = Field(default_factory=list)
    maintenance_practices: List[str] = Field(default_factory=list)
    scaling_considerations: List[str] = Field(default_factory=list)
    security_hardening: List[str] = Field(default_factory=list)
    estimated_monthly_cost_usd: int = Field(default=0, ge=0, description="Rough monthly infra cost")
    cost_breakdown: List[str] = Field(default_factory=list, description="Per-service cost breakdown")


# --------------------------------------------------------------------------- #
# Schema registry (agent_id -> output schema)
# --------------------------------------------------------------------------- #
AGENT_SCHEMAS: dict[str, type[BaseModel]] = {
    "requirement_agent": RequirementsBundle,
    "architect_agent": ArchitectureBundle,
    "sprint_planner_agent": SprintPlan,
    "github_monitor": GitHubProgressReport,
    "risk_agent": RiskBundle,
    "deployment_advisor": DeploymentRecommendation,
}