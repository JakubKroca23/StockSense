from __future__ import annotations

import logging
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models import (
    Instrument,
    MacroSnapshot,
    PortfolioPosition,
    PriceBar,
    Report,
    RiskProfile,
    Tip,
    UserSettings,
    Watchlist,
)
from app.services.alerts import create_alert
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
            result = score_instrument(bars, quote, inst.asset_class, risk, max_pct, macro_bias)
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

    tip_lines = [
        f"- **{t.instrument.symbol}**: {t.action.value} | score {t.score} | conf {t.confidence} | {t.horizon.value}"
        for t in tips[:15]
    ]
    pos_lines = [
        f"- **{p.instrument.symbol}**: qty {p.quantity} @ {p.avg_cost}" + (" (paper)" if p.is_paper else "")
        for p in positions
    ]
    context = (
        "TOP TIPY:\n"
        + ("\n".join(tip_lines) or "- žádné")
        + "\n\nPORTFOLIO:\n"
        + ("\n".join(pos_lines) or "- prázdné")
    )
    narrative = await llm_complete(
        "Napiš denní briefing v češtině (markdown): shrnutí trhu z tipů, co sledovat, rizika. Max 400 slov.",
        task=LLMTask.heavy,
        context=context,
    )
    title = f"Denní report {datetime.now(timezone.utc).strftime('%Y-%m-%d')}"
    report = Report(
        user_id=user_id,
        kind="daily",
        title=title,
        content_md=narrative,
        meta={"tip_count": len(tips), "position_count": len(positions)},
    )
    db.add(report)
    await create_alert(
        db,
        user_id=user_id,
        kind="daily_report",
        title=title,
        body="Denní report je připravený.",
        payload={},
    )
    await db.commit()
    await db.refresh(report)
    return report


async def check_price_alerts(db: AsyncSession, user_id: str) -> int:
    tips = (
        await db.execute(
            select(Tip)
            .where(Tip.user_id == user_id, Tip.is_active.is_(True))
            .options(selectinload(Tip.instrument))
        )
    ).scalars().all()
    n = 0
    for tip in tips:
        quote = await market_data.fetch_quote(tip.instrument.symbol, tip.instrument.asset_class)
        if quote.price is None:
            continue
        price = quote.price
        hit = None
        if tip.stop and (
            (tip.action.value in ("buy", "trade", "hold") and price <= tip.stop)
            or (tip.action.value == "sell" and price >= tip.stop)
        ):
            hit = "stop"
        elif tip.target_1 and (
            (tip.action.value in ("buy", "trade") and price >= tip.target_1)
            or (tip.action.value == "sell" and price <= tip.target_1)
        ):
            hit = "target_1"
        elif tip.entry_low and tip.entry_high and tip.entry_low <= price <= tip.entry_high:
            hit = "entry"
        if hit:
            await create_alert(
                db,
                user_id=user_id,
                kind=f"price_{hit}",
                title=f"{tip.instrument.symbol}: zásah {hit}",
                body=f"Cena {price} zasáhla úroveň {hit} u tipu #{tip.id}.",
                payload={"tip_id": tip.id, "price": price, "level": hit},
            )
            n += 1
    await db.commit()
    return n
