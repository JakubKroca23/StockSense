from __future__ import annotations

import logging
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models import (
    Alert,
    MacroSnapshot,
    PortfolioPosition,
    PortfolioSnapshot,
    PriceAlertRule,
    PriceBar,
)
from app.services.alerts import create_alert
from app.services.fundament_macro import fetch_fred_latest
from app.services.market_data import market_data

logger = logging.getLogger(__name__)


async def sync_prices_for_instruments(db: AsyncSession, instruments: list) -> int:
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

    await db.commit()
    return n
