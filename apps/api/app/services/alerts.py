from __future__ import annotations

import logging
import smtplib
from datetime import datetime, time, timezone
from email.message import EmailMessage
from zoneinfo import ZoneInfo

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models import Alert, UserSettings
from app.services.push import send_web_push

logger = logging.getLogger(__name__)

# Preference keys under UserSettings.preferences
DEFAULT_ALERT_KINDS = {
    "new_tip": True,
    "daily_report": True,
    "price_stop": True,
    "price_target": True,
    "price_rule": True,
    "tip_invalidated": True,
}


def normalize_alert_kind(kind: str) -> str:
    """Map concrete alert kind → preference bucket."""
    if kind == "new_tip":
        return "new_tip"
    if kind == "daily_report":
        return "daily_report"
    if kind == "tip_invalidated":
        return "tip_invalidated"
    if kind.startswith("price_stop") or kind == "price_stop":
        return "price_stop"
    if kind.startswith("price_target") or kind in ("price_target_1", "price_target_2"):
        return "price_target"
    if kind.startswith("rule_") or kind.startswith("price_"):
        return "price_rule"
    return kind


def _alert_kind_enabled(prefs: dict | None, kind: str) -> bool:
    kinds = {**DEFAULT_ALERT_KINDS, **((prefs or {}).get("alert_kinds") or {})}
    bucket = normalize_alert_kind(kind)
    return bool(kinds.get(bucket, True))


def _in_quiet_hours(prefs: dict | None, now: datetime | None = None) -> bool:
    quiet = (prefs or {}).get("quiet_hours") or {}
    if not quiet.get("enabled"):
        return False
    start_s = str(quiet.get("start") or "22:00")
    end_s = str(quiet.get("end") or "07:00")
    tz_name = str(quiet.get("timezone") or "Europe/Prague")
    try:
        tz = ZoneInfo(tz_name)
    except Exception:
        tz = ZoneInfo("Europe/Prague")
    now_local = (now or datetime.now(timezone.utc)).astimezone(tz)
    try:
        sh, sm = [int(x) for x in start_s.split(":")[:2]]
        eh, em = [int(x) for x in end_s.split(":")[:2]]
        start_t = time(sh, sm)
        end_t = time(eh, em)
    except Exception:
        return False
    t = now_local.timetz().replace(tzinfo=None)
    if start_t == end_t:
        return False
    if start_t < end_t:
        # e.g. 13:00–15:00 same day
        return start_t <= t < end_t
    # overnight e.g. 22:00–07:00
    return t >= start_t or t < end_t


def _push_url_for_kind(kind: str, payload: dict) -> str:
    symbol = (payload or {}).get("symbol")
    if symbol and (kind.startswith("price_") or kind.startswith("rule_") or kind == "new_tip"):
        return f"/instrument/{symbol}"
    if kind == "daily_report":
        return "/reports"
    return "/alerts"


async def create_alert(
    db: AsyncSession,
    *,
    user_id: str,
    kind: str,
    title: str,
    body: str,
    payload: dict | None = None,
) -> Alert | None:
    from sqlalchemy import select

    result = await db.execute(select(UserSettings).where(UserSettings.user_id == user_id))
    user_settings = result.scalar_one_or_none()
    prefs = (user_settings.preferences if user_settings else None) or {}

    if not _alert_kind_enabled(prefs, kind):
        logger.debug("Alert kind %s disabled for user %s", kind, user_id)
        return None

    alert = Alert(
        user_id=user_id,
        kind=kind,
        title=title,
        body=body,
        payload=payload or {},
    )
    db.add(alert)
    await db.flush()

    settings = get_settings()
    quiet = _in_quiet_hours(prefs)
    notify = not quiet

    if (
        notify
        and user_settings
        and user_settings.alert_email
        and (user_settings.email or settings.alert_email_to)
    ):
        to_addr = user_settings.email or settings.alert_email_to
        try:
            send_email(to_addr, title, body)
        except Exception as exc:
            logger.warning("Email alert failed: %s", exc)

    if notify and user_settings and user_settings.alert_push and user_settings.push_subscription:
        ok = send_web_push(
            user_settings.push_subscription,
            title=title,
            body=body,
            url=_push_url_for_kind(kind, payload or {}),
        )
        if not ok and isinstance(user_settings.push_subscription, dict):
            # Clear expired stub / dead subscription lightly — only if endpoint present and push failed hard
            pass

    return alert


def send_email(to_addr: str, subject: str, body: str) -> None:
    settings = get_settings()
    if not settings.smtp_host or not to_addr:
        return
    msg = EmailMessage()
    msg["From"] = settings.smtp_user or "stocksense@propoj.app"
    msg["To"] = to_addr
    msg["Subject"] = f"[StockSense] {subject}"
    msg.set_content(body)
    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=20) as smtp:
        smtp.starttls()
        if settings.smtp_user and settings.smtp_password:
            smtp.login(settings.smtp_user, settings.smtp_password)
        smtp.send_message(msg)
