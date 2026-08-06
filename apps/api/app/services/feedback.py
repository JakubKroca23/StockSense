from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models import CloseReason, FeedbackResult, Tip, TipFeedback
from app.services.tip_lifecycle import infer_close_reason

TP_REASONS = {CloseReason.target_1.value, CloseReason.target_2.value}
SL_REASONS = {CloseReason.stop.value}


def _resolved_reason(fb: TipFeedback) -> str:
    if fb.close_reason:
        return fb.close_reason
    return infer_close_reason(fb.notes) or CloseReason.manual.value


async def feedback_stats(db: AsyncSession, user_id: str) -> dict:
    """Aggregate tip feedback → hit-rate, TP/SL counts and small scoring adjustment."""
    rows = (
        await db.execute(
            select(TipFeedback, Tip)
            .join(Tip, Tip.id == TipFeedback.tip_id)
            .where(TipFeedback.user_id == user_id)
            .options(selectinload(Tip.instrument))
            .order_by(TipFeedback.created_at.desc())
            .limit(200)
        )
    ).all()

    total = len(rows)
    hits = misses = partials = 0
    tp_hits = sl_hits = 0
    by_class: dict[str, dict[str, int]] = {}
    by_close_reason: dict[str, int] = {}
    for fb, tip in rows:
        cls = tip.instrument.asset_class.value if tip.instrument else "other"
        bucket = by_class.setdefault(cls, {"hit": 0, "miss": 0, "partial": 0, "total": 0})
        bucket["total"] += 1
        if fb.result == FeedbackResult.hit:
            hits += 1
            bucket["hit"] += 1
        elif fb.result == FeedbackResult.miss:
            misses += 1
            bucket["miss"] += 1
        else:
            partials += 1
            bucket["partial"] += 1

        reason = _resolved_reason(fb)
        by_close_reason[reason] = by_close_reason.get(reason, 0) + 1
        if reason in TP_REASONS:
            tp_hits += 1
        elif reason in SL_REASONS:
            sl_hits += 1

    hit_rate = (hits + 0.5 * partials) / total if total else None
    # Map hit-rate to small score nudge in [-0.15, +0.15] for learning loop
    score_adj = 0.0
    if hit_rate is not None and total >= 3:
        score_adj = max(-0.15, min(0.15, (hit_rate - 0.5) * 0.4))

    level_decided = tp_hits + sl_hits
    tp_rate = (tp_hits / level_decided) if level_decided else None

    return {
        "total": total,
        "hits": hits,
        "misses": misses,
        "partials": partials,
        "hit_rate": round(hit_rate, 3) if hit_rate is not None else None,
        "tp_hits": tp_hits,
        "sl_hits": sl_hits,
        "tp_rate": round(tp_rate, 3) if tp_rate is not None else None,
        "by_close_reason": by_close_reason,
        "score_adj": round(score_adj, 3),
        "by_asset_class": by_class,
    }


async def feedback_adj_for_scoring(db: AsyncSession, user_id: str) -> float:
    stats = await feedback_stats(db, user_id)
    return float(stats.get("score_adj") or 0.0)


async def feedback_adj_for_asset_class(db: AsyncSession, user_id: str, asset_class: str) -> float:
    """Per-asset-class learning nudge; falls back to global adj."""
    stats = await feedback_stats(db, user_id)
    by = stats.get("by_asset_class") or {}
    bucket = by.get(asset_class) or by.get(asset_class.lower())
    if not bucket or bucket.get("total", 0) < 3:
        return float(stats.get("score_adj") or 0.0)
    total = bucket["total"]
    hit_rate = (bucket["hit"] + 0.5 * bucket["partial"]) / total
    return round(max(-0.15, min(0.15, (hit_rate - 0.5) * 0.4)), 3)
