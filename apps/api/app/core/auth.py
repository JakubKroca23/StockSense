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


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
    settings: Settings = Depends(get_settings),
) -> AuthUser:
    if credentials is None or not credentials.credentials:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Chybí autentizace")

    token = credentials.credentials
    headers = {
        "X-Appwrite-Project": settings.appwrite_project_id,
        "X-Appwrite-JWT": token,
    }
    # Also try session cookie style via Session header used by some Appwrite setups
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get(
            f"{settings.appwrite_endpoint.rstrip('/')}/account",
            headers={
                "X-Appwrite-Project": settings.appwrite_project_id,
                "X-Appwrite-Session": token,
            },
        )
        if resp.status_code != 200:
            resp = await client.get(
                f"{settings.appwrite_endpoint.rstrip('/')}/account",
                headers=headers,
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
