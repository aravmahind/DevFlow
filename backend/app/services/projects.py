"""PostgreSQL-backed project persistence and durable AI-response history."""
from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import uuid
from typing import Any, Optional

from app.core.logging import get_logger
from app.db.postgres import execute, fetch, fetchrow, pool
from app.models.project import new_project_doc

logger = get_logger("services.projects")
_MAX_LOGS = 250
_UNSET = object()

# Maps LangGraph node names → project orchestration node IDs.
# The ai-services graph uses names like "architect_agent" but the project
# document uses shorter IDs like "architecture" for status tracking.
_LANGGRAPH_NODE_TO_ORCH_ID: dict[str, str] = {
    "requirement_agent": "requirements",
    "architect_agent": "architecture",
    "sprint_planner_agent": "sprint_planning",
    "github_monitor": "execution",
    "risk_agent": "risk",
    "deployment_advisor": "deployment",
    # Approval gates and utility nodes — no matching orchestration node
    "await_req_approval": "requirements",
    "await_arch_approval": "architecture",
    "await_sprint_approval": "sprint_planning",
    "await_sprint_review": "execution",
    "mark_complete": "",
    "increment_sprint": "",
}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def create_project(idea: str, title: Optional[str], user_id: str, manager_inputs: dict[str,Any] | None = None) -> dict[str, Any]:
    doc = new_project_doc(idea, title, manager_inputs)
    doc["user_id"] = user_id
    workspace_id = await ensure_personal_workspace(user_id)
    doc["workspace_id"] = workspace_id
    doc["revision"] = 0
    await execute(
        """INSERT INTO projects (id, user_id, workspace_id, title, status, progress, document)
           VALUES ($1, $2, $3, $4, $5, $6, $7)""",
        doc["id"], user_id, workspace_id, doc["title"], doc["status"], doc["progress"], doc,
    )
    from app.services.rbac import add_project_member
    await add_project_member(doc["id"], user_id, "manager")
    logger.info("Created project %s for user %s", doc["id"], user_id)
    return doc


async def get_project(project_id: str, user_id: str | None = None) -> Optional[dict[str, Any]]:
    if user_id is None:  # trusted internal orchestration path
        row = await fetchrow("SELECT document FROM projects WHERE id=$1", project_id)
    else:
        row = await fetchrow(
            """SELECT p.document FROM projects p
               JOIN project_members pm ON pm.project_id=p.id AND pm.user_id=$2
               WHERE p.id=$1""", project_id, user_id,
        )
    return dict(row["document"]) if row else None


async def list_projects(user_id: str, limit: int = 50) -> list[dict[str, Any]]:
    rows = await fetch(
        """SELECT p.document FROM projects p
           JOIN project_members pm ON pm.project_id=p.id AND pm.user_id=$1
           ORDER BY p.created_at DESC LIMIT $2""", user_id, limit,
    )
    keys = ("id", "title", "status", "progress", "created_at", "updated_at")
    return [{key: row["document"].get(key) for key in keys} for row in rows]


async def _save_doc(project_id: str, doc: dict[str, Any]) -> None:
    await execute(
        """UPDATE projects SET title=$2, status=$3, progress=$4, document=$5,
           updated_at=NOW() WHERE id=$1""",
        project_id, doc["title"], doc["status"], doc["progress"], doc,
    )


async def set_status(
    project_id: str,
    status: str,
    *,
    progress: Optional[int] = None,
    error: Optional[str] | object = _UNSET,
) -> None:
    now = _now()
    patch: dict[str, Any] = {"status": status, "updated_at": now}
    if progress is not None:
        patch["progress"] = progress
    if error is not _UNSET:
        patch["error"] = error
    await execute(
        """UPDATE projects
           SET status=$2, progress=COALESCE($3, progress), document=document || $4,
               updated_at=NOW()
           WHERE id=$1""",
        project_id, status, progress, patch,
    )


async def update_section(project_id: str, section: str, data: Any) -> bool:
    doc = await get_project(project_id)
    if not doc:
        return False
    doc[section] = data
    doc["updated_at"] = _now()
    await _save_doc(project_id, doc)
    return True


async def ensure_personal_workspace(user_id: str) -> str:
    workspace_id = f"personal_{user_id}"
    await execute(
        """INSERT INTO workspaces (id, name, owner_id) VALUES ($1, 'My Workspace', $2)
           ON CONFLICT (id) DO NOTHING""", workspace_id, user_id,
    )
    await execute(
        """INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'owner')
           ON CONFLICT (workspace_id, user_id) DO NOTHING""", workspace_id, user_id,
    )
    return workspace_id

async def ensure_project_workspace(project_id:str,doc:dict[str,Any])->str:
    if doc.get("workspace_id"): return str(doc["workspace_id"])
    workspace_id=await ensure_personal_workspace(doc["user_id"])
    doc["workspace_id"]=workspace_id
    await execute("UPDATE projects SET workspace_id=$2,document=$3 WHERE id=$1",project_id,workspace_id,doc)
    return workspace_id


async def project_role(project_id: str, user_id: str) -> str | None:
    row = await fetchrow(
        "SELECT role FROM project_members WHERE project_id=$1 AND user_id=$2", project_id, user_id,
    )
    return str(row["role"]) if row else None


def _set_path(document: dict[str, Any], path: str, value: Any) -> None:
    parts = [part for part in path.strip("/").split("/") if part]
    if not parts or parts[0] in {"id", "user_id", "workspace_id", "revision", "orchestration", "status"}:
        raise ValueError("path is not editable")
    cursor: Any = document
    for part in parts[:-1]:
        key: Any = int(part) if isinstance(cursor, list) else part
        cursor = cursor[key]
    key = int(parts[-1]) if isinstance(cursor, list) else parts[-1]
    cursor[key] = value


async def edit_content(project_id: str, actor_id: str, path: str, value: Any, expected_revision: int | None = None, operation: str = "edit") -> dict[str, Any] | None:
    """Atomically edit any user-facing document field and retain an undo snapshot."""
    async with pool().acquire() as conn:
        await conn.set_type_codec("jsonb", encoder=__import__('json').dumps, decoder=__import__('json').loads, schema="pg_catalog")
        async with conn.transaction():
            row = await conn.fetchrow("SELECT document FROM projects WHERE id=$1 FOR UPDATE", project_id)
            if not row:
                return None
            before = dict(row["document"])
            current_revision = int(before.get("revision", 0))
            if expected_revision is not None and expected_revision != current_revision:
                raise RuntimeError("revision conflict")
            after = __import__('copy').deepcopy(before)
            _set_path(after, path, value)
            after["revision"] = current_revision + 1
            after["updated_at"] = _now()
            await conn.execute(
                """UPDATE projects SET title=$2, document=$3, updated_at=NOW() WHERE id=$1""",
                project_id, after.get("title", before.get("title", "Untitled")), after,
            )
            await conn.execute(
                """INSERT INTO project_revisions
                   (project_id, actor_id, revision, operation, path, before_document, after_document)
                   VALUES ($1,$2,$3,$4,$5,$6,$7)""",
                project_id, actor_id, after["revision"], operation, path, before, after,
            )
            return after


async def undo(project_id: str, actor_id: str) -> dict[str, Any] | None:
    async with pool().acquire() as conn:
        await conn.set_type_codec("jsonb", encoder=__import__('json').dumps, decoder=__import__('json').loads, schema="pg_catalog")
        async with conn.transaction():
            row = await conn.fetchrow("SELECT document FROM projects WHERE id=$1 FOR UPDATE", project_id)
            rev = await conn.fetchrow("SELECT * FROM project_revisions WHERE project_id=$1 ORDER BY revision DESC LIMIT 1", project_id)
            if not row or not rev:
                return None
            current = dict(row["document"])
            restored = dict(rev["before_document"])
            restored["revision"] = int(current.get("revision", 0)) + 1
            restored["updated_at"] = _now()
            await conn.execute("UPDATE projects SET title=$2, document=$3, updated_at=NOW() WHERE id=$1", project_id, restored["title"], restored)
            await conn.execute("DELETE FROM project_revisions WHERE id=$1", rev["id"])
            return restored


async def revision_history(project_id: str, limit: int = 30) -> list[dict[str, Any]]:
    rows = await fetch("SELECT revision, operation, path, actor_id, created_at FROM project_revisions WHERE project_id=$1 ORDER BY revision DESC LIMIT $2", project_id, limit)
    return [dict(row) for row in rows]


async def add_ai_response(
    project_id: str,
    user_id: str,
    kind: str,
    *,
    role: str = "assistant",
    content: str | None = None,
    payload: Any = None,
) -> None:
    await execute(
        """INSERT INTO ai_responses (project_id, user_id, kind, role, content, payload)
           VALUES ($1, $2, $3, $4, $5, $6)""",
        project_id, user_id, kind, role, content, payload,
    )


async def create_source_document(
    project_id: str,
    user_id: str,
    *,
    title: str,
    content: str,
    source_type: str,
    mime_type: str,
    metadata: dict[str, Any],
) -> dict[str, Any]:
    """Persist a tenant-scoped source for the AI retrieval pipeline."""
    role = await project_role(project_id, user_id)
    if role not in {"manager", "developer"}:
        raise PermissionError("document upload requires edit permission")
    doc = await get_project(project_id, user_id)
    if not doc:
        raise LookupError("project not found")
    workspace_id = await ensure_project_workspace(project_id, doc)
    digest = hashlib.sha256(content.encode("utf-8")).hexdigest()
    document_id = uuid.uuid4().hex
    row = await fetchrow(
        """INSERT INTO project_documents
               (id, workspace_id, project_id, created_by, title, source_type,
                mime_type, content, content_sha256, metadata)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           ON CONFLICT (project_id, content_sha256) DO UPDATE
               SET title=EXCLUDED.title, source_type=EXCLUDED.source_type,
                   mime_type=EXCLUDED.mime_type, metadata=EXCLUDED.metadata,
                   status='pending', updated_at=NOW()
           RETURNING id, project_id, title, source_type, mime_type, metadata,
                     status, created_at, updated_at""",
        document_id, workspace_id, project_id, user_id, title, source_type,
        mime_type, content, digest, metadata,
    )
    return dict(row) if row else {}


async def list_source_documents(project_id: str, user_id: str) -> list[dict[str, Any]]:
    if not await project_role(project_id, user_id):
        raise LookupError("project not found")
    rows = await fetch(
        """SELECT id, project_id, title, source_type, mime_type, metadata,
                  status, length(content) AS content_length, created_at, updated_at
           FROM project_documents WHERE project_id=$1 ORDER BY created_at DESC""",
        project_id,
    )
    return [dict(row) for row in rows]


async def ai_provenance(project_id: str, user_id: str) -> dict[str, Any]:
    """Return tenant-authorized RAG and agent-run evidence without raw source text."""
    if not await project_role(project_id, user_id):
        raise LookupError("project not found")
    run_rows = await fetch(
        """SELECT r.id, r.trigger, r.status, r.output_summary, r.metrics, r.error,
                  r.started_at, r.completed_at, count(s.id)::int AS step_count
           FROM agent_runs r LEFT JOIN agent_run_steps s ON s.run_id=r.id
           WHERE r.project_id=$1
           GROUP BY r.id ORDER BY r.started_at DESC LIMIT 20""",
        project_id,
    )
    source_rows = await fetch(
        """SELECT source_kind, source_key, source_title, count(*)::int AS chunks,
                  max(updated_at) AS indexed_at
           FROM knowledge_chunks WHERE project_id=$1
           GROUP BY source_kind, source_key, source_title
           ORDER BY source_kind, source_title""",
        project_id,
    )
    memory_rows = await fetch(
        """SELECT agent_id, memory_type, content, importance, metadata, created_at
           FROM project_memories
           WHERE project_id=$1 AND superseded_at IS NULL
           ORDER BY importance DESC, created_at DESC LIMIT 100""",
        project_id,
    )
    return {
        "runs": [dict(row) for row in run_rows],
        "indexed_sources": [dict(row) for row in source_rows],
        "memories": [dict(row) for row in memory_rows],
    }


async def apply_event(project_id: str, event: dict[str, Any]) -> None:
    # Section delivery is the hot path. Persist the project document and its
    # response-history row in one database round trip; the previous read + two
    # writes made a streamed run lag minutes behind when using a cloud database.
    if event.get("type") == "section_complete" and event.get("section"):
        section = str(event["section"])
        data = event.get("data")
        now = _now()
        await execute(
            """WITH updated AS (
                   UPDATE projects
                   SET document=jsonb_set(document, ARRAY[$2]::text[], $3::jsonb, true)
                                || jsonb_build_object('updated_at', $4::text),
                       updated_at=NOW()
                   WHERE id=$1
                   RETURNING user_id
               )
               INSERT INTO ai_responses (project_id, user_id, kind, role, payload)
               SELECT $1, user_id, $5, 'assistant', $3::jsonb FROM updated""",
            project_id, section, data, now, f"section:{section}",
        )
        return

    doc = await get_project(project_id)
    if not doc:
        return
    etype = event.get("type")
    now = _now()
    if etype == "node_update" and event.get("node"):
        node = event["node"]
        # Translate LangGraph node name → orchestration node ID
        orch_id = _LANGGRAPH_NODE_TO_ORCH_ID.get(node, node)
        doc["orchestration"]["current_node"] = orch_id or node
        state_update = event.get("state", {})
        
        # Mark node as complete if it yielded a state update
        if orch_id and orch_id in doc["orchestration"]["nodes"]:
            doc["orchestration"]["nodes"][orch_id].update(status="complete", progress=100)
            
        # Extract section payloads from state update
        for key in ["requirements", "architecture", "backlog", "github_progress", "risks", "deployment_recommendations"]:
            if key in state_update:
                doc[key] = state_update[key]
                await add_ai_response(
                    project_id, doc["user_id"], f"section:{key}", payload=state_update[key]
                )
                
        # Extract iteration state
        for key in ["approvals", "manager_feedback", "pending_approval"]:
            if key in state_update:
                doc[key] = state_update[key]
                
    elif etype == "paused_for_approval":
        doc["pending_approval"] = event.get("pending_approval")
        doc["status"] = "awaiting_approval"
    elif etype == "log":
        doc["orchestration"]["logs"] = (doc["orchestration"]["logs"] + [{
            "agent": event.get("agent"), "level": event.get("level", "info"),
            "message": event.get("message", ""), "ts": event.get("ts"),
        }])[-_MAX_LOGS:]
    elif etype == "progress":
        doc["progress"] = event.get("progress", 0)
    elif etype == "error" or etype == "run_failed":
        doc["error"] = event.get("message")
    else:
        return
    doc["updated_at"] = now
    await _save_doc(project_id, doc)
