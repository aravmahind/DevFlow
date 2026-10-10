"""PostgreSQL database client for AI Services.

Provides connection pooling and retrieval of authoritative project documents,
previous versions, iteration revisions, and chat history.
"""
from __future__ import annotations

import json
import os
import ssl
import urllib.parse
from typing import Any

import asyncpg

from utils.logging import get_logger

logger = get_logger("services.db")

DATABASE_URL = os.getenv(
    "DATABASE_URL", "postgresql://devflow:devflow@postgres:5432/devflow"
)
_pool: asyncpg.Pool | None = None


def _prepare_dsn_and_ssl(dsn: str) -> tuple[str, Any]:
    url = dsn.strip()
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://"):]

    parsed = urllib.parse.urlparse(url)
    query_params = urllib.parse.parse_qs(parsed.query)
    ssl_mode = query_params.get("sslmode", [None])[0]

    if "sslmode" in query_params:
        clean_query = urllib.parse.urlencode(
            {k: v for k, v in query_params.items() if k != "sslmode"}, doseq=True
        )
        url = urllib.parse.urlunparse(parsed._replace(query=clean_query))

    ssl_arg = None
    if ssl_mode in ("require", "verify-ca", "verify-full"):
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        ssl_arg = ctx
    elif ssl_mode == "disable":
        ssl_arg = None
    elif parsed.hostname and parsed.hostname not in ("localhost", "127.0.0.1", "postgres"):
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        ssl_arg = ctx

    return url, ssl_arg


async def get_db_pool() -> asyncpg.Pool | None:
    """Return the global asyncpg connection pool."""
    global _pool
    if _pool is not None:
        return _pool
    try:
        clean_dsn, ssl_ctx = _prepare_dsn_and_ssl(DATABASE_URL)
        kwargs: dict[str, Any] = {"min_size": 1, "max_size": 5, "statement_cache_size": 0}
        if ssl_ctx is not None:
            kwargs["ssl"] = ssl_ctx
        _pool = await asyncpg.create_pool(clean_dsn, **kwargs)
        logger.info("Connected to PostgreSQL / Supabase database for AI Services")
        return _pool
    except Exception as exc:
        logger.warning("Could not connect to PostgreSQL database: %s", exc)
        return None


async def close_db() -> None:
    """Close the database pool."""
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None
        logger.info("Closed PostgreSQL database pool")


async def fetch_project_document(project_id: str) -> dict[str, Any] | None:
    """Fetch the current full project document from PostgreSQL."""
    pool = await get_db_pool()
    if not pool:
        return None
    try:
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT id, user_id, title, status, progress, document, created_at, updated_at "
                "FROM projects WHERE id = $1",
                project_id,
            )
            if not row:
                return None
            doc = row["document"]
            if isinstance(doc, str):
                doc = json.loads(doc)
            return {
                "id": row["id"],
                "user_id": row["user_id"],
                "title": row["title"],
                "status": row["status"],
                "progress": row["progress"],
                "document": doc,
                "created_at": row["created_at"].isoformat() if row["created_at"] else None,
                "updated_at": row["updated_at"].isoformat() if row["updated_at"] else None,
            }
    except Exception as exc:
        logger.warning("Failed to fetch project %s from DB: %s", project_id, exc)
        return None


async def fetch_project_chat_history(project_id: str, limit: int = 20) -> list[dict[str, Any]]:
    """Fetch recent assistant and user chat history for the project."""
    pool = await get_db_pool()
    if not pool:
        return []
    try:
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                "SELECT kind, role, content, payload, created_at "
                "FROM ai_responses WHERE project_id = $1 AND kind = 'chat' "
                "ORDER BY created_at ASC LIMIT $2",
                project_id,
                limit,
            )
            return [
                {
                    "role": r["role"],
                    "content": r["content"],
                    "created_at": r["created_at"].isoformat() if r["created_at"] else None,
                }
                for r in rows
            ]
    except Exception as exc:
        logger.warning("Failed to fetch chat history for %s: %s", project_id, exc)
        return []


async def _resolve_user_id(conn: Any, project_id: str, fallback_user_id: str = "system") -> str:
    """Resolve a valid user_id that exists in the users table."""
    try:
        row = await conn.fetchrow("SELECT user_id FROM projects WHERE id = $1", project_id)
        if row and row["user_id"]:
            return row["user_id"]
        # Fallback to first user in users table
        user_row = await conn.fetchrow("SELECT clerk_user_id FROM users LIMIT 1")
        if user_row:
            return user_row["clerk_user_id"]
    except Exception:
        pass
    return fallback_user_id


async def save_project_iteration(
    project_id: str,
    user_id: str,
    section: str,
    data: dict[str, Any],
    iteration_label: str = "reiteration",
) -> None:
    """Save an iteration revision snapshot to ai_responses."""
    pool = await get_db_pool()
    if not pool:
        return
    try:
        async with pool.acquire() as conn:
            valid_user_id = await _resolve_user_id(conn, project_id, user_id)
            await conn.execute(
                "INSERT INTO ai_responses (project_id, user_id, kind, role, content, payload) "
                "VALUES ($1, $2, $3, $4, $5, $6)",
                project_id,
                valid_user_id,
                iteration_label,
                "assistant",
                f"Iteration update for section '{section}'",
                json.dumps(data, default=str),
            )
    except Exception as exc:
        logger.warning("Failed to save iteration snapshot for %s: %s", project_id, exc)


async def save_agent_output(
    project_id: str,
    user_id: str,
    agent_id: str,
    section: str,
    data: dict[str, Any],
    version: int = 1,
) -> None:
    """Store a versioned agent output as a structured record in ai_responses."""
    pool = await get_db_pool()
    if not pool:
        return
    try:
        payload = {"agent_id": agent_id, "section": section, "version": version, "data": data}
        async with pool.acquire() as conn:
            valid_user_id = await _resolve_user_id(conn, project_id, user_id)
            await conn.execute(
                "INSERT INTO ai_responses (project_id, user_id, kind, role, content, payload) "
                "VALUES ($1, $2, $3, $4, $5, $6)",
                project_id,
                valid_user_id,
                f"agent_output:{agent_id}",
                "assistant",
                f"Agent '{agent_id}' output v{version} for section '{section}'",
                json.dumps(payload, default=str),
            )
    except Exception as exc:
        logger.warning("Failed to save agent output for %s/%s: %s", project_id, agent_id, exc)


async def fetch_agent_output(project_id: str, agent_id: str) -> dict[str, Any] | None:
    """Fetch the latest output for one specific agent."""
    pool = await get_db_pool()
    if not pool:
        return None
    try:
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT payload FROM ai_responses "
                "WHERE project_id = $1 AND kind = $2 "
                "ORDER BY created_at DESC LIMIT 1",
                project_id,
                f"agent_output:{agent_id}",
            )
            if not row:
                return None
            payload = row["payload"]
            if isinstance(payload, str):
                payload = json.loads(payload)
            return payload.get("data") if isinstance(payload, dict) else None
    except Exception as exc:
        logger.warning("Failed to fetch agent output for %s/%s: %s", project_id, agent_id, exc)
        return None


async def fetch_agent_outputs(project_id: str) -> dict[str, dict[str, Any]]:
    """Fetch all latest agent outputs for a project, keyed by section."""
    pool = await get_db_pool()
    if not pool:
        return {}
    try:
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                "SELECT DISTINCT ON (kind) kind, payload FROM ai_responses "
                "WHERE project_id = $1 AND kind LIKE 'agent_output:%' "
                "ORDER BY kind, created_at DESC",
                project_id,
            )
            result: dict[str, dict[str, Any]] = {}
            for row in rows:
                payload = row["payload"]
                if isinstance(payload, str):
                    payload = json.loads(payload)
                if isinstance(payload, dict):
                    section = payload.get("section", "")
                    data = payload.get("data", {})
                    if section and data:
                        result[section] = data
            return result
    except Exception as exc:
        logger.warning("Failed to fetch agent outputs for %s: %s", project_id, exc)
        return {}


async def save_quality_record(
    project_id: str,
    agent_id: str,
    passed: bool,
    issues: list[str],
) -> None:
    """Store a quality gate result for an agent."""
    pool = await get_db_pool()
    if not pool:
        return
    try:
        payload = {"agent_id": agent_id, "passed": passed, "issues": issues}
        async with pool.acquire() as conn:
            valid_user_id = await _resolve_user_id(conn, project_id, "system")
            await conn.execute(
                "INSERT INTO ai_responses (project_id, user_id, kind, role, content, payload) "
                "VALUES ($1, $2, $3, $4, $5, $6)",
                project_id,
                valid_user_id,
                f"quality:{agent_id}",
                "system",
                f"Quality gate for '{agent_id}': {'PASSED' if passed else 'FAILED'}",
                json.dumps(payload, default=str),
            )
    except Exception as exc:
        logger.warning("Failed to save quality record for %s/%s: %s", project_id, agent_id, exc)


async def fetch_github_snapshot(project_id: str) -> dict[str, Any] | None:
    """Compact GitHub tracker snapshot written by the backend after each repo sync."""
    pool = await get_db_pool()
    if not pool:
        return None
    try:
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT status_report->'tracker_snapshot' AS snap FROM github_links "
                "WHERE project_id = $1 AND sync_status <> 'pending'",
                project_id,
            )
    except Exception as exc:  # table absent on older schemas, or DB unavailable
        logger.info("No GitHub snapshot for %s: %s", project_id, exc)
        return None
    snap = row["snap"] if row else None
    if isinstance(snap, str):
        snap = json.loads(snap)
    return snap or None
