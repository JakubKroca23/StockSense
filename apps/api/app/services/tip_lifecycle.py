from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models import FeedbackResult, Tip, TipFeedback, TipHorizon, TipStatus
from app.services.alerts import create_alert

HORIZON_TTL_DAYS: dict[str, int] = {
    TipHorizon.intraday.value: 2,
    TipHorizon.swing.value: 14,
    TipHorizon.position.value: 90,
    TipHorizon.long_term.value: 365,
}

# Score move that invalidates an accepted tip
SCORE_FLIP_THRESHOLD = 40.0


def horizon_ttl_days(horizon: TipHorizon | str) -> int:
    key = horizon.value if hasattr(horizon, "value") else str(horizon)
    return HORIZON_TTL_DAYS.get(key, 30)


def tip_expired(tip: Tip, now: datetime | None = None) -> bool:
    now = now or datetime.now(timezone.utc)
    as_of = tip.as_of or tip.created_at
    if as_of is None:
        return False
    if as_of.tzinfo is None:
        as_of = as_of.replace(tzinfo=timezone.utc)
    return now > as_of + timedelta(days=horizon_ttl_days(tip.horizon))


def score_flip(old_score: float, old_action: str, new_score: float, new_action: str) -> bool:
    if abs(new_score - old_score) >= SCORE_FLIP_THRESHOLD:
        return True
    longish = {"buy", "trade", "hold"}
    shortish = {"sell"}
    oa, na = str(old_action), str(new_action)
    if oa in longish and na in shortish:
        return True
    if oa in shortish and na in longish:
        return True
    return False


async def close_tip(
    db: AsyncSession,
    tip: Tip,
    *,
    result: FeedbackResult,
    notes: str,
    alert: bool = True,
) -> None:
    tip.is_active = False
    tip.status = TipStatus.closed.value
    existing = (
        await db.execute(select(TipFeedback).where(TipFeedback.tip_id == tip.id))
    ).scalar_one_or_none()
    if existing:
        existing.result = result
        existing.notes = notes
    else:
        db.add(
            TipFeedback(
                tip_id=tip.id,
                user_id=tip.user_id,
                result=result,
                notes=notes,
            )
        )
    if alert:
        sym = tip.instrument.symbol if tip.instrument else "?"
        await create_alert(
            db,
            user_id=tip.user_id,
            kind="tip_invalidated",
            title=f"{sym}: tip uzavřen ({result.value})",
            body=notes,
            payload={
                "tip_id": tip.id,
                "symbol": sym,
                "result": result.value,
                "reason": notes,
            },
        )


async def invalidate_expired_tips(db: AsyncSession, user_id: str) -> int:
    tips = (
        await db.execute(
            select(Tip)
            .where(Tip.user_id == user_id, Tip.is_active.is_(True))
            .options(selectinload(Tip.instrument))
        )
    ).scalars().all()
    n = 0
    now = datetime.now(timezone.utc)
    for tip in tips:
        if not tip_expired(tip, now):
            continue
        await close_tip(
            db,
            tip,
            result=FeedbackResult.partial,
            notes=f"Expirace horizontu {tip.horizon.value} (TTL {horizon_ttl_days(tip.horizon)}d).",
        )
        n += 1
    return n
