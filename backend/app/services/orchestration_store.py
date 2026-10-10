"""PostgreSQL-backed job queue and orchestration event replay store.

Jobs are claimed with ``FOR UPDATE SKIP LOCKED`` and held under a lease that the
owning worker renews with ``heartbeat``. A worker that dies (crash, deploy,
OOM) stops renewing, its lease expires, and the job is re-queued for any
worker in any process — so no run is ever stranded in ``running``.
"""
from __future__ import annotations

from typing import Any

from app.db.postgres import execute, fetch, fetchrow


async def submit(project_id: str, request: dict[str, Any]) -> tuple[int | None, bool]:
    """Queue a job unless one is already active for the project.

    Returns ``(job_id, created)``; when a job is already queued or running its
    id is returned with ``created=False``.
    """
    row = await fetchrow(
        """INSERT INTO orchestration_jobs(project_id, request)
           VALUES ($1, $2)
           ON CONFLICT (project_id) WHERE status IN ('queued', 'running') DO NOTHING
           RETURNING id""",
        project_id, request,
    )
    if row:
        return int(row["id"]), True
    return await active_job(project_id), False


async def active_job(project_id: str) -> int | None:
    row = await fetchrow(
        """SELECT id FROM orchestration_jobs
           WHERE project_id=$1 AND status IN ('queued','running')
           ORDER BY created_at DESC LIMIT 1""",
        project_id,
    )
    return int(row["id"]) if row else None


async def claim(
    worker_id: str, lease_seconds: int
) -> tuple[int, str, dict[str, Any], int, float] | None:
    """Claim the next due job: ``(id, project_id, request, attempt, age_seconds)``."""
    # A process killed mid-run leaves a lease, not a permanently stuck job.
    await execute(
        """UPDATE orchestration_jobs
           SET status='queued', locked_at=NULL, locked_by=NULL, updated_at=NOW(),
               error='Recovered after expired worker lease'
           WHERE status='running' AND locked_at < NOW() - ($1 * INTERVAL '1 second')""",
        lease_seconds,
    )
    row = await fetchrow(
        """WITH candidate AS (
               SELECT id FROM orchestration_jobs
               WHERE status='queued' AND available_at <= NOW()
               ORDER BY available_at, created_at
               FOR UPDATE SKIP LOCKED LIMIT 1
           )
           UPDATE orchestration_jobs job
           SET status='running', attempt=attempt+1, locked_at=NOW(),
               locked_by=$1, updated_at=NOW()
           FROM candidate WHERE job.id=candidate.id
           RETURNING job.id, job.project_id, job.request, job.attempt,
                     EXTRACT(EPOCH FROM NOW() - job.created_at)::float8 AS age""",
        worker_id,
    )
    if not row:
        return None
    return (int(row["id"]), str(row["project_id"]), dict(row["request"]),
            int(row["attempt"]), float(row["age"]))


async def heartbeat(job_id: int, worker_id: str) -> bool:
    """Renew the lease; False means another worker has taken the job over."""
    row = await fetchrow(
        """UPDATE orchestration_jobs SET locked_at=NOW(), updated_at=NOW()
           WHERE id=$1 AND locked_by=$2 AND status='running' RETURNING id""",
        job_id, worker_id,
    )
    return row is not None


async def is_running(job_id: int, worker_id: str) -> bool:
    """False once the job was cancelled (Stop) or handed to another worker."""
    row = await fetchrow(
        "SELECT 1 FROM orchestration_jobs WHERE id=$1 AND locked_by=$2 AND status='running'",
        job_id, worker_id,
    )
    return row is not None


async def cancel_active(project_id: str, reason: str) -> int:
    """Cancel the project's queued/running job; its worker notices within seconds."""
    rows = await fetch(
        """UPDATE orchestration_jobs SET status='cancelled', error=$2, completed_at=NOW(),
                  updated_at=NOW()
           WHERE project_id=$1 AND status IN ('queued', 'running') RETURNING id""",
        project_id, reason,
    )
    return len(rows)


async def requeue(
    job_id: int, delay_seconds: float, error: str | None, *, refund_attempt: bool = False
) -> None:
    """Put a job back in the queue. ``refund_attempt`` is for interruptions
    that were not the run's fault (shutdown), so they don't use up retries."""
    await execute(
        """UPDATE orchestration_jobs
           SET status='queued', locked_at=NULL, locked_by=NULL, error=$3,
               attempt=CASE WHEN $4 THEN GREATEST(attempt - 1, 0) ELSE attempt END,
               available_at=NOW() + ($2 * INTERVAL '1 second'), updated_at=NOW()
           WHERE id=$1""",
        job_id, float(delay_seconds), error, refund_attempt,
    )


async def finish(job_id: int, status: str, error: str | None = None) -> None:
    await execute(
        """UPDATE orchestration_jobs SET status=$2, error=$3, locked_at=NULL,
                  locked_by=NULL, completed_at=NOW(), updated_at=NOW()
           WHERE id=$1""",
        job_id, status, error,
    )


async def orphaned_projects(stale_seconds: int) -> list[tuple[str, float]]:
    """Projects that claim to be queued/running but have no job driving them,
    with how long (seconds) each has been idle."""
    rows = await fetch(
        """SELECT p.id, EXTRACT(EPOCH FROM NOW() - p.updated_at)::float8 AS idle
           FROM projects p
           WHERE p.status IN ('queued', 'running')
             AND p.updated_at < NOW() - ($1 * INTERVAL '1 second')
             AND NOT EXISTS (
                 SELECT 1 FROM orchestration_jobs j
                 WHERE j.project_id = p.id AND j.status IN ('queued', 'running')
             )""",
        stale_seconds,
    )
    return [(str(row["id"]), float(row["idle"])) for row in rows]


async def append_event(job_id: int, project_id: str, event: dict[str, Any]) -> int:
    row = await fetchrow(
        """INSERT INTO orchestration_events(job_id, project_id, event_type, payload)
           VALUES ($1,$2,$3,$4) RETURNING id""",
        job_id, project_id, str(event.get("type", "unknown")), event,
    )
    return int(row["id"])


async def latest_job(project_id: str) -> int | None:
    row = await fetchrow(
        "SELECT id FROM orchestration_jobs WHERE project_id=$1 ORDER BY created_at DESC LIMIT 1",
        project_id,
    )
    return int(row["id"]) if row else None


async def events_after(job_id: int, event_id: int = 0, limit: int = 2000) -> list[dict[str, Any]]:
    rows = await fetch(
        """SELECT id, payload FROM orchestration_events
           WHERE job_id=$1 AND id>$2 ORDER BY id LIMIT $3""",
        job_id, event_id, limit,
    )
    events: list[dict[str, Any]] = []
    for row in rows:
        payload = dict(row["payload"])
        payload["event_id"] = int(row["id"])
        events.append(payload)
    return events
