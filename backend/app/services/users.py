"""User management service."""
from typing import Any, Optional
from app.db.postgres import execute, fetch, fetchrow

async def upsert_user(
    clerk_id: str,
    email: str,
    first_name: str,
    last_name: str,
    image_url: str,
    role: str = "developer"
) -> dict[str, Any]:
    # Demo user should always be a manager for testing
    if clerk_id == "user_demo_devflow":
        role = "manager"
    
    # Check if user already exists
    existing = await fetchrow("SELECT * FROM users WHERE clerk_user_id = $1", clerk_id)
    if existing:
        # Preserve the existing role — don't overwrite what the user set in Settings
        preserved_role = existing["role"] or role
        await execute(
            """UPDATE users SET email=$2, first_name=$3, last_name=$4, image_url=$5, updated_at=NOW()
               WHERE clerk_user_id = $1""",
            clerk_id, email, first_name, last_name, image_url
        )
        updated_user = await fetchrow("SELECT * FROM users WHERE clerk_user_id = $1", clerk_id)
        return dict(updated_user) if updated_user else {}
    
    # New user: insert with the requested default role
    await execute(
        """INSERT INTO users (clerk_user_id, email, first_name, last_name, image_url, role)
           VALUES ($1, $2, $3, $4, $5, $6)""",
        clerk_id, email, first_name, last_name, image_url, role
    )
    new_user = await fetchrow("SELECT * FROM users WHERE clerk_user_id = $1", clerk_id)
    return dict(new_user) if new_user else {}


async def list_users(requesting_user_id: str) -> list[dict[str, Any]]:
    """List only users who share at least one project with the caller."""
    rows = await fetch(
        """SELECT DISTINCT u.clerk_user_id AS id, u.email, u.first_name,
                  u.last_name, u.image_url, u.role, u.specialization
           FROM project_members mine
           JOIN project_members peer ON peer.project_id=mine.project_id
           JOIN users u ON u.clerk_user_id=peer.user_id
           WHERE mine.user_id=$1
           ORDER BY u.first_name ASC, u.email ASC""",
        requesting_user_id,
    )
    return [dict(r) for r in rows]

async def update_user_role(user_id: str, role: str, specialization: str | None = None) -> bool:
    if role not in {"manager", "developer", "tester"}:
        raise ValueError("Invalid role")
    result = await execute(
        "UPDATE users SET role=$2, specialization=$3, updated_at=NOW() WHERE clerk_user_id=$1",
        user_id, role, specialization
    )
    from app.core.auth import invalidate_user
    invalidate_user(user_id)
    return result.endswith("1")
