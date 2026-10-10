"""LangGraph checkpointer backed by the existing PostgreSQL / Supabase database.

Uses ``langgraph-checkpoint-postgres`` to persist the full graph state after
every node execution. This enables:
  - Human-in-the-loop interrupts (pause at approval nodes, resume later)
  - Crash recovery (pick up exactly where we left off)
  - State inspection (query what the graph looks like at any point)

The checkpointer shares the same DATABASE_URL used by the rest of ai-services,
so no additional infrastructure is needed.

State must be durable and shared: ai-services runs several worker processes,
and an approval or retry may land on a different one than the original run.
So there is no silent in-memory fallback — if Postgres is unreachable the
request fails (retryably) and the backend tries again later. Set
``LANGGRAPH_CHECKPOINTER=memory`` to opt into in-memory state for local
single-process experiments.
"""
from __future__ import annotations

import asyncio
import os

from utils.logging import get_logger

logger = get_logger("graph.checkpointer")

DATABASE_URL = os.getenv(
    "DATABASE_URL", "postgresql://devflow:devflow@postgres:5432/devflow"
)


class CheckpointerUnavailable(RuntimeError):
    """Raised when durable workflow state cannot be reached."""


async def get_checkpointer():
    """Create and return an async PostgreSQL checkpointer for LangGraph."""
    if os.getenv("LANGGRAPH_CHECKPOINTER", "postgres").lower() == "memory":
        from langgraph.checkpoint.memory import MemorySaver
        logger.warning("Using in-memory LangGraph checkpointer (state will NOT survive restarts)")
        return MemorySaver()

    from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
    from psycopg.rows import dict_row
    from psycopg_pool import AsyncConnectionPool

    pool = AsyncConnectionPool(
        conninfo=DATABASE_URL,
        min_size=1,
        max_size=5,
        open=False,
        # prepare_threshold=None: Supabase's transaction pooler (pgbouncer)
        # cannot route server-side prepared statements.
        kwargs={"autocommit": True, "prepare_threshold": None, "row_factory": dict_row},
        check=AsyncConnectionPool.check_connection,
    )
    try:
        await pool.open(wait=True, timeout=20)
        checkpointer = AsyncPostgresSaver(pool)
        # Several worker processes may run migrations at once; a loser of
        # that race just tries again.
        for attempt in range(3):
            try:
                await checkpointer.setup()
                break
            except Exception:
                if attempt == 2:
                    raise
                await asyncio.sleep(1 + attempt)
    except Exception as exc:
        await pool.close()
        raise CheckpointerUnavailable(f"Workflow state store unavailable: {exc}") from exc

    logger.info("LangGraph PostgreSQL checkpointer initialized")
    return checkpointer
