"""PostgreSQL pool and schema for users, projects, and durable AI output."""
from __future__ import annotations

import json
from typing import Any

import asyncpg

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger("db.postgres")
_pool: asyncpg.Pool | None = None

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    clerk_user_id TEXT PRIMARY KEY,
    email TEXT,
    first_name TEXT,
    last_name TEXT,
    image_url TEXT,
    role TEXT NOT NULL DEFAULT 'developer',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'developer';
CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(clerk_user_id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    status TEXT NOT NULL,
    progress INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
    document JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    owner_id TEXT NOT NULL REFERENCES users(clerk_user_id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS workspace_members (
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(clerk_user_id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'editor', 'viewer')),
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (workspace_id, user_id)
);
CREATE TABLE IF NOT EXISTS workspace_invites (
    token TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('admin', 'editor', 'viewer')),
    created_by TEXT NOT NULL REFERENCES users(clerk_user_id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    accepted_by TEXT REFERENCES users(clerk_user_id),
    accepted_at TIMESTAMPTZ
);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS projects_user_created_idx ON projects(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS projects_workspace_created_idx ON projects(workspace_id, created_at DESC);
CREATE TABLE IF NOT EXISTS project_revisions (
    id BIGSERIAL PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    request JSONB NOT NULL DEFAULT '{}'::jsonb,
    actor_id TEXT NOT NULL REFERENCES users(clerk_user_id) ON DELETE CASCADE,
    revision INTEGER NOT NULL,
    operation TEXT NOT NULL,
    path TEXT,
    before_document JSONB NOT NULL,
    after_document JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(project_id, revision)
);
CREATE INDEX IF NOT EXISTS project_revisions_project_idx ON project_revisions(project_id, revision DESC);
CREATE TABLE IF NOT EXISTS ai_responses (
    id BIGSERIAL PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(clerk_user_id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'assistant',
    content TEXT,
    payload JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ai_responses_project_created_idx
    ON ai_responses(project_id, created_at ASC);

-- Tenant-scoped source documents used by the RAG pipeline. The project JSONB
-- document remains the UI read model; these records retain source provenance.
CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE IF NOT EXISTS project_documents (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    created_by TEXT NOT NULL REFERENCES users(clerk_user_id) ON DELETE RESTRICT,
    title TEXT NOT NULL,
    source_type TEXT NOT NULL DEFAULT 'text'
        CHECK (source_type IN ('text', 'spec', 'repo', 'tickets', 'url', 'file')),
    mime_type TEXT NOT NULL DEFAULT 'text/plain',
    content TEXT NOT NULL,
    content_sha256 TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'indexed', 'failed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(project_id, content_sha256)
);
CREATE INDEX IF NOT EXISTS project_documents_project_idx
    ON project_documents(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS project_documents_workspace_idx
    ON project_documents(workspace_id, created_at DESC);

-- Hybrid RAG index: pgvector similarity plus PostgreSQL full-text ranking.
-- Every row carries workspace_id and project_id so retrieval cannot cross a
-- tenant boundary even if a caller supplies an adversarial query.
CREATE TABLE IF NOT EXISTS knowledge_chunks (
    id BIGSERIAL PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    document_id TEXT REFERENCES project_documents(id) ON DELETE CASCADE,
    source_kind TEXT NOT NULL,
    source_key TEXT NOT NULL,
    source_title TEXT NOT NULL,
    chunk_index INTEGER NOT NULL CHECK (chunk_index >= 0),
    content TEXT NOT NULL,
    token_count INTEGER NOT NULL DEFAULT 0 CHECK (token_count >= 0),
    content_sha256 TEXT NOT NULL,
    embedding VECTOR(384) NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    search_vector TSVECTOR GENERATED ALWAYS AS
        (to_tsvector('english', coalesce(source_title, '') || ' ' || content)) STORED,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(project_id, source_kind, source_key, chunk_index)
);
CREATE INDEX IF NOT EXISTS knowledge_chunks_scope_idx
    ON knowledge_chunks(workspace_id, project_id, source_kind);
CREATE INDEX IF NOT EXISTS knowledge_chunks_search_idx
    ON knowledge_chunks USING GIN(search_vector);
CREATE INDEX IF NOT EXISTS knowledge_chunks_embedding_idx
    ON knowledge_chunks USING HNSW (embedding vector_cosine_ops);

-- Durable memories are distilled facts/decisions, not raw chat history. They
-- are separately searchable and supersedable to avoid stale-context buildup.
CREATE TABLE IF NOT EXISTS project_memories (
    id BIGSERIAL PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    agent_id TEXT NOT NULL,
    memory_type TEXT NOT NULL
        CHECK (memory_type IN ('decision', 'constraint', 'fact', 'feedback', 'lesson')),
    content TEXT NOT NULL,
    content_sha256 TEXT NOT NULL,
    importance SMALLINT NOT NULL DEFAULT 3 CHECK (importance BETWEEN 1 AND 5),
    embedding VECTOR(384) NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    search_vector TSVECTOR GENERATED ALWAYS AS
        (to_tsvector('english', content)) STORED,
    superseded_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE project_memories ADD COLUMN IF NOT EXISTS content_sha256 TEXT;
ALTER TABLE project_memories ADD COLUMN IF NOT EXISTS search_vector TSVECTOR
    GENERATED ALWAYS AS (to_tsvector('english', content)) STORED;
CREATE INDEX IF NOT EXISTS project_memories_scope_idx
    ON project_memories(workspace_id, project_id, agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS project_memories_embedding_idx
    ON project_memories USING HNSW (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS project_memories_search_idx
    ON project_memories USING GIN(search_vector);
CREATE UNIQUE INDEX IF NOT EXISTS project_memories_active_digest_idx
    ON project_memories(project_id, agent_id, memory_type, content_sha256)
    WHERE superseded_at IS NULL;

-- One run and many steps provide provenance for retrieval, tools, generation,
-- validation, retries, and supervision. This is the operational audit trail
-- missing from a plain AI_RESPONSE table.
CREATE TABLE IF NOT EXISTS agent_runs (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    trigger TEXT NOT NULL DEFAULT 'analysis',
    status TEXT NOT NULL DEFAULT 'running'
        CHECK (status IN ('running', 'complete', 'failed', 'cancelled')),
    input JSONB NOT NULL DEFAULT '{}'::jsonb,
    output_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
    metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
    error TEXT,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS agent_runs_project_idx
    ON agent_runs(project_id, started_at DESC);
CREATE TABLE IF NOT EXISTS agent_run_steps (
    id BIGSERIAL PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
    agent_id TEXT NOT NULL,
    phase TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('started', 'complete', 'failed', 'skipped')),
    tool_name TEXT,
    input_context JSONB NOT NULL DEFAULT '{}'::jsonb,
    output JSONB NOT NULL DEFAULT '{}'::jsonb,
    duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS agent_run_steps_run_idx
    ON agent_run_steps(run_id, id);

-- Durable orchestration queue and replay log. PostgreSQL SKIP LOCKED permits
-- multiple API/worker replicas without duplicate project execution.
CREATE TABLE IF NOT EXISTS orchestration_jobs (
    id BIGSERIAL PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    request JSONB NOT NULL DEFAULT '{}'::jsonb,
    status TEXT NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'running', 'complete', 'failed', 'cancelled')),
    attempt INTEGER NOT NULL DEFAULT 0,
    available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    locked_at TIMESTAMPTZ,
    locked_by TEXT,
    error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);
ALTER TABLE orchestration_jobs
    ADD COLUMN IF NOT EXISTS request JSONB NOT NULL DEFAULT '{}'::jsonb;
CREATE UNIQUE INDEX IF NOT EXISTS orchestration_jobs_one_active_project_idx
    ON orchestration_jobs(project_id) WHERE status IN ('queued', 'running');
CREATE INDEX IF NOT EXISTS orchestration_jobs_claim_idx
    ON orchestration_jobs(status, available_at, created_at);
CREATE TABLE IF NOT EXISTS orchestration_events (
    id BIGSERIAL PRIMARY KEY,
    job_id BIGINT NOT NULL REFERENCES orchestration_jobs(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS orchestration_events_job_idx
    ON orchestration_events(job_id, id);
CREATE INDEX IF NOT EXISTS orchestration_events_project_idx
    ON orchestration_events(project_id, id DESC);

-- RBAC: user specialization
ALTER TABLE users ADD COLUMN IF NOT EXISTS specialization TEXT;

-- RBAC: project-level membership and role assignment
CREATE TABLE IF NOT EXISTS project_members (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(clerk_user_id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('manager', 'developer', 'tester')),
    specialization TEXT,
    invited_by TEXT REFERENCES users(clerk_user_id),
    invited_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    accepted_at TIMESTAMPTZ,
    PRIMARY KEY (project_id, user_id)
);
CREATE INDEX IF NOT EXISTS project_members_user_idx ON project_members(user_id);

-- RBAC: project-level email invitations
CREATE TABLE IF NOT EXISTS project_invites (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('manager', 'developer', 'tester')),
    specialization TEXT,
    invited_by TEXT NOT NULL REFERENCES users(clerk_user_id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    accepted_by TEXT REFERENCES users(clerk_user_id),
    accepted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS project_invites_email_idx ON project_invites(email);
CREATE INDEX IF NOT EXISTS project_invites_project_idx ON project_invites(project_id);

-- GitHub linking: one repository per project. Commits are ingested on every
-- push (webhook) or poll, and each commit is AI-mapped onto plan items so the
-- workspace can show what has actually been implemented and by whom.
CREATE TABLE IF NOT EXISTS github_links (
    project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    owner TEXT NOT NULL,
    repo TEXT NOT NULL,
    default_branch TEXT NOT NULL DEFAULT 'main',
    access_token TEXT,
    webhook_secret TEXT NOT NULL,
    webhook_id BIGINT,
    repo_meta JSONB NOT NULL DEFAULT '{}'::jsonb,
    status_report JSONB NOT NULL DEFAULT '{}'::jsonb,
    sync_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (sync_status IN ('pending', 'syncing', 'ready', 'failed')),
    sync_error TEXT,
    sync_started_at TIMESTAMPTZ,
    resync_requested BOOLEAN NOT NULL DEFAULT FALSE,
    head_sha TEXT,
    last_synced_at TIMESTAMPTZ,
    linked_by TEXT REFERENCES users(clerk_user_id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS github_links_repo_idx ON github_links(lower(owner), lower(repo));
-- A user's connected GitHub account (OAuth). A link made through it records the
-- account owner in account_user_id and reads with their token; no FK, so a
-- disconnected account surfaces as "reconnect" rather than silently going anonymous.
CREATE TABLE IF NOT EXISTS github_accounts (
    user_id TEXT PRIMARY KEY REFERENCES users(clerk_user_id) ON DELETE CASCADE,
    github_user_id BIGINT NOT NULL,
    login TEXT NOT NULL,
    name TEXT,
    avatar_url TEXT,
    access_token TEXT NOT NULL,
    scopes TEXT NOT NULL DEFAULT '',
    invalid_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE github_links ADD COLUMN IF NOT EXISTS account_user_id TEXT;
CREATE TABLE IF NOT EXISTS github_commits (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    sha TEXT NOT NULL,
    author_login TEXT,
    author_name TEXT,
    author_email TEXT,
    author_avatar TEXT,
    committed_at TIMESTAMPTZ,
    message TEXT NOT NULL DEFAULT '',
    url TEXT,
    additions INTEGER NOT NULL DEFAULT 0,
    deletions INTEGER NOT NULL DEFAULT 0,
    files JSONB NOT NULL DEFAULT '[]'::jsonb,
    analysis JSONB NOT NULL DEFAULT '{}'::jsonb,
    analyzed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (project_id, sha)
);
CREATE INDEX IF NOT EXISTS github_commits_project_time_idx
    ON github_commits(project_id, committed_at DESC);

-- Migrate existing project creators into project_members as managers
INSERT INTO project_members (project_id, user_id, role, accepted_at)
SELECT p.id, p.user_id, 'manager', p.created_at
FROM projects p
WHERE NOT EXISTS (
    SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = p.user_id
)
ON CONFLICT DO NOTHING;
"""


import ssl
import urllib.parse

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger("db.postgres")
_pool: asyncpg.Pool | None = None


def _prepare_dsn_and_ssl(dsn: str) -> tuple[str, Any]:
    url = dsn.strip()
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://"):]

    parsed = urllib.parse.urlparse(url)
    query_params = urllib.parse.parse_qs(parsed.query)
    ssl_mode = query_params.get("sslmode", [None])[0]

    # Strip sslmode parameter from query if present for asyncpg compatibility
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
        # Cloud/Supabase hosts require SSL
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        ssl_arg = ctx

    return url, ssl_arg


async def init_postgres() -> None:
    global _pool
    clean_dsn, ssl_ctx = _prepare_dsn_and_ssl(settings.database_url)
    kwargs: dict[str, Any] = {"min_size": 1, "max_size": 10, "statement_cache_size": 0}
    if ssl_ctx is not None:
        kwargs["ssl"] = ssl_ctx

    _pool = await asyncpg.create_pool(clean_dsn, **kwargs)
    async with _pool.acquire() as conn:
        await conn.set_type_codec("jsonb", encoder=json.dumps, decoder=json.loads, schema="pg_catalog")
        await conn.execute("SELECT pg_advisory_lock(hashtext('devflow_schema_v2'))")
        try:
            await conn.execute(SCHEMA)
        finally:
            await conn.execute("SELECT pg_advisory_unlock(hashtext('devflow_schema_v2'))")
    logger.info("PostgreSQL / Supabase schema ensured")


def pool() -> asyncpg.Pool:
    if _pool is None:
        raise RuntimeError("PostgreSQL has not been initialized")
    return _pool


async def fetchrow(query: str, *args: Any) -> asyncpg.Record | None:
    async with pool().acquire() as conn:
        await conn.set_type_codec("jsonb", encoder=json.dumps, decoder=json.loads, schema="pg_catalog")
        return await conn.fetchrow(query, *args)


async def fetch(query: str, *args: Any) -> list[asyncpg.Record]:
    async with pool().acquire() as conn:
        await conn.set_type_codec("jsonb", encoder=json.dumps, decoder=json.loads, schema="pg_catalog")
        return await conn.fetch(query, *args)


async def execute(query: str, *args: Any) -> str:
    async with pool().acquire() as conn:
        await conn.set_type_codec("jsonb", encoder=json.dumps, decoder=json.loads, schema="pg_catalog")
        return await conn.execute(query, *args)


async def close_postgres() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None
