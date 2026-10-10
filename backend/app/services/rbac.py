"""RBAC service — project-level membership, roles, invitations, and permissions."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone, timedelta
from typing import Any, Optional

from app.core.logging import get_logger
from app.db.postgres import execute, fetch, fetchrow

logger = get_logger("services.rbac")

# ---------------------------------------------------------------------------
# Permission matrix
# ---------------------------------------------------------------------------
# Actions: view_project, edit_content, create_project, invite_members,
#          assign_roles, assign_tasks, update_own_task, run_analysis,
#          manage_integrations (link/unlink GitHub), sync_integrations
PERMISSIONS: dict[str, set[str]] = {
    "manager": {
        "view_project", "edit_content", "create_project", "invite_members",
        "assign_roles", "assign_tasks", "update_own_task", "run_analysis",
        "manage_integrations", "sync_integrations",
    },
    "developer": {
        "view_project", "edit_content", "update_own_task", "sync_integrations",
    },
    "tester": {
        "view_project", "update_own_task",
    },
}

VALID_ROLES = {"manager", "developer", "tester"}

SPECIALIZATIONS = [
    "Java", "C++", "Python", "Go", "Rust", "JavaScript", "TypeScript",
    "Ruby", "Swift", "Kotlin", "C#", "PHP", "Scala", "R", "Dart",
    "QA Automation", "Manual Testing", "Performance Testing",
    "DevOps", "Data Engineering", "Machine Learning", "Frontend", "Backend",
    "Full Stack", "Mobile", "Security",
]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# Project member CRUD
# ---------------------------------------------------------------------------

async def add_project_member(
    project_id: str,
    user_id: str,
    role: str,
    specialization: str | None = None,
    invited_by: str | None = None,
    auto_accept: bool = True,
) -> dict[str, Any]:
    """Add a user to a project with the given role."""
    if role not in VALID_ROLES:
        raise ValueError(f"Invalid role: {role}")
    accepted = _now() if auto_accept else None
    await execute(
        """INSERT INTO project_members (project_id, user_id, role, specialization, invited_by, accepted_at)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (project_id, user_id) DO UPDATE SET
             role=EXCLUDED.role, specialization=EXCLUDED.specialization""",
        project_id, user_id, role, specialization, invited_by,
        datetime.fromisoformat(accepted) if accepted else None,
    )
    logger.info("Added member %s to project %s as %s", user_id, project_id, role)
    return {"project_id": project_id, "user_id": user_id, "role": role, "specialization": specialization}


async def remove_project_member(project_id: str, user_id: str) -> bool:
    """Remove a member from a project. Cannot remove the last manager."""
    # Check if this is the last manager
    count = await fetchrow(
        "SELECT count(*) AS cnt FROM project_members WHERE project_id=$1 AND role='manager' AND user_id<>$2",
        project_id, user_id,
    )
    if count and count["cnt"] == 0:
        # Check if the user being removed IS a manager
        member = await fetchrow(
            "SELECT role FROM project_members WHERE project_id=$1 AND user_id=$2",
            project_id, user_id,
        )
        if member and member["role"] == "manager":
            raise PermissionError("Cannot remove the last manager from a project")
    result = await execute(
        "DELETE FROM project_members WHERE project_id=$1 AND user_id=$2",
        project_id, user_id,
    )
    return result.endswith("1")


async def update_project_member_role(
    project_id: str, user_id: str, new_role: str, specialization: str | None = None,
) -> bool:
    """Change a member's role on a project."""
    if new_role not in VALID_ROLES:
        raise ValueError(f"Invalid role: {new_role}")
    # Prevent demoting the last manager
    member = await fetchrow(
        "SELECT role FROM project_members WHERE project_id=$1 AND user_id=$2",
        project_id, user_id,
    )
    if not member:
        return False
    if member["role"] == "manager" and new_role != "manager":
        count = await fetchrow(
            "SELECT count(*) AS cnt FROM project_members WHERE project_id=$1 AND role='manager' AND user_id<>$2",
            project_id, user_id,
        )
        if count and count["cnt"] == 0:
            raise PermissionError("Cannot demote the last manager")
    result = await execute(
        "UPDATE project_members SET role=$3, specialization=$4 WHERE project_id=$1 AND user_id=$2",
        project_id, user_id, new_role, specialization,
    )
    return result.endswith("1")


async def get_project_role(project_id: str, user_id: str) -> str | None:
    """Return the user's role on a project, or None if not a member."""
    row = await fetchrow(
        "SELECT role FROM project_members WHERE project_id=$1 AND user_id=$2",
        project_id, user_id,
    )
    if row:
        return str(row["role"])
    # Fallback check if user is the project owner (auto-heal membership)
    proj = await fetchrow("SELECT user_id FROM projects WHERE id=$1", project_id)
    if proj and proj["user_id"] == user_id:
        await execute(
            """INSERT INTO project_members (project_id, user_id, role, accepted_at)
               VALUES ($1, $2, 'manager', NOW()) ON CONFLICT DO NOTHING""",
            project_id, user_id,
        )
        return "manager"
    return None


async def list_project_members(project_id: str) -> list[dict[str, Any]]:
    """List all members of a project with their user profile."""
    rows = await fetch(
        """SELECT COALESCE(u.clerk_user_id, pm.user_id) AS user_id,
                  COALESCE(u.email, '') AS email,
                  COALESCE(u.first_name, '') AS first_name,
                  COALESCE(u.last_name, '') AS last_name,
                  COALESCE(u.image_url, '') AS image_url,
                  pm.role, pm.specialization, pm.invited_at, pm.accepted_at
           FROM project_members pm
           LEFT JOIN users u ON u.clerk_user_id = pm.user_id
           WHERE pm.project_id = $1
           ORDER BY pm.invited_at""",
        project_id,
    )
    return [dict(row) for row in rows]


# ---------------------------------------------------------------------------
# Project invitations (by email)
# ---------------------------------------------------------------------------

async def create_project_invite(
    project_id: str,
    email: str,
    role: str,
    invited_by: str,
    specialization: str | None = None,
    expires_hours: int = 168,
) -> dict[str, Any]:
    """Create an email-based invitation to a project and dispatch invitation email."""
    if role not in VALID_ROLES:
        raise ValueError(f"Invalid role: {role}")
    clean_email = email.strip().lower()

    # Check if user with this email already exists and is already a member
    existing = await fetchrow(
        """SELECT u.clerk_user_id FROM users u
           JOIN project_members pm ON pm.user_id = u.clerk_user_id AND pm.project_id = $1
           WHERE LOWER(u.email) = $2""",
        project_id, clean_email,
    )
    if existing:
        raise ValueError("User is already a member of this project")

    # Check for existing pending invite
    pending = await fetchrow(
        """SELECT id FROM project_invites
           WHERE project_id=$1 AND LOWER(email)=$2 AND accepted_at IS NULL AND expires_at > NOW()""",
        project_id, clean_email,
    )
    if pending:
        raise ValueError("An active invitation already exists for this email")

    invite_id = uuid.uuid4().hex
    row = await fetchrow(
        """INSERT INTO project_invites (id, project_id, email, role, specialization, invited_by, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6, NOW() + ($7 * INTERVAL '1 hour'))
           RETURNING id, project_id, email, role, specialization, created_at, expires_at""",
        invite_id, project_id, clean_email, role, specialization, invited_by, expires_hours,
    )

    # Fetch project and inviter details for email notification
    proj = await fetchrow("SELECT title FROM projects WHERE id=$1", project_id)
    project_title = (proj["title"] if proj and proj["title"] else "Devflow Project")
    inviter = await fetchrow("SELECT first_name, last_name, email FROM users WHERE clerk_user_id=$1", invited_by)
    inviter_name = None
    if inviter:
        inviter_name = f"{inviter['first_name'] or ''} {inviter['last_name'] or ''}".strip() or inviter["email"]

    # Send email asynchronously (non-blocking)
    import asyncio
    from app.services.email import send_project_invitation_email
    asyncio.create_task(
        send_project_invitation_email(
            to_email=clean_email,
            project_title=project_title,
            role=role,
            specialization=specialization,
            inviter_name=inviter_name,
            invite_id=invite_id,
        )
    )

    # If the user already exists in the system but not in the project, auto-accept immediately
    user_row = await fetchrow("SELECT clerk_user_id FROM users WHERE LOWER(email)=$1", clean_email)
    if user_row:
        await _accept_invite(invite_id, user_row["clerk_user_id"])
        logger.info("Auto-accepted invite for existing user %s on project %s", clean_email, project_id)

    return dict(row) if row else {}


async def _accept_invite(invite_id: str, user_id: str) -> bool:
    """Accept a specific invite."""
    invite = await fetchrow(
        """UPDATE project_invites SET accepted_by=$2, accepted_at=NOW()
           WHERE id=$1 AND accepted_at IS NULL AND expires_at > NOW()
           RETURNING project_id, role, specialization""",
        invite_id, user_id,
    )
    if not invite:
        return False
    await add_project_member(
        invite["project_id"], user_id, invite["role"],
        specialization=invite["specialization"],
    )
    return True


async def accept_invite_by_id(invite_id: str, user_id: str) -> bool:
    """Accept an invite explicitly by invite ID."""
    return await _accept_invite(invite_id, user_id)


async def accept_pending_invites(user_id: str, email: str) -> int:
    """Accept all pending project invites for the given email. Called on login/sync."""
    if not email:
        return 0
    clean_email = email.strip().lower()
    pending = await fetch(
        """SELECT id FROM project_invites
           WHERE LOWER(email)=$1 AND accepted_at IS NULL AND expires_at > NOW()""",
        clean_email,
    )
    accepted = 0
    for row in pending:
        if await _accept_invite(row["id"], user_id):
            accepted += 1
    if accepted:
        logger.info("Auto-accepted %d invite(s) for %s (user_id=%s)", accepted, clean_email, user_id)
    return accepted


async def list_project_invites(project_id: str) -> list[dict[str, Any]]:
    """List pending invites for a project."""
    rows = await fetch(
        """SELECT pi.id, pi.email, pi.role, pi.specialization, pi.created_at, pi.expires_at,
                  u.first_name AS invited_by_name, u.email AS invited_by_email
           FROM project_invites pi
           LEFT JOIN users u ON u.clerk_user_id = pi.invited_by
           WHERE pi.project_id=$1 AND pi.accepted_at IS NULL AND pi.expires_at > NOW()
           ORDER BY pi.created_at DESC""",
        project_id,
    )
    return [dict(row) for row in rows]


async def revoke_project_invite(invite_id: str) -> bool:
    """Delete a pending invitation."""
    result = await execute(
        "DELETE FROM project_invites WHERE id=$1 AND accepted_at IS NULL",
        invite_id,
    )
    return result.endswith("1")


# ---------------------------------------------------------------------------
# User project list
# ---------------------------------------------------------------------------

async def get_user_projects(user_id: str, limit: int = 50) -> list[dict[str, Any]]:
    """List all projects the user is a member of, with their role."""
    # Ensure any project created by this user has a manager membership record
    await execute(
        """INSERT INTO project_members (project_id, user_id, role, accepted_at)
           SELECT p.id, p.user_id, 'manager', NOW()
           FROM projects p
           WHERE p.user_id = $1 AND NOT EXISTS (
               SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = p.user_id
           ) ON CONFLICT DO NOTHING""",
        user_id,
    )
    rows = await fetch(
        """SELECT p.id, p.title, p.status, p.progress, p.created_at, p.updated_at,
                  p.document->>'idea' AS idea, p.document->>'error' AS error,
                  pm.role AS project_role, pm.specialization AS project_specialization
           FROM project_members pm
           JOIN projects p ON p.id = pm.project_id
           WHERE pm.user_id = $1
           ORDER BY p.updated_at DESC
           LIMIT $2""",
        user_id, limit,
    )
    return [dict(row) for row in rows]


# ---------------------------------------------------------------------------
# Permission checking
# ---------------------------------------------------------------------------

def check_permission(role: str | None, action: str) -> bool:
    """Check if a role has a specific permission."""
    if not role or role not in PERMISSIONS:
        return False
    return action in PERMISSIONS[role]


async def check_project_permission(project_id: str, user_id: str, action: str) -> bool:
    """Check if a user has permission to perform an action on a project."""
    role = await get_project_role(project_id, user_id)
    return check_permission(role, action)
