from __future__ import annotations

import hashlib
import secrets
import time
from dataclasses import dataclass

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.config import Settings, get_settings

security = HTTPBearer(auto_error=False)

# Short in-process cache so we don't re-decode on every hop within one request burst.
_AUTH_CACHE_TTL_SEC = 60.0
_auth_cache: dict[str, tuple[float, "AuthUser"]] = {}


@dataclass
class AuthUser:
    id: str
    email: str | None
    name: str | None


def _token_cache_key(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _cache_get(token: str) -> AuthUser | None:
    key = _token_cache_key(token)
    row = _auth_cache.get(key)
    if not row:
        return None
    expires_at, user = row
    if time.monotonic() > expires_at:
        _auth_cache.pop(key, None)
        return None
    return user


def _cache_set(token: str, user: AuthUser) -> None:
    if len(_auth_cache) > 256:
        now = time.monotonic()
        for k, (exp, _) in list(_auth_cache.items()):
            if now > exp:
                _auth_cache.pop(k, None)
        if len(_auth_cache) > 256:
            _auth_cache.clear()
    _auth_cache[_token_cache_key(token)] = (time.monotonic() + _AUTH_CACHE_TTL_SEC, user)


def verify_password(settings: Settings, password: str) -> bool:
    expected = settings.auth_password or ""
    if not expected:
        return False
    return secrets.compare_digest(password, expected)


def mint_access_token(settings: Settings, *, ttl_sec: int | None = None) -> str:
    if not settings.auth_secret:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="AUTH_SECRET není nastaven",
        )
    ttl = ttl_sec if ttl_sec is not None else settings.auth_token_ttl_sec
    now = int(time.time())
    payload = {
        "sub": settings.auth_user_id,
        "name": settings.auth_display_name,
        "email": settings.auth_email or None,
        "iat": now,
        "exp": now + max(300, ttl),
    }
    return jwt.encode(payload, settings.auth_secret, algorithm="HS256")


def decode_access_token(settings: Settings, token: str) -> AuthUser:
    if not settings.auth_secret:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="AUTH_SECRET není nastaven",
        )
    try:
        data = jwt.decode(token, settings.auth_secret, algorithms=["HS256"])
    except jwt.ExpiredSignatureError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Token vypršel — přihlas se znovu"
        ) from exc
    except jwt.InvalidTokenError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Neplatný token"
        ) from exc

    user_id = str(data.get("sub") or "")
    if not user_id or user_id != settings.auth_user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Neplatný uživatel")

    return AuthUser(
        id=user_id,
        email=data.get("email"),
        name=data.get("name") or settings.auth_display_name,
    )


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
    settings: Settings = Depends(get_settings),
) -> AuthUser:
    if credentials is None or not credentials.credentials:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Chybí autentizace")

    token = credentials.credentials
    cached = _cache_get(token)
    if cached is not None:
        return cached

    user = decode_access_token(settings, token)
    _cache_set(token, user)
    return user
