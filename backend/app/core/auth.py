"""Clerk session-token verification and local user synchronization."""
from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass
from typing import Any

import httpx
import jwt
from fastapi import Depends, HTTPException, Request, WebSocket, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.config import settings
from app.db.postgres import execute, fetchrow

bearer = HTTPBearer(auto_error=False)
_jwks_client = (
    jwt.PyJWKClient(f"{settings.clerk_issuer_url}/.well-known/jwks.json")
    if settings.clerk_issuer_url else None
)


@dataclass(frozen=True)
class CurrentUser:
    id: str
    email: str | None = None
    first_name: str | None = None
    last_name: str | None = None
    image_url: str | None = None
    role: str = "developer"
    specialization: str | None = None


def _get_jwks_client():
    global _jwks_client
    if _jwks_client is None and settings.clerk_issuer_url:
        _jwks_client = jwt.PyJWKClient(f"{settings.clerk_issuer_url.rstrip('/')}/.well-known/jwks.json")
    return _jwks_client


def _decode_token(token: str) -> dict[str, Any]:
    if not settings.clerk_issuer_url:
        raise HTTPException(status_code=503, detail="Clerk is not configured")
    try:
        client = _get_jwks_client()
        if client is None:
            raise HTTPException(status_code=503, detail="Clerk is not configured")
        signing_key = client.get_signing_key_from_jwt(token)
        issuer_clean = settings.clerk_issuer_url.rstrip("/")
        claims = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            issuer=issuer_clean,
            options={"require": ["exp", "iat", "sub"]},
        )
        authorized_party = claims.get("azp")
        if authorized_party:
            azp_clean = authorized_party.rstrip("/")
            allowed_origins = [o.rstrip("/") for o in settings.cors_origins]
            if azp_clean not in allowed_origins:
                raise HTTPException(status_code=401, detail="Invalid token origin")
        return claims
    except jwt.PyJWTError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid session token") from exc


async def _clerk_profile(user_id: str) -> dict[str, Any]:
    if not settings.clerk_secret_key:
        return {}
    async with httpx.AsyncClient(timeout=8) as client:
        response = await client.get(
            f"https://api.clerk.com/v1/users/{user_id}",
            headers={"Authorization": f"Bearer {settings.clerk_secret_key}"},
        )
    if response.status_code != 200:
        return {}
    return response.json()


DEMO_USER = CurrentUser(
    id="user_demo_devflow",
    email="demo@devflow.ai",
    first_name="Demo",
    last_name="User",
    image_url="https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=256&q=80",
    role="manager",
)


async def _ensure_demo_user() -> CurrentUser:
    try:
        await execute(
            """INSERT INTO users (clerk_user_id, email, first_name, last_name, image_url, role)
               VALUES ($1, $2, $3, $4, $5, $6)
               ON CONFLICT (clerk_user_id) DO UPDATE SET
                 email=EXCLUDED.email, first_name=EXCLUDED.first_name,
                 last_name=EXCLUDED.last_name, image_url=EXCLUDED.image_url, updated_at=NOW()""",
            DEMO_USER.id, DEMO_USER.email, DEMO_USER.first_name, DEMO_USER.last_name, DEMO_USER.image_url, DEMO_USER.role,
        )
    except Exception:
        pass
    return DEMO_USER


# Resolved users, cached briefly. The token is still verified on every request;
# this only skips the Clerk profile call and the users-table upsert, which
# otherwise ran on every API call (including the workspace's 5s poll).
_USER_TTL_SECONDS = 300.0
_user_cache: dict[str, tuple[float, CurrentUser]] = {}


def invalidate_user(user_id: str) -> None:
    """Drop a cached user after their role or profile changes."""
    _user_cache.pop(user_id, None)


async def authenticate_token(token: str) -> CurrentUser:
    if settings.bypass_auth:
        return await _ensure_demo_user()
    if not settings.clerk_issuer_url:
        raise HTTPException(status_code=503, detail="Clerk is not configured")
    try:
        claims = await asyncio.to_thread(_decode_token, token)
        user_id = str(claims["sub"])
        cached = _user_cache.get(user_id)
        if cached and time.monotonic() - cached[0] < _USER_TTL_SECONDS:
            return cached[1]
        profile = await _clerk_profile(user_id)
        emails = profile.get("email_addresses") or []
        primary_id = profile.get("primary_email_address_id")
        primary = next((item for item in emails if item.get("id") == primary_id), emails[0] if emails else {})
        email_addr = primary.get("email_address") or claims.get("email")
        first = profile.get("first_name") or claims.get("first_name")
        last = profile.get("last_name") or claims.get("last_name")
        img = profile.get("image_url") or claims.get("image_url")
        await execute(
            """INSERT INTO users (clerk_user_id, email, first_name, last_name, image_url)
               VALUES ($1, $2, $3, $4, $5)
               ON CONFLICT (clerk_user_id) DO UPDATE SET
                 email=EXCLUDED.email, first_name=EXCLUDED.first_name,
                 last_name=EXCLUDED.last_name, image_url=EXCLUDED.image_url, updated_at=NOW()""",
            user_id, email_addr, first, last, img,
        )
        # Fetch role and specialization from DB
        db_row = await fetchrow(
            "SELECT role, specialization FROM users WHERE clerk_user_id=$1", user_id
        )
        user = CurrentUser(
            id=user_id,
            email=email_addr,
            first_name=first,
            last_name=last,
            image_url=img,
            role=db_row["role"] if db_row and db_row["role"] else "developer",
            specialization=db_row["specialization"] if db_row else None,
        )
        if len(_user_cache) > 5000:
            _user_cache.clear()
        _user_cache[user_id] = (time.monotonic(), user)
        return user
    except Exception:
        if settings.bypass_auth:
            return await _ensure_demo_user()
        raise


async def current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
) -> CurrentUser:
    if credentials is None or credentials.scheme.lower() != "bearer":
        if settings.bypass_auth:
            return await _ensure_demo_user()
        raise HTTPException(status_code=401, detail="Authentication required")
    return await authenticate_token(credentials.credentials)


async def websocket_user(websocket: WebSocket) -> CurrentUser:
    token = websocket.query_params.get("token")
    if settings.bypass_auth:
        return await _ensure_demo_user()
    if not token:
        raise HTTPException(status_code=401, detail="Authentication required")
    return await authenticate_token(token)
