"""LangGraph checkpointer backed by the existing PostgreSQL / Supabase database.

Uses ``langgraph-checkpoint-postgres`` to persist the full graph state after
every node execution. This enables:
  - Human-in-the-loop interrupts (pause at approval nodes, resume later)
  - Crash recovery (pick up exactly where we left off)
  - State inspection (query what the graph looks like at any point)

The checkpointer shares the same DATABASE_URL used by the rest of ai-services,
so no additional infrastructure is needed.
"""
from __future__ import annotations

import os

from utils.logging import get_logger

logger = get_logger("graph.checkpointer")

DATABASE_URL = os.getenv(
    "DATABASE_URL", "postgresql://devflow:devflow@postgres:5432/devflow"
)


async def get_checkpointer():
    """Create and return an async PostgreSQL checkpointer for LangGraph.

    The checkpointer automatically creates its required tables on first use.
    We use the async variant because the entire ai-services stack is async.
    """
    try:
        from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver

        checkpointer = AsyncPostgresSaver.from_conn_string(DATABASE_URL)
        await checkpointer.setup()
        logger.info("LangGraph PostgreSQL checkpointer initialized")
        return checkpointer
    except ImportError:
        logger.warning(
            "langgraph-checkpoint-postgres not installed; "
            "falling back to in-memory checkpointer (state will NOT persist across restarts)"
        )
        from langgraph.checkpoint.memory import MemorySaver
        return MemorySaver()
    except Exception as exc:
        logger.warning(
            "Could not connect PostgreSQL checkpointer: %s; "
            "falling back to in-memory checkpointer", exc
        )
        from langgraph.checkpoint.memory import MemorySaver
        return MemorySaver()
