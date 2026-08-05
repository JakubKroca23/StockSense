from __future__ import annotations

import logging
import smtplib
from email.message import EmailMessage

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models import Alert, UserSettings

logger = logging.getLogger(__name__)


async def create_alert(
    db: AsyncSession,
    *,
    user_id: str,
    kind: str,
    title: str,
    body: str,
    payload: dict | None = None,
) -> Alert:
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
    from sqlalchemy import select

    result = await db.execute(select(UserSettings).where(UserSettings.user_id == user_id))
    user_settings = result.scalar_one_or_none()

    if user_settings and user_settings.alert_email and (user_settings.email or settings.alert_email_to):
        to_addr = user_settings.email or settings.alert_email_to
        try:
            send_email(to_addr, title, body)
        except Exception as exc:
            logger.warning("Email alert failed: %s", exc)

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
