from dataclasses import dataclass

import httpx
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.config import Settings, get_settings

security = HTTPBearer(auto_error=False)


@dataclass
class AuthUser:
    id: str
    email: str | None
    name: str | None


async def _fetch_account(client: httpx.AsyncClient, endpoint: str, headers: dict[str, str]):
    return await client.get(f"{endpoint.rstrip('/')}/account", headers=headers)


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
    settings: Settings = Depends(get_settings),
) -> AuthUser:
    if credentials is None or not credentials.credentials:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Chybí autentizace")

    if not settings.appwrite_project_id:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Appwrite project není nakonfigurován",
        )

    token = credentials.credentials
    project = settings.appwrite_project_id
    endpoint = settings.appwrite_endpoint

    async with httpx.AsyncClient(timeout=15.0) as client:
        # Prefer JWT (what the web client mints); fall back to session secret.
        resp = await _fetch_account(
            client,
            endpoint,
            {
                "X-Appwrite-Project": project,
                "X-Appwrite-JWT": token,
            },
        )
        if resp.status_code != 200:
            resp = await _fetch_account(
                client,
                endpoint,
                {
                    "X-Appwrite-Project": project,
                    "X-Appwrite-Session": token,
                },
            )
        if resp.status_code != 200:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Neplatná session")

        data = resp.json()
        user = AuthUser(
            id=data.get("$id") or data.get("id") or "",
            email=data.get("email"),
            name=data.get("name"),
        )

    if not user.id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Neplatný uživatel")

    allowed = settings.allowed_user_id_list
    if allowed and user.id not in allowed:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Přístup odepřen")

    return user
