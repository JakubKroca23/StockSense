from __future__ import annotations

import json
import logging

from app.core.config import get_settings

logger = logging.getLogger(__name__)


def vapid_configured() -> bool:
    s = get_settings()
    return bool(s.vapid_public_key and s.vapid_private_key)


def send_web_push(subscription: dict, *, title: str, body: str, url: str = "/alerts") -> bool:
    """Send a Web Push notification. Returns False if skipped/failed."""
    if not vapid_configured():
        return False
    if not subscription or not subscription.get("endpoint"):
        return False
    # Ignore stub markers from older settings UI
    if "keys" not in subscription:
        return False

    settings = get_settings()
    private_key = (settings.vapid_private_key or "").replace("\\n", "\n")
    try:
        from pywebpush import webpush

        webpush(
            subscription_info=subscription,
            data=json.dumps({"title": title, "body": body, "url": url}, ensure_ascii=False),
            vapid_private_key=private_key,
            vapid_claims={"sub": settings.vapid_subject or "mailto:stocksense@propoj.app"},
            ttl=60 * 60 * 12,
        )
        return True
    except Exception as exc:
        logger.warning("Web push failed: %s", exc)
        return False
