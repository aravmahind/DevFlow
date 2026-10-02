"""Project REST API."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.core.auth import CurrentUser, current_user
from app.core.logging import get_logger
from app.models.project import (
    AnalyzeRequest,
    AnalyzeResponse,
    ChatRequest,
    MigrateRequest,
    ProjectDocumentCreate,
    migration_idea,
)
from app.orchestrator.manager import enqueue_analysis
from app.services import projects as project_service
from app.services.ai_client import ai_services
from app.services import workspaces as workspace_service

logger = get_logger("api.projects")
router = APIRouter(prefix="/projects", tags=["projects"])


@router.post("/analyze", response_model=AnalyzeResponse, status_code=202)
async def analyze(req: AnalyzeRequest, user: CurrentUser = Depends(current_user)) -> AnalyzeResponse:
    """Kick off the autonomous AI organization on a raw product idea."""
    manager_inputs=req.model_dump(exclude={"idea","title","source_documents"})
    doc = await project_service.create_project(req.idea, req.title, user.id, manager_inputs)
    for source in req.source_documents:
        await project_service.create_source_document(
            doc["id"], user.id, title=source.title, content=source.content,
            source_type=source.source_type, mime_type=source.mime_type,
            metadata=source.metadata,
        )
    await enqueue_analysis(doc["id"])
    return AnalyzeResponse(project_id=doc["id"], status="queued")


@router.post("/migrate", response_model=AnalyzeResponse, status_code=202)
async def migrate(req: MigrateRequest, user: CurrentUser = Depends(current_user)) -> AnalyzeResponse:
    """Reconstruct a full plan from an existing project's spec/export/repo."""
    idea = migration_idea(req.source, req.content)
    title = req.title or f"Imported · {req.content.strip().splitlines()[0][:48]}"
    doc = await project_service.create_project(idea, title, user.id)
    await project_service.create_source_document(
        doc["id"], user.id, title=title, content=req.content,
        source_type=req.source if req.source in {"spec","repo","tickets","file"} else "text",
        mime_type="text/plain", metadata={"migration_source": req.source, "authoritative": True},
    )
    await enqueue_analysis(doc["id"])
    return AnalyzeResponse(project_id=doc["id"], status="queued")


class RetryProjectRequest(BaseModel):
    target_agents: list[str] = Field(default_factory=list, max_length=8)


@router.post("/{project_id}/retry", response_model=AnalyzeResponse, status_code=202)
async def retry_project(
    project_id: str,
    req: RetryProjectRequest | None = None,
    user: CurrentUser = Depends(current_user),
) -> AnalyzeResponse:
    """Retry all failed or incomplete sections for a project without losing already completed deliverables."""
    doc = await project_service.get_project(project_id, user.id)
    if not doc:
        raise HTTPException(status_code=404, detail="project not found")
    await project_service.set_status(project_id, "queued", progress=doc.get("progress", 0), error=None)
    targets = list(req.target_agents) if req else []
    valid_agents = {"ceo", "product_manager", "architect", "sprint_planner", "risk", "team_allocation", "timeline", "integration"}
    unknown = sorted(set(targets) - valid_agents)
    if unknown:
        raise HTTPException(status_code=422, detail=f"unknown target agents: {', '.join(unknown)}")
    await enqueue_analysis(project_id, targets or None)
    logger.info("Enqueued retry for project %s", project_id)
    return AnalyzeResponse(project_id=project_id, status="queued")


class ApproveRequest(BaseModel):
    phase: str = Field(..., description="The workflow phase being approved")
    approved: bool = Field(..., description="Whether the manager approved it")
    feedback: str = Field(default="", description="Manager's feedback if rejected")


@router.post("/{project_id}/approve", response_model=AnalyzeResponse, status_code=202)
async def approve_project(
    project_id: str, req: ApproveRequest, user: CurrentUser = Depends(current_user)
) -> AnalyzeResponse:
    """Approve or reject a LangGraph workflow phase and resume execution."""
    doc = await project_service.get_project(project_id, user.id)
    if not doc:
        raise HTTPException(status_code=404, detail="project not found")
        
    role = await project_service.project_role(project_id, user.id)
    if role not in {"manager"}:
        raise HTTPException(status_code=403, detail="approval permission required")
        
    await project_service.set_status(project_id, "running", progress=doc.get("progress", 0))
    from app.orchestrator.manager import enqueue_approval
    await enqueue_approval(project_id, req.phase, req.approved, req.feedback)
    
    return AnalyzeResponse(project_id=project_id, status="running")


@router.post("/{project_id}/chat")
async def chat(
    project_id: str, req: ChatRequest, user: CurrentUser = Depends(current_user)
) -> dict[str, Any]:
    """Answer a question grounded in the project's plan."""
    doc = await project_service.get_project(project_id, user.id)
    if not doc:
        raise HTTPException(status_code=404, detail="project not found")
    try:
        result = await ai_services.chat(
            doc, req.message, [{"role": m.role, "content": m.content} for m in req.history]
        )
    except Exception as exc:
        logger.warning("Assistant chat failed for %s: %s", project_id, exc)
        raise HTTPException(status_code=502, detail="assistant unavailable")
    reply = result.get("reply", "")
    edits = result.get("edits", [])
    updated_doc = doc
    if edits and req.apply_changes:
        from app.services import rbac
        if not await rbac.check_project_permission(project_id, user.id, "edit_content"):
            raise HTTPException(status_code=403, detail="edit permission required")
        for edit in edits:
            updated_doc = await project_service.edit_content(
                project_id, user.id, str(edit.get("path", "")), edit.get("value"),
                int(updated_doc.get("revision", 0)), operation="flowmate",
            )
    await project_service.add_ai_response(
        project_id, user.id, "chat", role="user", content=req.message
    )
    await project_service.add_ai_response(
        project_id, user.id, "chat", role="assistant", content=reply
    )
    return {"reply": reply, "edits": edits, "project": updated_doc if edits else None}


@router.get("")
async def list_projects(user: CurrentUser = Depends(current_user)) -> dict[str, Any]:
    from app.services import rbac
    return {"projects": await rbac.get_user_projects(user.id)}


@router.get("/{project_id}")
async def get_project(project_id: str, user: CurrentUser = Depends(current_user)) -> dict[str, Any]:
    doc = await project_service.get_project(project_id, user.id)
    if not doc:
        raise HTTPException(status_code=404, detail="project not found")
    return doc


@router.post("/{project_id}/documents", status_code=201)
async def add_project_document(
    project_id: str,
    req: ProjectDocumentCreate,
    user: CurrentUser = Depends(current_user),
) -> dict[str, Any]:
    try:
        document = await project_service.create_source_document(
            project_id,
            user.id,
            title=req.title,
            content=req.content,
            source_type=req.source_type,
            mime_type=req.mime_type,
            metadata=req.metadata,
        )
    except LookupError:
        raise HTTPException(status_code=404, detail="project not found")
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc))
    return {"document": document}


@router.get("/{project_id}/documents")
async def list_project_documents(
    project_id: str, user: CurrentUser = Depends(current_user)
) -> dict[str, Any]:
    try:
        documents = await project_service.list_source_documents(project_id, user.id)
    except LookupError:
        raise HTTPException(status_code=404, detail="project not found")
    return {"documents": documents}


@router.get("/{project_id}/ai-provenance")
async def get_ai_provenance(
    project_id: str, user: CurrentUser = Depends(current_user)
) -> dict[str, Any]:
    try:
        return await project_service.ai_provenance(project_id, user.id)
    except LookupError:
        raise HTTPException(status_code=404, detail="project not found")


class UpdateBacklogRequest(BaseModel):
    backlog: dict[str, Any]


@router.put("/{project_id}/backlog")
async def update_backlog(project_id: str, req: UpdateBacklogRequest, user: CurrentUser = Depends(current_user)) -> dict[str, Any]:
    from app.services import rbac
    if not await rbac.check_project_permission(project_id, user.id, "edit_content"): raise HTTPException(status_code=403, detail="edit permission required")
    doc = await project_service.get_project(project_id, user.id)
    updated = await project_service.edit_content(project_id,user.id,"/backlog",req.backlog,doc.get("revision",0) if doc else 0)
    return {"status":"ok","project":updated}


class ContentEditRequest(BaseModel):
    path: str = Field(..., min_length=2, max_length=300)
    value: Any
    expected_revision: int | None = Field(default=None, ge=0)

class TaskUpdateRequest(BaseModel):
    assignee_id: str | None = None
    status: str | None = Field(default=None, pattern="^(To Do|In Progress|In Review|Done)$")
    expected_revision: int | None = Field(default=None, ge=0)


@router.patch("/{project_id}/content")
async def edit_project_content(project_id: str, req: ContentEditRequest, user: CurrentUser=Depends(current_user)) -> dict[str,Any]:
    from app.services import rbac
    if not await rbac.check_project_permission(project_id, user.id, "edit_content"): raise HTTPException(403,"edit permission required")
    try: doc=await project_service.edit_content(project_id,user.id,req.path,req.value,req.expected_revision)
    except RuntimeError: raise HTTPException(409,"project changed; reload before saving")
    except (ValueError,KeyError,IndexError,TypeError) as exc: raise HTTPException(422,str(exc))
    return {"project":doc}


@router.get("/{project_id}/history")
async def project_history(project_id: str,user: CurrentUser=Depends(current_user)) -> dict[str,Any]:
    if not await project_service.project_role(project_id,user.id): raise HTTPException(404,"project not found")
    return {"history":await project_service.revision_history(project_id)}

@router.get("/{project_id}/members")
async def project_members(project_id:str,user:CurrentUser=Depends(current_user))->dict[str,Any]:
    from app.services import rbac
    role = await rbac.get_project_role(project_id, user.id)
    if not role: raise HTTPException(404,"project not found")
    return {"members": await rbac.list_project_members(project_id), "role": role}

@router.patch("/{project_id}/tasks/{task_index}")
async def update_task(project_id:str,task_index:int,req:TaskUpdateRequest,user:CurrentUser=Depends(current_user))->dict[str,Any]:
    doc=await project_service.get_project(project_id,user.id)
    from app.services import rbac
    role = await rbac.get_project_role(project_id, user.id)
    if not doc or not role: raise HTTPException(404,"project not found")
    tasks=((doc.get("backlog") or {}).get("tasks") or [])
    if task_index<0 or task_index>=len(tasks): raise HTTPException(404,"task not found")
    task=tasks[task_index]
    if "assignee_id" in req.model_fields_set:
        if not rbac.check_permission(role, "assign_tasks"): raise HTTPException(403,"task assignment permission required")
        members=await rbac.list_project_members(project_id)
        if req.assignee_id and req.assignee_id not in {m["user_id"] for m in members}: raise HTTPException(422,"assignee is not a project member")
        task["assignee_id"]=req.assignee_id or None
    if req.status is not None:
        if not rbac.check_permission(role, "update_own_task"): raise HTTPException(403,"only the assignee may update this task")
        if not rbac.check_permission(role, "assign_tasks") and task.get("assignee_id")!=user.id: raise HTTPException(403,"only the assignee may update this task")
        task["status"]=req.status
    updated=await project_service.edit_content(project_id,user.id,f"/backlog/tasks/{task_index}",task,req.expected_revision,operation="task_update")
    return {"project":updated,"task":task}


@router.post("/{project_id}/undo")
async def undo_project(project_id: str,user: CurrentUser=Depends(current_user)) -> dict[str,Any]:
    from app.services import rbac
    if not await rbac.check_project_permission(project_id, user.id, "edit_content"): raise HTTPException(403,"edit permission required")
    doc=await project_service.undo(project_id,user.id)
    if not doc: raise HTTPException(409,"nothing to undo")
    return {"project":doc}


agents_router = APIRouter(tags=["agents"])


@agents_router.get("/agents")
async def list_agents() -> dict[str, Any]:
    """Proxy the AI org roster from ai-services (frontend never calls it directly)."""
    try:
        return await ai_services.list_agents()
    except Exception as exc:
        logger.warning("Could not fetch agents: %s", exc)
        raise HTTPException(status_code=502, detail="ai-services unavailable")
