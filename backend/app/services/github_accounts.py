"""Connected GitHub accounts (OAuth App) and per-link token resolution.

Flow: the frontend asks for an authorize URL (``authorize_url``), the user
approves on github.com, GitHub redirects to the frontend callback page with
``code`` and ``state``, and the page posts both back (``complete``). ``state``
is an encrypted, 10-minute token bound to the signed-in user, so a callback
can neither be forged nor completed by a different account.

Every GitHub call for a linked repo gets its token from ``token_for_link``:
the linking manager's connected account, else a token pasted on the link,
else none (the client then falls back to the server-wide GITHUB_TOKEN).
"""
from __future__ import annotations

import json
import secrets
import urllib.parse
from typing import Any

import httpx
from cryptography.fernet import InvalidToken

from app.core.config import settings
from app.core.logging import get_logger
from app.db.postgres import execute, fetchrow
from app.services.github_client import (
    GitHubClient,
    GitHubError,
    _fernet,
    decrypt_token,
    encrypt_token,
)

logger = get_logger("services.github_accounts")

_STATE_TTL_SECONDS = 600
RECONNECT_MESSAGE = "Your GitHub connection was revoked or has expired. Reconnect GitHub to keep syncing."
DISCONNECTED_MESSAGE = (
    "The GitHub account this repository was linked with is no longer connected. "
    "Reconnect GitHub, or relink the repository."
)


def configured() -> bool:
    return bool(settings.github_oauth_client_id and settings.github_oauth_client_secret)


def _safe_return_path(value: str | None) -> str:
    # Only same-site relative paths: never let the callback redirect off-site.
    if value and value.startswith("/") and not value.startswith("//") and "\\" not in value:
        return value[:500]
    return "/my-projects"


def authorize_url(user_id: str, return_to: str | None) -> str:
    if not configured():
        missing = [name for name, value in (
            ("GITHUB_OAUTH_CLIENT_ID", settings.github_oauth_client_id),
            ("GITHUB_OAUTH_CLIENT_SECRET", settings.github_oauth_client_secret),
        ) if not value]
        logger.warning("GitHub connect requested but %s not set in .env", " and ".join(missing))
        raise GitHubError("Connecting GitHub isn't available right now. Please try again later.", 503)
    state = _fernet().encrypt(json.dumps({
        "uid": user_id, "rt": _safe_return_path(return_to), "n": secrets.token_hex(8),
    }).encode()).decode()
    query = urllib.parse.urlencode({
        "client_id": settings.github_oauth_client_id,
        "redirect_uri": settings.github_oauth_redirect_uri,
        "scope": settings.github_oauth_scopes,
        "state": state,
        "allow_signup": "true",
    })
    return f"https://github.com/login/oauth/authorize?{query}"


def _read_state(state: str, user_id: str) -> str:
    try:
        data = json.loads(_fernet().decrypt(state.encode(), ttl=_STATE_TTL_SECONDS))
    except (InvalidToken, ValueError):
        raise GitHubError("This GitHub sign-in link has expired. Start the connection again.", 400)
    if data.get("uid") != user_id:
        raise GitHubError("This GitHub sign-in was started by a different user.", 403)
    return _safe_return_path(data.get("rt"))


async def complete(user_id: str, code: str, state: str) -> tuple[dict[str, Any], str]:
    """Exchange the OAuth code, store the account, and return it with the return path."""
    return_to = _read_state(state, user_id)
    async with httpx.AsyncClient(timeout=20.0) as client:
        resp = await client.post(
            "https://github.com/login/oauth/access_token",
            headers={"Accept": "application/json"},
            data={
                "client_id": settings.github_oauth_client_id,
                "client_secret": settings.github_oauth_client_secret,
                "code": code,
                "redirect_uri": settings.github_oauth_redirect_uri,
            },
        )
    body = resp.json() if resp.headers.get("content-type", "").startswith("application/json") else {}
    token = body.get("access_token")
    if not token:
        reason = body.get("error_description") or body.get("error") or f"HTTP {resp.status_code}"
        raise GitHubError(f"GitHub did not grant access: {reason}", 400)

    profile = await GitHubClient(token).user()
    await execute(
        """INSERT INTO github_accounts (user_id, github_user_id, login, name, avatar_url,
               access_token, scopes)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT (user_id) DO UPDATE SET github_user_id=EXCLUDED.github_user_id,
             login=EXCLUDED.login, name=EXCLUDED.name, avatar_url=EXCLUDED.avatar_url,
             access_token=EXCLUDED.access_token, scopes=EXCLUDED.scopes,
             invalid_at=NULL, updated_at=NOW()""",
        user_id, int(profile["id"]), profile["login"], profile.get("name"),
        profile.get("avatar_url"), encrypt_token(token),
        " ".join(profile.get("_scopes") or body.get("scope", "").split(",")),
    )
    logger.info("User %s connected GitHub account %s", user_id, profile["login"])
    return await account(user_id) or {}, return_to


async def account(user_id: str) -> dict[str, Any] | None:
    row = await fetchrow(
        """SELECT login, name, avatar_url, scopes, invalid_at, created_at
           FROM github_accounts WHERE user_id=$1""",
        user_id,
    )
    if not row:
        return None
    scopes = set((row["scopes"] or "").split())
    return {
        "login": row["login"],
        "name": row["name"],
        "avatar_url": row["avatar_url"],
        "scopes": sorted(scopes),
        "can_read_private": "repo" in scopes,
        "can_manage_webhooks": bool({"admin:repo_hook", "write:repo_hook"} & scopes),
        "needs_reconnect": row["invalid_at"] is not None,
        "connected_at": row["created_at"].isoformat() if row["created_at"] else None,
    }


async def _token(user_id: str) -> str | None:
    row = await fetchrow(
        "SELECT access_token, invalid_at FROM github_accounts WHERE user_id=$1", user_id
    )
    if not row:
        return None
    if row["invalid_at"] is not None:
        raise GitHubError(RECONNECT_MESSAGE, 401)
    return decrypt_token(row["access_token"])


async def user_client(user_id: str) -> GitHubClient:
    token = await _token(user_id)
    if not token:
        raise GitHubError("Connect your GitHub account first.", 409)
    return GitHubClient(token)


async def token_for_link(link: dict[str, Any]) -> str | None:
    if link.get("account_user_id"):
        token = await _token(link["account_user_id"])
        if not token:
            raise GitHubError(DISCONNECTED_MESSAGE, 401)
        return token
    return decrypt_token(link.get("access_token"))


async def mark_invalid(user_id: str) -> None:
    """GitHub rejected the account's token (revoked in GitHub settings)."""
    await execute(
        "UPDATE github_accounts SET invalid_at=NOW(), updated_at=NOW() WHERE user_id=$1 AND invalid_at IS NULL",
        user_id,
    )


async def note_failure(user_id: str | None, exc: BaseException) -> None:
    if user_id and isinstance(exc, GitHubError) and exc.status == 401 \
            and str(exc) not in (RECONNECT_MESSAGE, DISCONNECTED_MESSAGE):
        logger.warning("GitHub rejected the token of user %s; marking for reconnect", user_id)
        await mark_invalid(user_id)


async def disconnect(user_id: str) -> bool:
    """Forget the account and revoke DevFlow's grant on GitHub (best effort)."""
    row = await fetchrow("SELECT access_token FROM github_accounts WHERE user_id=$1", user_id)
    if not row:
        return False
    token = decrypt_token(row["access_token"])
    if token and configured():
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                await client.request(
                    "DELETE",
                    f"https://api.github.com/applications/{settings.github_oauth_client_id}/grant",
                    auth=(settings.github_oauth_client_id, settings.github_oauth_client_secret),
                    headers={"Accept": "application/vnd.github+json"},
                    json={"access_token": token},
                )
        except httpx.HTTPError as exc:
            logger.info("Could not revoke GitHub grant for %s: %s", user_id, exc)
    await execute("DELETE FROM github_accounts WHERE user_id=$1", user_id)
    logger.info("User %s disconnected GitHub", user_id)
    return True


async def list_repos(user_id: str) -> list[dict[str, Any]]:
    gh = await user_client(user_id)
    try:
        repos = await gh.user_repos()
    except GitHubError as exc:
        await note_failure(user_id, exc)
        raise
    return [
        {
            "full_name": r["full_name"],
            "owner": r["owner"]["login"],
            "name": r["name"],
            "private": bool(r.get("private")),
            "description": r.get("description"),
            "default_branch": r.get("default_branch"),
            "pushed_at": r.get("pushed_at"),
            "language": r.get("language"),
            "stars": r.get("stargazers_count", 0),
            "html_url": r.get("html_url"),
            "updated_at": r.get("updated_at"),
            "can_admin": bool((r.get("permissions") or {}).get("admin")),
        }
        for r in repos
    ]


def manage_access_url() -> str | None:
    """Where a user grants this OAuth App access to an organization's repos."""
    if not settings.github_oauth_client_id:
        return None
    return f"https://github.com/settings/connections/applications/{settings.github_oauth_client_id}"
