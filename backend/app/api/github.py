"""GitHub linking API: link a repo to a project, track implementation, chat with the repo."""
from __future__ import annotations

import hashlib
import hmac
import re
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field

from app.core.auth import CurrentUser, current_user
from app.core.config import settings
from app.core.logging import get_logger
from app.models.project import ChatMessage
from app.db.postgres import fetch
from app.services import github_accounts
from app.services import github_tracker as tracker
from app.services import rbac
from app.services.ai_client import ai_services
from app.services.github_client import GitHubError

logger = get_logger("api.github")
router = APIRouter(tags=["github"])


class LinkRequest(BaseModel):
    repo_url: str = Field(..., min_length=3, max_length=300)
    access_token: str | None = Field(default=None, max_length=300)
    use_account: bool = Field(
        default=False, description="Read the repo through the caller's connected GitHub account"
    )


class OAuthStartRequest(BaseModel):
    return_to: str | None = Field(default=None, max_length=500)


class OAuthCallbackRequest(BaseModel):
    code: str = Field(..., min_length=1, max_length=200)
    state: str = Field(..., min_length=1, max_length=2000)


class RepoChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=2000)
    history: list[ChatMessage] = Field(default_factory=list)


async def _role(project_id: str, user: CurrentUser) -> str:
    role = await rbac.get_project_role(project_id, user.id)
    if not role:
        raise HTTPException(404, "project not found")
    return role


def _require(role: str, action: str) -> None:
    if not rbac.check_permission(role, action):
        raise HTTPException(403, "Only project managers can change the GitHub link"
                            if action == "manage_integrations" else "permission denied")


def _http_error(exc: GitHubError) -> HTTPException:
    return HTTPException(exc.status if exc.status in (400, 401, 403, 404, 409, 422, 429, 503) else 502, str(exc))


def _webhook_url(request: Request, project_id: str) -> str:
    base = settings.public_api_url or str(request.base_url).rstrip("/")
    return f"{base}/github/webhook/{project_id}"


def _is_public(url: str) -> bool:
    return not any(host in url for host in ("localhost", "127.0.0.1", "0.0.0.0", "host.docker.internal"))


@router.get("/projects/{project_id}/github")
async def get_github(project_id: str, request: Request, user: CurrentUser = Depends(current_user)) -> dict[str, Any]:
    role = await _role(project_id, user)
    data = await tracker.overview(
        project_id, reveal_secret=rbac.check_permission(role, "manage_integrations"),
        webhook_url=_webhook_url(request, project_id),
    )
    return {**data, "role": role}


@router.post("/projects/{project_id}/github", status_code=201)
async def link_github(
    project_id: str, req: LinkRequest, request: Request, user: CurrentUser = Depends(current_user)
) -> dict[str, Any]:
    _require(await _role(project_id, user), "manage_integrations")
    webhook_url = _webhook_url(request, project_id)
    try:
        await tracker.link_repo(
            project_id, user.id, req.repo_url, (req.access_token or "").strip() or None,
            webhook_url if _is_public(webhook_url) else None, use_account=req.use_account,
        )
    except GitHubError as exc:
        raise _http_error(exc)
    return await get_github(project_id, request, user)


@router.delete("/projects/{project_id}/github")
async def unlink_github(project_id: str, user: CurrentUser = Depends(current_user)) -> dict[str, str]:
    _require(await _role(project_id, user), "manage_integrations")
    if not await tracker.unlink(project_id):
        raise HTTPException(404, "no repository linked")
    return {"status": "ok"}


@router.post("/projects/{project_id}/github/sync", status_code=202)
async def sync_github(
    project_id: str, reanalyze: bool = False, user: CurrentUser = Depends(current_user)
) -> dict[str, str]:
    role = await _role(project_id, user)
    _require(role, "manage_integrations" if reanalyze else "sync_integrations")
    if not await tracker.get_link(project_id):
        raise HTTPException(404, "no repository linked")
    if reanalyze:
        await tracker.reanalyze(project_id)
    else:
        tracker.request_sync(project_id, f"manual by {user.id}")
    return {"status": "queued"}


@router.get("/projects/{project_id}/github/commits")
async def github_commits(
    project_id: str,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    author: str | None = Query(None, max_length=120),
    user: CurrentUser = Depends(current_user),
) -> dict[str, Any]:
    await _role(project_id, user)
    return {"commits": await tracker.list_commits(project_id, limit, offset, author)}


@router.post("/projects/{project_id}/github/chat")
async def github_chat(
    project_id: str, req: RepoChatRequest, user: CurrentUser = Depends(current_user)
) -> dict[str, Any]:
    await _role(project_id, user)
    if not await tracker.get_link(project_id):
        raise HTTPException(404, "no repository linked")
    context = await tracker.build_chat_context(project_id)
    try:
        result = await ai_services.github_chat(
            context, req.message, [{"role": m.role, "content": m.content} for m in req.history]
        )
    except Exception as exc:
        logger.warning("Repo chat failed for %s: %s", project_id, exc)
        body = getattr(getattr(exc, "response", None), "text", "") or ""
        if re.search(r"\b429\b|rate limit|tokens per (minute|day)", body, re.I):
            raise HTTPException(503, "The AI provider's rate limit was reached. Try again in a few minutes.")
        raise HTTPException(502, "repo assistant unavailable")
    return {"reply": result.get("reply", "")}


# ---- Connected GitHub account (per user) ----

@router.get("/github/account")
async def get_github_account(user: CurrentUser = Depends(current_user)) -> dict[str, Any]:
    acct = await github_accounts.account(user.id)
    return {
        "configured": github_accounts.configured(),
        "connected": acct is not None,
        "account": acct,
        "manage_access_url": github_accounts.manage_access_url(),
    }


@router.post("/github/oauth/start")
async def github_oauth_start(req: OAuthStartRequest, user: CurrentUser = Depends(current_user)) -> dict[str, str]:
    try:
        return {"authorize_url": github_accounts.authorize_url(user.id, req.return_to)}
    except GitHubError as exc:
        raise _http_error(exc)


@router.post("/github/oauth/callback")
async def github_oauth_callback(req: OAuthCallbackRequest, user: CurrentUser = Depends(current_user)) -> dict[str, Any]:
    try:
        acct, return_to = await github_accounts.complete(user.id, req.code, req.state)
    except GitHubError as exc:
        raise _http_error(exc)
    # Repos linked with this account that failed while it was disconnected recover now.
    for row in await fetch(
        "SELECT project_id FROM github_links WHERE account_user_id=$1 AND sync_status='failed'", user.id,
    ):
        tracker.request_sync(row["project_id"], "github account reconnected")
    return {"account": acct, "return_to": return_to}


@router.delete("/github/account")
async def disconnect_github_account(user: CurrentUser = Depends(current_user)) -> dict[str, Any]:
    affected = await fetch("SELECT project_id FROM github_links WHERE account_user_id=$1", user.id)
    if not await github_accounts.disconnect(user.id):
        raise HTTPException(404, "no GitHub account connected")
    return {"status": "ok", "affected_links": len(affected)}


@router.get("/github/repos")
async def list_github_repos(user: CurrentUser = Depends(current_user)) -> dict[str, Any]:
    try:
        return {"repos": await github_accounts.list_repos(user.id)}
    except GitHubError as exc:
        raise _http_error(exc)


@router.post("/github/webhook/{project_id}", status_code=202)
async def github_webhook(project_id: str, request: Request) -> dict[str, str]:
    """Push webhook. Authenticated by the per-link HMAC secret, not by a user session."""
    link = await tracker.get_link(project_id)
    if not link:
        raise HTTPException(404, "unknown project")
    body = await request.body()
    expected = "sha256=" + hmac.new(link["webhook_secret"].encode(), body, hashlib.sha256).hexdigest()
    received = request.headers.get("X-Hub-Signature-256", "").encode("utf-8", "replace")
    if not hmac.compare_digest(expected.encode(), received):
        raise HTTPException(401, "invalid signature")
    event = request.headers.get("X-GitHub-Event", "")
    if event == "ping":
        return {"status": "pong"}
    if event != "push":
        return {"status": "ignored"}
    payload = await request.json()
    if payload.get("ref") != f"refs/heads/{link['default_branch']}":
        return {"status": "ignored: not the tracked branch"}
    tracker.request_sync(project_id, f"webhook push {str(payload.get('after', ''))[:7]}")
    return {"status": "queued"}
