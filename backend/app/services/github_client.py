"""Thin GitHub REST client used by the repository tracker.

Only the endpoints the tracker needs are wrapped. Every call goes through
``_request`` so auth, API versioning, and rate-limit errors are handled in one
place. Tokens are encrypted at rest with a key derived from server secrets.
"""
from __future__ import annotations

import base64
import hashlib
import re
from typing import Any

import httpx
from cryptography.fernet import Fernet, InvalidToken

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger("services.github_client")

API = "https://api.github.com"
_REPO_RE = re.compile(
    r"^(?:https?://(?:www\.)?github\.com/|git@github\.com:|github\.com/)?"
    r"(?P<owner>[A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))/(?P<repo>[A-Za-z0-9._-]+?)(?:\.git)?/?$"
)


class GitHubError(Exception):
    def __init__(self, message: str, status: int = 502):
        super().__init__(message)
        self.status = status


def parse_repo(value: str) -> tuple[str, str]:
    """Accept ``owner/repo``, an https URL (optionally with /tree/...), or an SSH remote."""
    text = (value or "").strip()
    text = re.sub(r"^(https?://(?:www\.)?github\.com/[^/]+/[^/#?]+).*$", r"\1", text)
    match = _REPO_RE.match(text)
    if not match:
        raise GitHubError("Enter a GitHub repository as owner/repo or https://github.com/owner/repo", 422)
    return match.group("owner"), match.group("repo")


def _fernet() -> Fernet:
    seed = (
        settings.github_token_secret
        or settings.ai_internal_api_key
        or settings.clerk_secret_key
        or "devflow-local-development-only"
    )
    return Fernet(base64.urlsafe_b64encode(hashlib.sha256(seed.encode()).digest()))


def encrypt_token(token: str | None) -> str | None:
    return _fernet().encrypt(token.encode()).decode() if token else None


def decrypt_token(value: str | None) -> str | None:
    if not value:
        return None
    try:
        return _fernet().decrypt(value.encode()).decode()
    except InvalidToken:
        logger.warning("Stored GitHub token could not be decrypted (secret rotated?)")
        return None


class GitHubClient:
    def __init__(self, token: str | None = None):
        self._token = token or settings.github_token or None
        self.remaining: int | None = None  # last seen x-ratelimit-remaining

    @property
    def _headers(self) -> dict[str, str]:
        headers = {
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "Devflow-Repo-Tracker",
        }
        if self._token:
            headers["Authorization"] = f"Bearer {self._token}"
        return headers

    async def _request(self, method: str, path: str, **kwargs: Any) -> httpx.Response:
        async with httpx.AsyncClient(timeout=20.0, headers=self._headers) as client:
            resp = await client.request(method, f"{API}{path}", **kwargs)
        if resp.headers.get("x-ratelimit-remaining", "").isdigit():
            self.remaining = int(resp.headers["x-ratelimit-remaining"])
        if resp.status_code in (403, 429) and resp.headers.get("x-ratelimit-remaining") == "0":
            raise GitHubError(
                "GitHub API rate limit reached. Add a personal access token to the link "
                "or set GITHUB_TOKEN on the server.", 429,
            )
        if resp.status_code == 401:
            raise GitHubError("GitHub rejected the access token", 401)
        return resp

    async def _json(self, path: str, **params: Any) -> Any:
        resp = await self._request("GET", path, params=params or None)
        if resp.status_code == 404:
            raise GitHubError(
                "Repository not found. Check the name, or add a token with access if it is private.", 404,
            )
        if resp.status_code >= 400:
            raise GitHubError(f"GitHub API error {resp.status_code} on {path}", resp.status_code)
        return resp.json()

    async def user(self) -> dict[str, Any]:
        """The account the token belongs to, plus the OAuth scopes it was granted."""
        resp = await self._request("GET", "/user")
        if resp.status_code >= 400:
            raise GitHubError(f"GitHub API error {resp.status_code} on /user", resp.status_code)
        scopes = [s.strip() for s in resp.headers.get("x-oauth-scopes", "").split(",") if s.strip()]
        return {**resp.json(), "_scopes": scopes}

    async def user_repos(self, max_pages: int = 5) -> list[dict[str, Any]]:
        """Repos the token's user can access (own, collaborator, org member), recently pushed first."""
        out: list[dict[str, Any]] = []
        for page in range(1, max_pages + 1):
            batch = await self._json(
                "/user/repos", per_page=100, page=page, sort="pushed",
                affiliation="owner,collaborator,organization_member",
            )
            out.extend(batch)
            if len(batch) < 100:
                break
        return out

    async def repo(self, owner: str, repo: str) -> dict[str, Any]:
        return await self._json(f"/repos/{owner}/{repo}")

    async def languages(self, owner: str, repo: str) -> dict[str, int]:
        return await self._json(f"/repos/{owner}/{repo}/languages")

    async def contributors(self, owner: str, repo: str) -> list[dict[str, Any]]:
        resp = await self._request("GET", f"/repos/{owner}/{repo}/contributors", params={"per_page": 30})
        return resp.json() if resp.status_code == 200 else []

    async def readme(self, owner: str, repo: str, max_chars: int = 6000) -> str:
        resp = await self._request("GET", f"/repos/{owner}/{repo}/readme")
        if resp.status_code != 200:
            return ""
        try:
            raw = base64.b64decode(resp.json().get("content", "")).decode("utf-8", "replace")
        except Exception:
            return ""
        return raw[:max_chars]

    async def tree(self, owner: str, repo: str, branch: str, max_paths: int = 400) -> list[str]:
        resp = await self._request(
            "GET", f"/repos/{owner}/{repo}/git/trees/{branch}", params={"recursive": "1"}
        )
        if resp.status_code != 200:
            return []
        paths = [item["path"] for item in resp.json().get("tree", []) if item.get("type") == "blob"]
        return paths[:max_paths]

    async def head_sha(self, owner: str, repo: str, branch: str) -> str | None:
        resp = await self._request(
            "GET", f"/repos/{owner}/{repo}/commits/{branch}",
            headers={"Accept": "application/vnd.github.sha"},
        )
        return resp.text.strip() if resp.status_code == 200 else None

    async def head_sha_if_changed(
        self, owner: str, repo: str, branch: str, etag: str | None
    ) -> tuple[str | None, str | None]:
        """Conditional head check for polling. With a token, a 304 does not count against the rate limit."""
        headers = {"Accept": "application/vnd.github.sha"}
        if etag:
            headers["If-None-Match"] = etag
        resp = await self._request("GET", f"/repos/{owner}/{repo}/commits/{branch}", headers=headers)
        if resp.status_code == 200:
            return resp.text.strip(), resp.headers.get("etag")
        return None, etag

    async def commits(
        self, owner: str, repo: str, branch: str, stop_at: set[str], limit: int
    ) -> list[dict[str, Any]]:
        """Newest-first commits on ``branch`` that are not in ``stop_at``.

        Commits from a merged branch can be listed after the previously synced head
        (they carry older dates), so scanning stops only after a run of known shas.
        """
        out: list[dict[str, Any]] = []
        known_run = 0
        page = 1
        while len(out) < limit:
            batch = await self._json(
                f"/repos/{owner}/{repo}/commits", sha=branch, per_page=100, page=page
            )
            if not batch:
                break
            for item in batch:
                if item["sha"] in stop_at:
                    known_run += 1
                    if known_run >= 30:
                        return out
                    continue
                known_run = 0
                out.append(item)
                if len(out) >= limit:
                    break
            if len(batch) < 100:
                break
            page += 1
        return out

    async def commit_detail(self, owner: str, repo: str, sha: str) -> dict[str, Any] | None:
        resp = await self._request("GET", f"/repos/{owner}/{repo}/commits/{sha}")
        return resp.json() if resp.status_code == 200 else None

    async def create_push_webhook(self, owner: str, repo: str, url: str, secret: str) -> int | None:
        resp = await self._request(
            "POST", f"/repos/{owner}/{repo}/hooks",
            json={"name": "web", "active": True, "events": ["push"],
                  "config": {"url": url, "content_type": "json", "secret": secret}},
        )
        if resp.status_code in (200, 201):
            return int(resp.json()["id"])
        logger.info("Webhook not created for %s/%s (HTTP %s)", owner, repo, resp.status_code)
        return None

    async def delete_webhook(self, owner: str, repo: str, hook_id: int) -> None:
        await self._request("DELETE", f"/repos/{owner}/{repo}/hooks/{hook_id}")
