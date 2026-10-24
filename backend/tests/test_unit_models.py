"""
DEVFLOW BACKEND — Unit Tests: Models, Project Factory, RBAC Logic
Test IDs: UT-001 through UT-012
No database or network required. Pure Python / Pydantic validation.
"""
import pytest
from pydantic import ValidationError

from app.models.project import (
    AnalyzeRequest,
    AnalyzeResponse,
    ChatRequest,
    MigrateRequest,
    ProjectDocumentCreate,
    migration_idea,
    new_project_doc,
    NODE_IDS,
    SECTION_KEYS,
)
from app.services.rbac import check_permission, PERMISSIONS, VALID_ROLES
from app.services.task_assignment import auto_assign


# ---------------------------------------------------------------------------
# UT-001  AnalyzeRequest — valid payload
# ---------------------------------------------------------------------------
def test_analyze_request_valid():
    """UT-001: AnalyzeRequest accepts a well-formed idea."""
    req = AnalyzeRequest(idea="Build a SaaS task manager for remote teams", title="TaskFlow")
    assert req.idea.startswith("Build")
    assert req.title == "TaskFlow"
    assert req.team_size == 4          # default
    assert req.methodology == "Agile"  # default


# ---------------------------------------------------------------------------
# UT-002  AnalyzeRequest — idea too short (< 8 chars) fails
# ---------------------------------------------------------------------------
def test_analyze_request_idea_too_short():
    """UT-002: AnalyzeRequest rejects an idea shorter than 8 characters."""
    with pytest.raises(ValidationError) as exc_info:
        AnalyzeRequest(idea="short")
    errors = exc_info.value.errors()
    assert any(e["loc"] == ("idea",) for e in errors)


# ---------------------------------------------------------------------------
# UT-003  AnalyzeRequest — idea too long (> 4000 chars) fails
# ---------------------------------------------------------------------------
def test_analyze_request_idea_too_long():
    """UT-003: AnalyzeRequest rejects an idea exceeding 4000 characters."""
    with pytest.raises(ValidationError):
        AnalyzeRequest(idea="x" * 4001)


# ---------------------------------------------------------------------------
# UT-004  AnalyzeRequest — team_size constraints
# ---------------------------------------------------------------------------
def test_analyze_request_team_size_bounds():
    """UT-004: team_size must be between 1 and 200."""
    with pytest.raises(ValidationError):
        AnalyzeRequest(idea="Valid idea here", team_size=0)
    with pytest.raises(ValidationError):
        AnalyzeRequest(idea="Valid idea here", team_size=201)
    ok = AnalyzeRequest(idea="Valid idea here", team_size=50)
    assert ok.team_size == 50


# ---------------------------------------------------------------------------
# UT-005  ProjectDocumentCreate — valid source_type
# ---------------------------------------------------------------------------
def test_project_document_source_type_valid():
    """UT-005: ProjectDocumentCreate accepts valid source_type values."""
    for stype in ("text", "spec", "repo", "tickets", "url", "file"):
        doc = ProjectDocumentCreate(
            title="Test doc",
            content="A" * 12,  # min_length = 12
            source_type=stype,
        )
        assert doc.source_type == stype


# ---------------------------------------------------------------------------
# UT-006  ProjectDocumentCreate — invalid source_type fails
# ---------------------------------------------------------------------------
def test_project_document_source_type_invalid():
    """UT-006: ProjectDocumentCreate rejects unrecognised source_type."""
    with pytest.raises(ValidationError):
        ProjectDocumentCreate(
            title="Test doc",
            content="A" * 12,
            source_type="unknown_type",
        )


# ---------------------------------------------------------------------------
# UT-007  new_project_doc — structure and defaults
# ---------------------------------------------------------------------------
def test_new_project_doc_structure():
    """UT-007: new_project_doc returns a complete document with expected keys."""
    doc = new_project_doc("Build an e-commerce platform for SMBs")
    assert "id" in doc and len(doc["id"]) == 32  # uuid4 hex
    assert doc["status"] == "queued"
    assert doc["progress"] == 0
    assert doc["error"] is None
    assert "orchestration" in doc
    # All section keys default to None
    for key in SECTION_KEYS:
        assert key in doc
        assert doc[key] is None
    # All orchestration nodes present
    for nid in NODE_IDS:
        assert nid in doc["orchestration"]["nodes"]


# ---------------------------------------------------------------------------
# UT-008  new_project_doc — title derivation
# ---------------------------------------------------------------------------
def test_new_project_doc_title_derivation():
    """UT-008: Title is derived from the first line of the idea when not provided."""
    doc = new_project_doc("SaaS inventory tracker\nWith multi-warehouse support")
    assert "SaaS inventory tracker" in doc["title"]

    # Explicit title overrides derivation
    doc2 = new_project_doc("Some idea here", title="My Custom Title")
    assert doc2["title"] == "My Custom Title"


# ---------------------------------------------------------------------------
# UT-009  migration_idea — framing
# ---------------------------------------------------------------------------
def test_migration_idea_framing():
    """UT-009: migration_idea wraps content with the 'Reconstruct' preamble."""
    result = migration_idea("spec", "# Existing project spec\nFeature: login")
    assert "Reconstruct" in result
    assert "EXISTING PROJECT ARTIFACT" in result
    assert "source: spec" in result


# ---------------------------------------------------------------------------
# UT-010  RBAC check_permission — manager has all permissions
# ---------------------------------------------------------------------------
def test_rbac_manager_permissions():
    """UT-010: Manager role has full permission set."""
    for action in PERMISSIONS["manager"]:
        assert check_permission("manager", action), f"Manager should have '{action}'"


# ---------------------------------------------------------------------------
# UT-011  RBAC check_permission — tester is restricted
# ---------------------------------------------------------------------------
def test_rbac_tester_restrictions():
    """UT-011: Tester cannot edit_content, run_analysis, or assign tasks."""
    restricted = {"edit_content", "run_analysis", "assign_tasks", "invite_members"}
    for action in restricted:
        assert not check_permission("tester", action), f"Tester should NOT have '{action}'"
    # Tester CAN view project and update own task
    assert check_permission("tester", "view_project")
    assert check_permission("tester", "update_own_task")


# ---------------------------------------------------------------------------
# UT-012  RBAC check_permission — unknown role returns False
# ---------------------------------------------------------------------------
def test_rbac_unknown_role():
    """UT-012: check_permission returns False for unknown/None roles."""
    assert not check_permission(None, "view_project")
    assert not check_permission("superadmin", "view_project")
    assert not check_permission("", "view_project")


# ---------------------------------------------------------------------------
# UT-013  ChatRequest — message length validation
# ---------------------------------------------------------------------------
def test_chat_request_message_bounds():
    """UT-013: ChatRequest enforces message length between 1 and 2000 chars."""
    with pytest.raises(ValidationError):
        ChatRequest(message="")
    with pytest.raises(ValidationError):
        ChatRequest(message="x" * 2001)
    ok = ChatRequest(message="What is the sprint velocity?")
    assert ok.message.startswith("What")


# ---------------------------------------------------------------------------
# UT-014  MigrateRequest — content min_length
# ---------------------------------------------------------------------------
def test_migrate_request_content_too_short():
    """UT-014: MigrateRequest rejects content shorter than 12 characters."""
    with pytest.raises(ValidationError):
        MigrateRequest(content="short", source="spec")


# ---------------------------------------------------------------------------
# UT-015  ContentEditRequest path validation (via projects API model)
# ---------------------------------------------------------------------------
def test_content_edit_path_bounds():
    """UT-015: ContentEditRequest enforces path length constraints."""
    from app.api.projects import ContentEditRequest

    # Too short
    with pytest.raises(ValidationError):
        ContentEditRequest(path="/", value="anything")

    # Too long
    with pytest.raises(ValidationError):
        ContentEditRequest(path="/" + "a" * 300, value="anything")

    # Valid
    ok = ContentEditRequest(path="/requirements/summary", value="Hello")
    assert ok.path == "/requirements/summary"


# ---------------------------------------------------------------------------
# UT-016  TaskUpdateRequest — status pattern
# ---------------------------------------------------------------------------
def test_task_update_request_status_pattern():
    """UT-016: TaskUpdateRequest only accepts defined status values."""
    from app.api.projects import TaskUpdateRequest

    for valid in ("To Do", "In Progress", "In Review", "Done"):
        req = TaskUpdateRequest(status=valid)
        assert req.status == valid

    with pytest.raises(ValidationError):
        TaskUpdateRequest(status="Backlog")  # not in allowed list


# ---------------------------------------------------------------------------
# UT-017  auto_assign — load balancing across members
# ---------------------------------------------------------------------------
def test_auto_assign_load_balancing():
    """UT-017: auto_assign distributes tasks across available members evenly."""
    members = [
        {"user_id": "u1", "role": "developer", "specialization": "Backend",
         "first_name": "Alice", "last_name": "A", "email": "a@a.com"},
        {"user_id": "u2", "role": "developer", "specialization": "Frontend",
         "first_name": "Bob", "last_name": "B", "email": "b@b.com"},
    ]
    tasks = [
        {"title": "Setup DB", "category": "backend", "required_skills": ["database"],
         "estimated_days": 2, "story_points": 3},
        {"title": "Build UI", "category": "frontend", "required_skills": ["react"],
         "estimated_days": 2, "story_points": 3},
        {"title": "API auth", "category": "backend auth", "required_skills": ["api"],
         "estimated_days": 3, "story_points": 5},
        {"title": "Landing page", "category": "frontend web", "required_skills": ["css"],
         "estimated_days": 1, "story_points": 2},
    ]
    updated, made = auto_assign(tasks, members)
    assert len(made) == 4, "All 4 tasks should be assigned"
    assignees = [t.get("assignee_id") for t in updated]
    # Both members get at least one task
    assert "u1" in assignees
    assert "u2" in assignees


# ---------------------------------------------------------------------------
# UT-018  auto_assign — skips completed tasks
# ---------------------------------------------------------------------------
def test_auto_assign_skips_done():
    """UT-018: auto_assign does not reassign tasks with status='Done'."""
    members = [
        {"user_id": "u1", "role": "developer", "specialization": None,
         "first_name": "Dev", "last_name": "One", "email": "d@d.com"},
    ]
    tasks = [
        {"title": "Done task", "category": "backend", "status": "Done",
         "estimated_days": 2, "story_points": 3},
        {"title": "Open task", "category": "backend", "status": "To Do",
         "estimated_days": 1, "story_points": 2},
    ]
    updated, made = auto_assign(tasks, members)
    assert len(made) == 1, "Only the open task should be assigned"
    assert made[0]["title"] == "Open task"


# ---------------------------------------------------------------------------
# UT-019  auto_assign — respects overwrite=False (default)
# ---------------------------------------------------------------------------
def test_auto_assign_no_overwrite():
    """UT-019: auto_assign preserves existing assignments when overwrite=False."""
    members = [
        {"user_id": "u1", "role": "developer", "specialization": None,
         "first_name": "Dev", "last_name": "One", "email": "d@d.com"},
        {"user_id": "u2", "role": "developer", "specialization": None,
         "first_name": "Dev", "last_name": "Two", "email": "e@e.com"},
    ]
    tasks = [
        {"title": "Pre-assigned task", "category": "backend", "assignee_id": "u1",
         "estimated_days": 2},
        {"title": "Unassigned task", "category": "backend", "estimated_days": 2},
    ]
    updated, made = auto_assign(tasks, members, overwrite=False)
    # Only the unassigned task should be in made
    assert len(made) == 1
    assert made[0]["title"] == "Unassigned task"
    # u1's original assignment preserved
    assert updated[0]["assignee_id"] == "u1"


# ---------------------------------------------------------------------------
# UT-020  VALID_ROLES constant
# ---------------------------------------------------------------------------
def test_valid_roles_constant():
    """UT-020: VALID_ROLES contains exactly manager, developer, tester."""
    assert VALID_ROLES == {"manager", "developer", "tester"}
