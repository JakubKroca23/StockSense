from __future__ import annotations

import logging
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models import (
    Alert,
    Instrument,
    MacroSnapshot,
    PortfolioPosition,
    PortfolioSnapshot,
    PriceAlertRule,
    PriceBar,
    Report,
    RiskProfile,
    Tip,
    UserSettings,
    Watchlist,
)
from app.services.alerts import create_alert
from app.services.feedback import feedback_adj_for_scoring
from app.services.fundament_macro import fetch_fred_latest
from app.services.instruments import ensure_discovery_universe
from app.services.llm import LLMTask, llm_complete, narrate_tip
from app.services.market_data import market_data
from app.services.scoring import score_instrument

logger = logging.getLogger(__name__)


async def sync_prices_for_instruments(db: AsyncSession, instruments: list[Instrument]) -> int:
    count = 0
    for inst in instruments:
        try:
            bars = await market_data.fetch_ohlcv(inst.symbol, inst.asset_class, interval="1d", lookback="6mo")
            for bar in bars[-60:]:
                existing = await db.execute(
                    select(PriceBar).where(
                        PriceBar.instrument_id == inst.id,
                        PriceBar.interval == "1d",
                        PriceBar.ts == bar.ts,
                    )
                )
                if existing.scalar_one_or_none():
                    continue
                db.add(
                    PriceBar(
                        instrument_id=inst.id,
                        interval="1d",
                        ts=bar.ts,
                        open=bar.open,
                        high=bar.high,
                        low=bar.low,
                        close=bar.close,
                        volume=bar.volume,
                        source=bar.source,
                        data_quality=bar.data_quality,
                        as_of=datetime.now(timezone.utc),
                    )
                )
                count += 1
            await db.commit()
        except Exception as exc:
            logger.warning("Price sync failed for %s: %s", inst.symbol, exc)
            await db.rollback()
    return count


async def sync_macro(db: AsyncSession) -> int:
    rows = await fetch_fred_latest()
    n = 0
    for row in rows:
        existing = await db.execute(
            select(MacroSnapshot).where(
                MacroSnapshot.series_id == row["series_id"],
                MacroSnapshot.ts == row["ts"],
            )
        )
        if existing.scalar_one_or_none():
            continue
        db.add(
            MacroSnapshot(
                series_id=row["series_id"],
                name=row["name"],
                value=row["value"],
                ts=row["ts"],
                source=row["source"],
            )
        )
        n += 1
    await db.commit()
    return n


def _macro_bias_from_snapshots(snaps: list[MacroSnapshot]) -> float:
    """Simple heuristic: inverted yield / high VIX = risk-off."""
    by_id = {s.series_id: s.value for s in snaps}
    bias = 0.0
    dgs10 = by_id.get("DGS10")
    dgs2 = by_id.get("DGS2")
    if dgs10 is not None and dgs2 is not None:
        spread = dgs10 - dgs2
        bias += 0.2 if spread > 0 else -0.25
    vix = by_id.get("VIXCLS")
    if vix is not None:
        if vix > 25:
            bias -= 0.3
        elif vix < 15:
            bias += 0.15
    return max(-1.0, min(1.0, bias))


async def _instruments_for_user(db: AsyncSession, user_id: str) -> list[Instrument]:
    from app.models import WatchlistItem

    ids: set[int] = set()
    wl = await db.execute(
        select(Watchlist)
        .where(Watchlist.user_id == user_id)
        .options(selectinload(Watchlist.items).selectinload(WatchlistItem.instrument))
    )
    for watchlist in wl.scalars().all():
        for item in watchlist.items:
            ids.add(item.instrument_id)

    pos = await db.execute(select(PortfolioPosition).where(PortfolioPosition.user_id == user_id))
    for p in pos.scalars().all():
        ids.add(p.instrument_id)

    disc = await db.execute(select(Instrument).where(Instrument.is_discovery.is_(True)))
    for inst in disc.scalars().all():
        ids.add(inst.id)

    if not ids:
        return []
    result = await db.execute(select(Instrument).where(Instrument.id.in_(ids)))
    return list(result.scalars().all())


async def run_scoring_for_user(db: AsyncSession, user_id: str) -> list[Tip]:
    await ensure_discovery_universe(db)

    settings_row = (
        await db.execute(select(UserSettings).where(UserSettings.user_id == user_id))
    ).scalar_one_or_none()
    risk = settings_row.risk_profile if settings_row else RiskProfile.balanced
    max_pct = settings_row.max_position_pct if settings_row else 5.0
    return await _run_scoring(db, user_id, risk, max_pct)


async def _run_scoring(
    db: AsyncSession, user_id: str, risk: RiskProfile, max_pct: float
) -> list[Tip]:
    macro_result = await db.execute(
        select(MacroSnapshot).order_by(MacroSnapshot.as_of.desc()).limit(50)
    )
    macro_bias = _macro_bias_from_snapshots(list(macro_result.scalars().all()))
    feedback_adj = await feedback_adj_for_scoring(db, user_id)

    instruments = await _instruments_for_user(db, user_id)
    await sync_prices_for_instruments(db, instruments)

    # deactivate old tips
    old = await db.execute(select(Tip).where(Tip.user_id == user_id, Tip.is_active.is_(True)))
    for tip in old.scalars().all():
        tip.is_active = False

    created: list[Tip] = []
    for inst in instruments:
        try:
            bars = await market_data.fetch_ohlcv(inst.symbol, inst.asset_class)
            quote = await market_data.fetch_quote(inst.symbol, inst.asset_class)
            result = score_instrument(
                bars, quote, inst.asset_class, risk, max_pct, macro_bias, feedback_adj
            )
            if not result:
                continue
            tip = Tip(
                user_id=user_id,
                instrument_id=inst.id,
                action=result.action,
                horizon=result.horizon,
                entry_low=result.entry_low,
                entry_high=result.entry_high,
                stop=result.stop,
                target_1=result.target_1,
                target_2=result.target_2,
                score=result.score,
                confidence=result.confidence,
                scenario_bull=result.scenario_bull,
                scenario_base=result.scenario_base,
                scenario_bear=result.scenario_bear,
                rationale=result.rationale,
                risks=result.risks,
                data_quality=result.data_quality,
                risk_profile=risk,
                suggested_size_pct=result.suggested_size_pct,
                is_active=True,
            )
            # narrative for stronger tips
            if abs(result.score) >= 20:
                tip.narrative_cs = await narrate_tip(
                    inst.symbol,
                    {
                        "action": result.action.value,
                        "horizon": result.horizon.value,
                        "score": result.score,
                        "confidence": result.confidence,
                        "entry_low": result.entry_low,
                        "entry_high": result.entry_high,
                        "stop": result.stop,
                        "target_1": result.target_1,
                        "target_2": result.target_2,
                        "rationale": result.rationale,
                        "data_quality": result.data_quality.value,
                    },
                )
            db.add(tip)
            await db.flush()
            created.append(tip)
            await create_alert(
                db,
                user_id=user_id,
                kind="new_tip",
                title=f"Nový tip: {inst.symbol} → {result.action.value}",
                body=(
                    f"Score {result.score}, confidence {result.confidence}. "
                    f"Horizont {result.horizon.value}. "
                    f"{(tip.narrative_cs or '')[:240]}"
                ),
                payload={"tip_id": tip.id, "symbol": inst.symbol, "action": result.action.value},
            )
        except Exception as exc:
            logger.warning("Scoring failed for %s: %s", inst.symbol, exc)

    await db.commit()
    return created


async def generate_daily_report(db: AsyncSession, user_id: str) -> Report:
    tips = (
        await db.execute(
            select(Tip)
            .where(Tip.user_id == user_id, Tip.is_active.is_(True))
            .options(selectinload(Tip.instrument))
            .order_by(Tip.score.desc())
        )
    ).scalars().all()

    positions = (
        await db.execute(
            select(PortfolioPosition)
            .where(PortfolioPosition.user_id == user_id)
            .options(selectinload(PortfolioPosition.instrument))
        )
    ).scalars().all()

    macro_rows = (
        await db.execute(select(MacroSnapshot).order_by(MacroSnapshot.as_of.desc()).limit(20))
    ).scalars().all()
    macro_by = {}
    for m in macro_rows:
        macro_by.setdefault(m.series_id, m)
    macro_lines = [
        f"- {m.name or sid}: {m.value}"
        for sid, m in list(macro_by.items())[:8]
    ]

    tip_lines = [
        f"- **{t.instrument.symbol}**: {t.action.value} | score {t.score} | conf {t.confidence} | {t.horizon.value}"
        for t in tips[:15]
    ]
    top2 = tips[:2]
    focus_lines = [
        f"- {t.instrument.symbol} ({t.action.value}, score {t.score}): {(t.narrative_cs or t.scenario_base or '')[:180]}"
        for t in top2
    ]
    pos_lines = [
        f"- **{p.instrument.symbol}**: qty {p.quantity} @ {p.avg_cost}" + (" (paper)" if p.is_paper else "")
        for p in positions
    ]
    context = (
        "MAKRO:\n"
        + ("\n".join(macro_lines) or "- bez dat")
        + "\n\nTOP TIPY:\n"
        + ("\n".join(tip_lines) or "- žádné")
        + "\n\nFOKUS (1–2 tipy):\n"
        + ("\n".join(focus_lines) or "- žádné")
        + "\n\nPORTFOLIO:\n"
        + ("\n".join(pos_lines) or "- prázdné")
    )
    narrative = await llm_complete(
        (
            "Napiš denní Sense briefing v češtině (markdown). "
            "Struktura: 1) Sense shrnutí (5–8 vět), 2) Makro v 2 větách, "
            "3) Portfolio rizika, 4) 1–2 tipy ke sledování, 5) Rizika. Max 350 slov. "
            "Žádné vymyšlené čísla mimo kontext."
        ),
        task=LLMTask.heavy,
        context=context,
    )
    # Short plain excerpt for Home card
    briefing = await llm_complete(
        (
            "Z následujícího briefingu vytáhni 4–6 vět čistého textu pro Home kartu Sense. "
            "Bez markdownu, bez nadpisů. Čeština."
        ),
        task=LLMTask.light,
        context=narrative[:2500],
    )
    title = f"Denní report {datetime.now(timezone.utc).strftime('%Y-%m-%d')}"
    report = Report(
        user_id=user_id,
        kind="daily",
        title=title,
        content_md=narrative,
        meta={
            "tip_count": len(tips),
            "position_count": len(positions),
            "briefing_cs": (briefing or "").strip()[:1200],
            "focus_symbols": [t.instrument.symbol for t in top2],
        },
    )
    db.add(report)
    await create_alert(
        db,
        user_id=user_id,
        kind="daily_report",
        title=title,
        body="Denní Sense briefing je připravený.",
        payload={},
    )
    await db.commit()
    await db.refresh(report)
    return report


async def snapshot_portfolio(db: AsyncSession, user_id: str) -> PortfolioSnapshot | None:
    """Persist daily equity mark for curve."""
    positions = (
        await db.execute(
            select(PortfolioPosition)
            .where(PortfolioPosition.user_id == user_id)
            .options(selectinload(PortfolioPosition.instrument))
        )
    ).scalars().all()
    today = datetime.now(timezone.utc).date()
    existing = (
        await db.execute(
            select(PortfolioSnapshot).where(
                PortfolioSnapshot.user_id == user_id,
                PortfolioSnapshot.as_of == today,
            )
        )
    ).scalar_one_or_none()

    total_value = 0.0
    total_cost = 0.0
    breakdown = []
    for p in positions:
        qty = float(p.quantity)
        cost_px = float(p.avg_cost)
        cost = cost_px * qty
        last = (
            await db.execute(
                select(PriceBar)
                .where(PriceBar.instrument_id == p.instrument_id, PriceBar.interval == "1d")
                .order_by(PriceBar.ts.desc())
                .limit(1)
            )
        ).scalar_one_or_none()
        last_px = float(last.close) if last else cost_px
        mv = last_px * qty
        total_value += mv
        total_cost += cost
        breakdown.append(
            {
                "symbol": p.instrument.symbol,
                "mv": round(mv, 4),
                "cost": round(cost, 4),
                "pnl": round(mv - cost, 4),
            }
        )
    pnl = total_value - total_cost
    pnl_pct = (pnl / total_cost * 100) if total_cost else None

    if existing:
        existing.total_value = total_value
        existing.total_cost = total_cost
        existing.pnl = pnl
        existing.pnl_pct = pnl_pct
        existing.breakdown = {"positions": breakdown}
        snap = existing
    else:
        snap = PortfolioSnapshot(
            user_id=user_id,
            as_of=today,
            total_value=total_value,
            total_cost=total_cost,
            pnl=pnl,
            pnl_pct=pnl_pct,
            currency="USD",
            breakdown={"positions": breakdown},
        )
        db.add(snap)
    await db.commit()
    await db.refresh(snap)
    return snap


async def _recent_alert_exists(
    db: AsyncSession, user_id: str, kind: str, symbol: str, hours: int = 18
) -> bool:
    from datetime import timedelta

    since = datetime.now(timezone.utc) - timedelta(hours=hours)
    row = (
        await db.execute(
            select(Alert)
            .where(
                Alert.user_id == user_id,
                Alert.kind == kind,
                Alert.created_at >= since,
            )
            .order_by(Alert.created_at.desc())
            .limit(20)
        )
    ).scalars().all()
    for a in row:
        if (a.payload or {}).get("symbol") == symbol:
            return True
    return False


async def check_price_alerts(db: AsyncSession, user_id: str) -> int:
    n = 0
    # 1) Tip-derived levels
    tips = (
        await db.execute(
            select(Tip)
            .where(Tip.user_id == user_id, Tip.is_active.is_(True))
            .options(selectinload(Tip.instrument))
        )
    ).scalars().all()
    for tip in tips:
        quote = await market_data.fetch_quote(tip.instrument.symbol, tip.instrument.asset_class)
        if quote.price is None:
            continue
        price = quote.price
        hit = None
        level_px = None
        if tip.stop and (
            (tip.action.value in ("buy", "trade", "hold") and price <= tip.stop)
            or (tip.action.value == "sell" and price >= tip.stop)
        ):
            hit = "stop"
            level_px = tip.stop
        elif tip.target_1 and (
            (tip.action.value in ("buy", "trade") and price >= tip.target_1)
            or (tip.action.value == "sell" and price <= tip.target_1)
        ):
            hit = "target_1"
            level_px = tip.target_1
        elif tip.entry_low and tip.entry_high and tip.entry_low <= price <= tip.entry_high:
            hit = "entry"
            level_px = price
        if hit:
            kind = f"price_{hit}"
            if await _recent_alert_exists(db, user_id, kind, tip.instrument.symbol):
                continue
            await create_alert(
                db,
                user_id=user_id,
                kind=kind,
                title=f"{tip.instrument.symbol}: zásah {hit}",
                body=f"Cena {price} zasáhla úroveň {hit} ({level_px}) u tipu #{tip.id}.",
                payload={
                    "tip_id": tip.id,
                    "symbol": tip.instrument.symbol,
                    "price": price,
                    "level": hit,
                    "level_price": level_px,
                },
            )
            n += 1

    # 2) User price rules (+ auto avg_cost near-touch)
    rules = (
        await db.execute(
            select(PriceAlertRule)
            .where(PriceAlertRule.user_id == user_id, PriceAlertRule.is_active.is_(True))
            .options(selectinload(PriceAlertRule.instrument))
        )
    ).scalars().all()
    for rule in rules:
        quote = await market_data.fetch_quote(rule.instrument.symbol, rule.instrument.asset_class)
        if quote.price is None:
            continue
        price = quote.price
        level = float(rule.price)
        triggered = False
        if rule.direction == "above" and price >= level:
            triggered = True
        elif rule.direction == "below" and price <= level:
            triggered = True
        elif rule.direction == "cross":
            # within 0.4% band counts as touch
            if abs(price - level) / max(abs(level), 1e-9) <= 0.004:
                triggered = True
        if not triggered:
            continue
        kind = f"rule_{rule.kind}"
        if await _recent_alert_exists(db, user_id, kind, rule.instrument.symbol):
            continue
        rule.last_triggered_at = datetime.now(timezone.utc)
        await create_alert(
            db,
            user_id=user_id,
            kind=kind,
            title=f"{rule.instrument.symbol}: hlídač {rule.kind}",
            body=f"Cena {price:.4f} u úrovně {level:.4f} ({rule.note or rule.kind}).",
            payload={
                "rule_id": rule.id,
                "symbol": rule.instrument.symbol,
                "price": price,
                "level_price": level,
                "kind": rule.kind,
            },
        )
        n += 1

    # 3) Portfolio avg_cost proximity (auto, deduped)
    positions = (
        await db.execute(
            select(PortfolioPosition)
            .where(PortfolioPosition.user_id == user_id)
            .options(selectinload(PortfolioPosition.instrument))
        )
    ).scalars().all()
    for p in positions:
        quote = await market_data.fetch_quote(p.instrument.symbol, p.instrument.asset_class)
        if quote.price is None:
            continue
        cost = float(p.avg_cost)
        if cost <= 0:
            continue
        dist = abs(quote.price - cost) / cost
        if dist <= 0.01:
            kind = "price_avg_cost"
            if await _recent_alert_exists(db, user_id, kind, p.instrument.symbol):
                continue
            await create_alert(
                db,
                user_id=user_id,
                kind=kind,
                title=f"{p.instrument.symbol}: u průměrné nákupní ceny",
                body=f"Cena {quote.price:.4f} je blízko Ø nákupu {cost:.4f} ({dist:.1%}).",
                payload={
                    "symbol": p.instrument.symbol,
                    "price": quote.price,
                    "level_price": cost,
                    "kind": "avg_cost",
                },
            )
            n += 1

    await db.commit()
    return n
