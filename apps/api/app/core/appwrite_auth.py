from __future__ import annotations

import httpx
from fastapi import HTTPException, status

from app.core.config import Settings


async def appwrite_email_session(
    settings: Settings, email: str, password: str
) -> dict:
    """Create an Appwrite email session; returns session JSON (includes userId)."""
    if not settings.appwrite_project_id:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Appwrite project není nakonfigurován",
        )
    async with httpx.AsyncClient(timeout=20.0) as client:
        resp = await client.post(
            f"{settings.appwrite_endpoint.rstrip('/')}/account/sessions/email",
            headers={
                "X-Appwrite-Project": settings.appwrite_project_id,
                "Content-Type": "application/json",
            },
            json={"email": email, "password": password},
        )
    if resp.status_code not in (200, 201):
        detail = "Neplatný e-mail nebo heslo"
        try:
            body = resp.json()
            detail = body.get("message") or detail
        except Exception:
            pass
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=detail)
    return resp.json()


async def appwrite_create_user(
    settings: Settings, *, user_id: str, email: str, password: str, name: str
) -> dict:
    if not settings.appwrite_api_key:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Appwrite API key není nastaven",
        )
    async with httpx.AsyncClient(timeout=20.0) as client:
        resp = await client.post(
            f"{settings.appwrite_endpoint.rstrip('/')}/users",
            headers={
                "X-Appwrite-Project": settings.appwrite_project_id,
                "X-Appwrite-Key": settings.appwrite_api_key,
                "Content-Type": "application/json",
            },
            json={
                "userId": user_id,
                "email": email,
                "password": password,
                "name": name,
            },
        )
    if resp.status_code not in (200, 201):
        detail = "Registrace selhala"
        try:
            body = resp.json()
            detail = body.get("message") or detail
        except Exception:
            pass
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)
    return resp.json()


async def mint_user_jwt(
    settings: Settings,
    user_id: str,
    *,
    session_id: str | None = None,
    duration_sec: int = 86_400,
) -> str:
    """Mint Appwrite JWT via Users API (API key) — works without browser cookies."""
    if not settings.appwrite_api_key:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Appwrite API key není nastaven",
        )
    payload: dict = {"duration": duration_sec}
    if session_id:
        payload["sessionId"] = session_id
    async with httpx.AsyncClient(timeout=20.0) as client:
        resp = await client.post(
            f"{settings.appwrite_endpoint.rstrip('/')}/users/{user_id}/jwts",
            headers={
                "X-Appwrite-Project": settings.appwrite_project_id,
                "X-Appwrite-Key": settings.appwrite_api_key,
                "Content-Type": "application/json",
            },
            json=payload,
        )
    if resp.status_code not in (200, 201):
        detail = "Nepodařilo se vytvořit API token"
        try:
            body = resp.json()
            detail = body.get("message") or detail
        except Exception:
            pass
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=detail)
    data = resp.json()
    token = data.get("jwt")
    if not token:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Appwrite nevrátil JWT",
        )
    return token


async def fetch_account_with_jwt(settings: Settings, jwt: str) -> dict:
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get(
            f"{settings.appwrite_endpoint.rstrip('/')}/account",
            headers={
                "X-Appwrite-Project": settings.appwrite_project_id,
                "X-Appwrite-JWT": jwt,
            },
        )
    if resp.status_code != 200:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Neplatná session")
    return resp.json()
