from __future__ import annotations

from dataclasses import dataclass

from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.config import Settings, get_settings

security = HTTPBearer(auto_error=False)


@dataclass
class AuthUser:
    id: str
    email: str | None
    name: str | None


def default_user(settings: Settings) -> AuthUser:
    """Single shared user — app is open access (no password login)."""
    return AuthUser(
        id=settings.auth_user_id,
        email=settings.auth_email or None,
        name=settings.auth_display_name,
    )


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
    settings: Settings = Depends(get_settings),
) -> AuthUser:
    # Open access: ignore Bearer tokens and always use the configured user.
    _ = credentials
    return default_user(settings)
