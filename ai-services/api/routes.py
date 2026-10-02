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


class ApprovalRequest(BaseModel):
    project_id: str
    phase: str
    approved: bool
    feedback: str = ""


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


@router.post("/workflow/stream")
async def stream_workflow(req: WorkflowRunRequest) -> StreamingResponse:
    """Stream LangGraph progress events in real-time as newline-delimited JSON."""
    async def event_generator():
        try:
            compiled = await get_compiled_graph()
            config = {"configurable": {"thread_id": req.project_id}}
            
            # Prepare initial state
            initial_state = {
                "project_id": req.project_id,
                "idea": req.idea,
                "title": req.title or req.idea[:50],
                **req.state_updates
            }

            # Start or resume the graph
            async for event in compiled.astream(initial_state, config, stream_mode=["updates", "debug"]):
                if len(event) == 2 and isinstance(event[0], str):
                    mode, payload = event
                    
                    if mode == "debug" and payload.get("type") == "task:runs":
                        node_name = payload.get("payload", {}).get("name")
                        if node_name and not node_name.startswith("__"):
                            yield json.dumps({
                                "type": "log",
                                "agent": node_name,
                                "level": "info",
                                "message": f"Starting {node_name} processing...",
                                "ts": datetime.now(timezone.utc).isoformat()
                            }) + "\n"
                            
                    elif mode == "updates":
                        # payload is a dict mapping node_name -> state_update
                        for node, state_update in payload.items():
                            msg = {
                                "type": "node_update",
                                "node": node,
                                "state": state_update
                            }
                            yield json.dumps(msg, default=str) + "\n"

            # Check if graph ended or paused for approval
            final_state = await compiled.aget_state(config)
            if final_state.next:
                # Graph paused at an interrupt
                next_node = final_state.next[0]
                pending = final_state.values.get("pending_approval")
                if not pending:
                    if next_node == "await_req_approval": pending = "requirements"
                    elif next_node == "await_arch_approval": pending = "architecture"
                    elif next_node == "await_sprint_approval": pending = "sprint_planning"
                    elif next_node == "await_sprint_review": pending = "sprint_review"
                
                yield json.dumps({
                    "type": "paused_for_approval",
                    "pending_approval": pending
                }) + "\n"
            else:
                yield json.dumps({"type": "run_complete"}) + "\n"

        except Exception as exc:
            logger.exception("Workflow failed for %s", req.project_id)
            yield json.dumps({
                "type": "error",
                "message": str(exc),
            }) + "\n"

    return StreamingResponse(event_generator(), media_type="application/x-ndjson")


@router.post("/workflow/approve")
async def approve_workflow(req: ApprovalRequest) -> StreamingResponse:
    """Resume the LangGraph workflow after human approval/feedback."""
    async def event_generator():
        try:
            compiled = await get_compiled_graph()
            config = {"configurable": {"thread_id": req.project_id}}
            state = await compiled.aget_state(config)
            
            if not state.next:
                yield json.dumps({"type": "error", "message": "Graph is not paused."}) + "\n"
                return

            # Update state with approval decision
            approvals = state.values.get("approvals", {})
            approvals[req.phase] = {
                "approved": req.approved,
                "feedback": req.feedback,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
            
            update: dict[str, Any] = {
                "approvals": approvals,
                "pending_approval": None,
            }
            
            if not req.approved and req.feedback:
                manager_feedback = state.values.get("manager_feedback", [])
                manager_feedback.append({
                    "phase": req.phase, 
                    "feedback": req.feedback,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                })
                update["manager_feedback"] = manager_feedback

            # We MUST use `as_node=state.next[0]` to pretend the update came from the node that paused.
            # Otherwise, LangGraph simply re-runs the paused node and asks for approval again!
            await compiled.aupdate_state(config, update, as_node=state.next[0])
            
            # Resume execution by passing None as input
            async for event in compiled.astream(None, config, stream_mode=["updates", "debug"]):
                if len(event) == 2 and isinstance(event[0], str):
                    mode, payload = event
                    
                    if mode == "debug" and payload.get("type") == "task:runs":
                        node_name = payload.get("payload", {}).get("name")
                        if node_name and not node_name.startswith("__"):
                            yield json.dumps({
                                "type": "log",
                                "agent": node_name,
                                "level": "info",
                                "message": f"Starting {node_name} processing...",
                                "ts": datetime.now(timezone.utc).isoformat()
                            }) + "\n"
                            
                    elif mode == "updates":
                        for node, state_update in payload.items():
                            msg = {
                                "type": "node_update",
                                "node": node,
                                "state": state_update
                            }
                            yield json.dumps(msg, default=str) + "\n"
                    
            # Check if graph ended or paused for approval
            final_state = await compiled.aget_state(config)
            if final_state.next:
                # Graph paused at an interrupt
                next_node = final_state.next[0]
                pending = final_state.values.get("pending_approval")
                if not pending:
                    if next_node == "await_req_approval": pending = "requirements"
                    elif next_node == "await_arch_approval": pending = "architecture"
                    elif next_node == "await_sprint_approval": pending = "sprint_planning"
                    elif next_node == "await_sprint_review": pending = "sprint_review"
                
                yield json.dumps({
                    "type": "paused_for_approval",
                    "pending_approval": pending
                }) + "\n"
            else:
                yield json.dumps({"type": "run_complete"}) + "\n"

        except Exception as exc:
            logger.exception("Approval resume failed for %s", req.project_id)
            yield json.dumps({
                "type": "error",
                "message": str(exc),
            }) + "\n"

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
