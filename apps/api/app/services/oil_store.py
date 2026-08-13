"""Persist WTI (CL=F) OHLCV into price_bars so timeframe switches are local DB reads."""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AssetClass, DataQuality, Instrument, PriceBar
from app.services.instruments import get_or_create_instrument
from app.services.market_data import OhlcvBar, aggregate_bars_hours, market_data

logger = logging.getLogger(__name__)

OIL_SYMBOL = "CL=F"

# Native Yahoo intervals we store. 4h is aggregated from 1h on read.
STORE_INTERVALS: dict[str, str] = {
    "1m": "7d",
    "5m": "1mo",
    "15m": "1mo",
    "30m": "1mo",
    "1h": "6mo",
    "1d": "5y",
    "1wk": "5y",
}

FRESH_AFTER: dict[str, timedelta] = {
    "1m": timedelta(minutes=2),
    "5m": timedelta(minutes=6),
    "15m": timedelta(minutes=16),
    "30m": timedelta(minutes=32),
    "1h": timedelta(minutes=70),
    "1d": timedelta(hours=18),
    "1wk": timedelta(days=3),
}

LOOKBACK_DELTA: dict[str, timedelta] = {
    "1d": timedelta(days=1),
    "5d": timedelta(days=5),
    "7d": timedelta(days=7),
    "1mo": timedelta(days=31),
    "3mo": timedelta(days=93),
    "6mo": timedelta(days=186),
    "1y": timedelta(days=366),
    "2y": timedelta(days=731),
    "5y": timedelta(days=365 * 5 + 2),
}

LIVE_LOOKBACK: dict[str, str] = {
    "1m": "1d",
    "5m": "5d",
    "15m": "5d",
    "30m": "5d",
    "1h": "5d",
    "1d": "5d",
    "1wk": "1y",
}

_last_live_sync: dict[str, datetime] = {}
_LIVE_MIN_GAP = timedelta(seconds=4)


def _aware(ts: datetime) -> datetime:
    if ts.tzinfo is None:
        return ts.replace(tzinfo=timezone.utc)
    return ts.astimezone(timezone.utc)


def store_interval(interval: str) -> str:
    return "1h" if interval == "4h" else interval


async def _instrument(db: AsyncSession) -> Instrument:
    return await get_or_create_instrument(
        db,
        symbol=OIL_SYMBOL,
        name="WTI Crude Oil",
        asset_class=AssetClass.commodity,
        exchange="NYMEX",
        currency="USD",
        is_discovery=True,
    )


async def _upsert_bars(
    db: AsyncSession, inst_id: int, interval: str, bars: list[OhlcvBar]
) -> None:
    if not bars:
        return
    now = datetime.now(timezone.utc)
    rows = [
        {
            "instrument_id": inst_id,
            "interval": interval,
            "ts": _aware(b.ts),
            "open": b.open,
            "high": b.high,
            "low": b.low,
            "close": b.close,
            "volume": b.volume,
            "source": b.source,
            "data_quality": b.data_quality,
            "as_of": now,
        }
        for b in bars
    ]
    for i in range(0, len(rows), 400):
        chunk = rows[i : i + 400]
        stmt = pg_insert(PriceBar).values(chunk)
        stmt = stmt.on_conflict_do_update(
            constraint="uq_price_bar",
            set_={
                "open": stmt.excluded.open,
                "high": stmt.excluded.high,
                "low": stmt.excluded.low,
                "close": stmt.excluded.close,
                "volume": stmt.excluded.volume,
                "source": stmt.excluded.source,
                "data_quality": stmt.excluded.data_quality,
                "as_of": stmt.excluded.as_of,
            },
        )
        await db.execute(stmt)
    await db.commit()


async def sync_oil_live(db: AsyncSession, interval: str) -> int:
    """Yahoo pull for the forming candle, throttled so the UI can poll every few seconds."""
    iv = store_interval(interval)
    now = datetime.now(timezone.utc)
    last = _last_live_sync.get(iv)
    if last and now - last < _LIVE_MIN_GAP:
        return 0
    n = await sync_oil_interval(db, iv, lookback=LIVE_LOOKBACK.get(iv, "1d"))
    _last_live_sync[iv] = now
    return n


async def get_oil_tail(db: AsyncSession, interval: str, n: int = 8) -> list[OhlcvBar]:
    """Last N candles for live updates (4h is aggregated from 1h)."""
    iv = store_interval(interval)
    inst = (
        await db.execute(select(Instrument).where(Instrument.symbol == OIL_SYMBOL))
    ).scalar_one_or_none()
    if not inst:
        return []
    take = n * 4 if interval == "4h" else n
    rows = (
        await db.execute(
            select(PriceBar)
            .where(PriceBar.instrument_id == inst.id, PriceBar.interval == iv)
            .order_by(PriceBar.ts.desc())
            .limit(take)
        )
    ).scalars().all()
    bars: list[OhlcvBar] = []
    for r in reversed(rows):
        bars.append(
            OhlcvBar(
                ts=_aware(r.ts),
                open=r.open,
                high=r.high,
                low=r.low,
                close=r.close,
                volume=r.volume,
                source=r.source or "db",
                data_quality=r.data_quality or DataQuality.medium,
            )
        )
    if interval == "4h" and bars:
        bars = aggregate_bars_hours(bars, 4)
    return bars[-n:]


async def sync_oil_interval(db: AsyncSession, interval: str, lookback: str | None = None) -> int:
    """Pull Yahoo for one native interval and upsert into price_bars."""
    iv = store_interval(interval)
    lb = lookback or STORE_INTERVALS.get(iv, "6mo")
    bars = await market_data.fetch_ohlcv(OIL_SYMBOL, AssetClass.commodity, interval=iv, lookback=lb)
    if not bars:
        logger.warning("oil sync empty %s %s", iv, lb)
        return 0
    inst = await _instrument(db)
    await _upsert_bars(db, inst.id, iv, bars)
    logger.info("oil sync %s %s → %s bars", iv, lb, len(bars))
    return len(bars)


async def sync_all_oil(db: AsyncSession, *, include_slow: bool = True) -> None:
    order = ["1m", "5m", "15m", "30m", "1h"]
    if include_slow:
        order.extend(["1d", "1wk"])
    for iv in order:
        try:
            await sync_oil_interval(db, iv)
        except Exception:
            logger.exception("oil sync failed for %s", iv)


async def _load_stored(
    db: AsyncSession, interval: str, since: datetime
) -> list[OhlcvBar]:
    inst = (
        await db.execute(select(Instrument).where(Instrument.symbol == OIL_SYMBOL))
    ).scalar_one_or_none()
    if not inst:
        return []
    rows = (
        await db.execute(
            select(PriceBar)
            .where(
                PriceBar.instrument_id == inst.id,
                PriceBar.interval == interval,
                PriceBar.ts >= since,
            )
            .order_by(PriceBar.ts.asc())
        )
    ).scalars().all()
    out: list[OhlcvBar] = []
    for r in rows:
        out.append(
            OhlcvBar(
                ts=_aware(r.ts),
                open=r.open,
                high=r.high,
                low=r.low,
                close=r.close,
                volume=r.volume,
                source=r.source or "db",
                data_quality=r.data_quality or DataQuality.medium,
            )
        )
    return out


def _is_fresh(bars: list[OhlcvBar], interval: str) -> bool:
    if not bars:
        return False
    max_age = FRESH_AFTER.get(interval, timedelta(minutes=5))
    last = _aware(bars[-1].ts)
    return datetime.now(timezone.utc) - last <= max_age


async def get_oil_bars(
    db: AsyncSession, *, interval: str, lookback: str, refresh_if_stale: bool = True
) -> list[OhlcvBar]:
    """Read CL=F from DB; Yahoo only when empty. Stale data is returned immediately."""
    iv = store_interval(interval)
    since = datetime.now(timezone.utc) - LOOKBACK_DELTA.get(lookback, timedelta(days=180))
    bars = await _load_stored(db, iv, since)

    if not bars:
        await sync_oil_interval(db, iv, lookback=STORE_INTERVALS.get(iv, lookback))
        bars = await _load_stored(db, iv, since)
    elif refresh_if_stale and not _is_fresh(bars, iv):
        # Don't block the chart — caller can schedule a background sync.
        pass

    if interval == "4h" and bars:
        bars = aggregate_bars_hours(bars, 4)
    return bars
