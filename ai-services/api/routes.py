"""AI-services HTTP API (v2 — LangGraph).

* ``GET  /agents``                  list the AI org
* ``POST /agents/{agent_id}/run``   run one agent independently (testable)
* ``POST /workflow/stream``         execute the LangGraph orchestration (streams updates)
* ``POST /workflow/approve``        resume the graph after human approval
* ``POST /assistant/chat``          chat with project state
"""
from __future__ import annotations

import asyncio
import json
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from agents.registry import AGENTS, get_agent
from api.auth import require_internal_auth
from graph.orchestrator import get_compiled_graph
from services.assistant import chat as assistant_chat
from services import github_insights
from utils.logging import get_logger

logger = get_logger("api")
router = APIRouter(dependencies=[Depends(require_internal_auth)])


class AgentRunRequest(BaseModel):
    context: dict[str, Any] = Field(
        default_factory=dict,
        description="Accumulated project context; must at least include 'idea'.",
    )


class WorkflowRunRequest(BaseModel):
    project_id: str
    idea: str
    title: str | None = None
    state_updates: dict[str, Any] = Field(
        default_factory=dict,
        description="Optional initial state overrides"
    )
    resume: bool = Field(
        default=False,
        description="Continue from the project's last checkpoint instead of starting over",
    )


class ApprovalRequest(BaseModel):
    project_id: str
    phase: str
    approved: bool
    feedback: str = ""
    decision_id: str | None = Field(
        default=None,
        description="Idempotency key: a decision already applied under this id is not applied again",
    )


class ChatMessage(BaseModel):
    role: str
    content: str


class AssistantChatRequest(BaseModel):
    project: dict[str, Any] = Field(default_factory=dict)
    message: str
    history: list[ChatMessage] = Field(default_factory=list)


@router.get("/agents")
async def list_agents() -> dict[str, Any]:
    return {
        "agents": [
            {"id": a.id, "name": a.name, "role": a.role, "node": a.node}
            for a in AGENTS.values()
        ]
    }


@router.post("/agents/{agent_id}/run")
async def run_agent(agent_id: str, req: AgentRunRequest) -> dict[str, Any]:
    try:
        agent = get_agent(agent_id)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"unknown agent '{agent_id}'")
    if not req.context.get("idea"):
        raise HTTPException(status_code=422, detail="context.idea is required")
    try:
        # Note: Type hinting in agent.run expects ProjectState, but passing dict works at runtime.
        data = await agent.run(req.context) # type: ignore
    except Exception as exc:
        logger.exception("Agent %s failed", agent_id)
        raise HTTPException(status_code=502, detail=f"agent execution failed: {exc}")
    return {"agent": agent_id, "node": agent.node, "data": data}


_HEARTBEAT_SECONDS = 15.0
_GATE_FOR_PHASE = {
    "requirements": "await_req_approval",
    "architecture": "await_arch_approval",
    "sprint_planning": "await_sprint_approval",
    "sprint_review": "await_sprint_review",
}
_PHASE_FOR_GATE = {gate: phase for phase, gate in _GATE_FOR_PHASE.items()}


def _line(event: dict[str, Any]) -> str:
    return json.dumps(event, default=str) + "\n"


def _is_retryable(exc: BaseException) -> bool:
    """Provider/client errors (bad key, unknown model, bad request) won't fix
    themselves on retry; throttles, outages, timeouts and flaky output might."""
    if _is_daily_quota(exc):
        return False
    status = getattr(exc, "status_code", None)
    if not isinstance(status, int):
        status = getattr(getattr(exc, "response", None), "status_code", None)
    if isinstance(status, int):
        return status >= 500 or status in (408, 409, 425, 429)
    return True


def _is_daily_quota(exc: BaseException) -> bool:
    # A per-day limit won't reset within any sensible retry backoff.
    text = str(exc).lower()
    return "per day" in text or "(tpd)" in text or "(rpd)" in text


def _error_event(exc: BaseException) -> str:
    message = str(exc) or type(exc).__name__
    if _is_daily_quota(exc):
        message = ("The LLM provider's daily token quota is used up. Retry once it resets "
                   f"or switch models in .env. ({message[:300]})")
    return _line({"type": "error", "message": message, "retryable": _is_retryable(exc)})


def _translate(event: Any) -> list[str]:
    if not (isinstance(event, tuple) and len(event) == 2 and isinstance(event[0], str)):
        return []
    mode, payload = event
    lines = []
    if mode == "debug":
        etype = str(payload.get("type", ""))
        name = payload.get("name") or payload.get("payload", {}).get("name")
        if name and not str(name).startswith("__") and etype in ("task:runs", "task", "task:step", "run"):
            label = str(name).replace("_", " ").title()
            lines.append(_line({
                "type": "log",
                "agent": str(name),
                "level": "info",
                "message": f"Specialist Agent [{label}] started analysis...",
                "ts": datetime.now(timezone.utc).isoformat(),
            }))
    elif mode == "updates":
        # payload maps node_name -> state_update
        for node, update in payload.items():
            lines.append(_line({"type": "node_update", "node": node, "state": update}))
            label = str(node).replace("_", " ").title()
            lines.append(_line({
                "type": "log",
                "agent": str(node),
                "level": "info",
                "message": f"Specialist Agent [{label}] finalized section deliverables ✓",
                "ts": datetime.now(timezone.utc).isoformat(),
            }))
    return lines


async def _run_graph(compiled: Any, inputs: Any, config: dict[str, Any]):
    """Stream graph events, emitting heartbeats while a node is busy.

    If the client disconnects, the generator is closed and the graph run is
    cancelled with it, so a retried run never races an abandoned one.
    """
    queue: asyncio.Queue[tuple[str, Any]] = asyncio.Queue()

    # Emit initial pipeline kickoff log immediately
    yield _line({
        "type": "log",
        "agent": "ceo",
        "level": "info",
        "message": "CEO Supervision: Multi-agent orchestration pipeline initiated",
        "ts": datetime.now(timezone.utc).isoformat(),
    })

    async def pump() -> None:
        try:
            async for event in compiled.astream(inputs, config, stream_mode=["updates", "debug"]):
                await queue.put(("event", event))
            await queue.put(("done", None))
        except Exception as exc:
            await queue.put(("error", exc))

    task = asyncio.create_task(pump())
    try:
        while True:
            try:
                kind, item = await asyncio.wait_for(queue.get(), timeout=_HEARTBEAT_SECONDS)
            except asyncio.TimeoutError:
                yield _line({"type": "heartbeat"})
                continue
            if kind == "done":
                return
            if kind == "error":
                raise item
            for line in _translate(item):
                yield line
    finally:
        task.cancel()


async def _outcome(compiled: Any, config: dict[str, Any]) -> str:
    """The terminal event for the graph's current checkpoint."""
    state = await compiled.aget_state(config)
    if state.next:
        next_node = state.next[0]
        pending = _PHASE_FOR_GATE.get(next_node) or state.values.get("pending_approval")
        if pending and state.values.get("pending_approval") != pending:
            try:
                await compiled.aupdate_state(config, {"pending_approval": pending})
            except Exception:
                pass
        return _line({"type": "paused_for_approval", "pending_approval": pending})
    return _line({"type": "run_complete"})


@router.post("/workflow/stream")
async def stream_workflow(req: WorkflowRunRequest) -> StreamingResponse:
    """Stream LangGraph progress events in real-time as newline-delimited JSON."""
    async def event_generator():
        try:
            compiled = await get_compiled_graph()
            config = {"configurable": {"thread_id": req.project_id}}
            inputs: Any = {
                "project_id": req.project_id,
                "idea": req.idea,
                "title": req.title or req.idea[:50],
                **req.state_updates
            }

            if req.resume:
                state = await compiled.aget_state(config)
                if state.values:
                    if not state.next or state.next[0] in _PHASE_FOR_GATE:
                        # Finished, or parked at an approval gate: nothing to re-run.
                        yield await _outcome(compiled, config)
                        return
                    # Continue from the node that failed; finished nodes are kept.
                    logger.info("Resuming %s at %s", req.project_id, state.next[0])
                    inputs = None

            async for line in _run_graph(compiled, inputs, config):
                yield line
            yield await _outcome(compiled, config)

        except Exception as exc:
            logger.exception("Workflow failed for %s", req.project_id)
            yield _error_event(exc)

    return StreamingResponse(event_generator(), media_type="application/x-ndjson")


@router.post("/workflow/approve")
async def approve_workflow(req: ApprovalRequest) -> StreamingResponse:
    """Resume the LangGraph workflow after human approval/feedback."""
    async def event_generator():
        try:
            compiled = await get_compiled_graph()
            config = {"configurable": {"thread_id": req.project_id}}
            state = await compiled.aget_state(config)
            if not state.values:
                yield _line({"type": "error", "retryable": False,
                             "message": "No saved workflow state for this project; use Retry to rerun it"})
                return

            current_gate = state.next[0] if state.next else None
            gate = _GATE_FOR_PHASE.get(req.phase)
            # If the requested phase does not match current gate, but thread is parked at a gate, adapt
            if current_gate in _PHASE_FOR_GATE and gate != current_gate:
                logger.warning(
                    "Approval for '%s' (gate '%s') adapted to actual waiting gate '%s' (phase '%s')",
                    req.phase, gate, current_gate, _PHASE_FOR_GATE[current_gate],
                )
                gate = current_gate
                req_phase = _PHASE_FOR_GATE[current_gate]
            else:
                req_phase = req.phase

            if gate is None:
                yield _line({"type": "error", "retryable": False,
                             "message": f"Unknown approval phase '{req.phase}'"})
                return

            applied = state.values.get("approvals", {}).get(req_phase, {})
            already_applied = bool(req.decision_id) and applied.get("decision_id") == req.decision_id

            if state.next and state.next[0] == gate and not already_applied:
                # Update state with approval decision
                approvals = dict(state.values.get("approvals", {}))
                approvals[req_phase] = {
                    "approved": req.approved,
                    "feedback": req.feedback,
                    "decision_id": req.decision_id,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                }
                update: dict[str, Any] = {"approvals": approvals, "pending_approval": None}
                if not req.approved and req.feedback:
                    manager_feedback = list(state.values.get("manager_feedback", []))
                    manager_feedback.append({
                        "phase": req_phase,
                        "feedback": req.feedback,
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                    })
                    update["manager_feedback"] = manager_feedback
                # as_node makes the update count as the gate's output; otherwise
                # LangGraph re-runs the gate and asks for approval again.
                await compiled.aupdate_state(config, update, as_node=gate)
            elif not state.next or state.next[0] in _PHASE_FOR_GATE:
                # Decision was applied by an earlier attempt and the graph has
                # since finished or reached another gate: just report where it is.
                yield await _outcome(compiled, config)
                return
            # Otherwise an earlier attempt applied the decision but failed mid-node:
            # fall through and continue from that node.

            async for line in _run_graph(compiled, None, config):
                yield line
            yield await _outcome(compiled, config)

        except Exception as exc:
            logger.exception("Approval resume failed for %s", req.project_id)
            yield _error_event(exc)

    return StreamingResponse(event_generator(), media_type="application/x-ndjson")


@router.post("/assistant/chat")
async def assistant(req: AssistantChatRequest) -> dict[str, Any]:
    """Grounded conversational answer about a project's plan (no schema)."""
    if not req.message.strip():
        raise HTTPException(status_code=422, detail="message is required")
    try:
        result = await assistant_chat(
            req.project,
            req.message,
            [{"role": m.role, "content": m.content} for m in req.history],
        )
    except Exception as exc:
        logger.exception("Assistant chat failed")
        raise HTTPException(status_code=502, detail=f"assistant failed: {exc}")
    return result.model_dump()


class GithubAnalyzeRequest(BaseModel):
    items: list[dict[str, Any]] = Field(default_factory=list)
    commits: list[dict[str, Any]] = Field(default_factory=list, max_length=40)


class GithubSummaryRequest(BaseModel):
    context: str = Field(..., max_length=20000)


class GithubChatRequest(BaseModel):
    context: str = Field(..., max_length=20000)
    message: str
    history: list[ChatMessage] = Field(default_factory=list)


@router.post("/github/analyze-commits")
async def github_analyze_commits(req: GithubAnalyzeRequest) -> dict[str, Any]:
    """Classify commits and map them onto the project's plan items."""
    try:
        result = await github_insights.analyze_commits(req.items, req.commits)
    except Exception as exc:
        logger.exception("Commit analysis failed")
        raise HTTPException(status_code=502, detail=f"commit analysis failed: {exc}")
    return result.model_dump()


@router.post("/github/summarize")
async def github_summarize(req: GithubSummaryRequest) -> dict[str, Any]:
    try:
        result = await github_insights.summarize_repo(req.context)
    except Exception as exc:
        logger.exception("Repo summary failed")
        raise HTTPException(status_code=502, detail=f"repo summary failed: {exc}")
    return result.model_dump()


@router.post("/github/chat")
async def github_chat(req: GithubChatRequest) -> dict[str, Any]:
    if not req.message.strip():
        raise HTTPException(status_code=422, detail="message is required")
    try:
        reply = await github_insights.repo_chat(
            req.context, req.message, [{"role": m.role, "content": m.content} for m in req.history]
        )
    except Exception as exc:
        logger.exception("Repo chat failed")
        raise HTTPException(status_code=502, detail=f"repo chat failed: {exc}")
    return {"reply": reply}
