"""1s OHLCV from Bybit public ticks — archive backfill + aggregate to chart TFs."""

from __future__ import annotations

import logging
import zlib
from datetime import date, datetime, timedelta, timezone

import httpx
from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.core.database import AsyncSessionLocal
from app.models import DataQuality, PriceBar
from app.services.instruments import get_or_create_instrument
from app.services.market_data import OhlcvBar
from app.services.oil_bybit import LinearDesk, _HEADERS

logger = logging.getLogger(__name__)

SEC_INTERVAL = "1s"
KEEP_SEC_DAYS = 7
ARCHIVE_DAYS = 7
SEC_MEM_MS = 7_200_000
ARCHIVE_GAP_MS = 180_000
_ARCHIVE_BASE = "https://public.bybit.com/trading"

CHART_INTERVAL_MS: dict[str, int] = {
    "1s": 1_000,
    "1m": 60_000,
    "5m": 300_000,
    "15m": 900_000,
    "30m": 1_800_000,
    "1h": 3_600_000,
    "4h": 14_400_000,
    "1d": 86_400_000,
    "1wk": 604_800_000,
}

MAX_OUT: dict[str, int] = {
    "1s": 14_400,
    "1m": 2500,
    "5m": 900,
    "15m": 700,
    "30m": 600,
    "1h": 480,
    "4h": 360,
    "1d": 240,
    "1wk": 140,
}


def aware(ts: datetime) -> datetime:
    if ts.tzinfo is None:
        return ts.replace(tzinfo=timezone.utc)
    return ts.astimezone(timezone.utc)


def ts_ms(ts: datetime) -> int:
    return int(aware(ts).timestamp() * 1000)


def parse_archive_ts_ms(raw: str) -> int:
    v = float(raw)
    if v > 1e14:
        return int(v / 1_000_000)
    if v > 1e12:
        return int(v)
    return int(v * 1000)


def archive_url(symbol: str, day: date) -> str:
    name = f"{symbol}{day.isoformat()}.csv.gz"
    return f"{_ARCHIVE_BASE}/{symbol}/{name}"


def coverage_ranges(sec_keys: list[int], max_gap_ms: int = ARCHIVE_GAP_MS) -> list[tuple[int, int]]:
    if not sec_keys:
        return []
    keys = sorted(sec_keys)
    out: list[tuple[int, int]] = []
    start = prev = keys[0]
    for ts in keys[1:]:
        if ts - prev > max_gap_ms:
            out.append((start, prev))
            start = ts
        prev = ts
    out.append((start, prev))
    return out


def tick_bucket_complete(
    bucket: int,
    width: int,
    now_ms: int,
    ranges: list[tuple[int, int]],
) -> bool:
    end = bucket + width
    forming = end > now_ms
    for a, b in ranges:
        if forming:
            if a <= end and b >= bucket:
                return True
        elif a <= bucket and b >= end - 1000:
            return True
    return False


def aggregate_sec(
    sec: dict[int, list[float]],
    width: int,
) -> dict[int, list[float]]:
    if width <= 1000:
        return {ts: list(v) for ts, v in sec.items()}
    out: dict[int, list[float]] = {}
    for ts in sorted(sec):
        bucket = (ts // width) * width
        ohlcv = sec[ts]
        cur = out.get(bucket)
        if cur is None:
            out[bucket] = list(ohlcv)
        else:
            cur[1] = max(cur[1], ohlcv[1])
            cur[2] = min(cur[2], ohlcv[2])
            cur[3] = ohlcv[3]
            cur[4] += ohlcv[4]
    return out


def to_ohlcv_bars(
    agg: dict[int, list[float]],
    source: str,
    *,
    max_out: int = 0,
) -> list[OhlcvBar]:
    keys = sorted(agg)
    if max_out > 0:
        keys = keys[-max_out:]
    bars: list[OhlcvBar] = []
    for ts in keys:
        o, h, l, c, v = agg[ts]
        bars.append(
            OhlcvBar(
                ts=datetime.fromtimestamp(ts / 1000, tz=timezone.utc),
                open=o,
                high=h,
                low=l,
                close=c,
                volume=v,
                source=source,
                data_quality=DataQuality.high,
            )
        )
    return bars


def merge_klines_and_ticks(
    klines: list[OhlcvBar],
    ticks: list[OhlcvBar],
    sec_keys: list[int],
    width: int,
) -> list[OhlcvBar]:
    """Prefer tick-built bars where 1s coverage spans the bucket; fill holes with klines."""
    if not ticks:
        return klines
    if not klines:
        return ticks
    now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
    ranges = coverage_ranges(sec_keys)
    tick_map = {ts_ms(b.ts): b for b in ticks}
    kline_map = {ts_ms(b.ts): b for b in klines}
    keys = sorted(set(tick_map) | set(kline_map))
    out: list[OhlcvBar] = []
    for ts in keys:
        tick = tick_map.get(ts)
        kline = kline_map.get(ts)
        if tick and tick_bucket_complete(ts, width, now_ms, ranges):
            out.append(tick)
        elif kline:
            out.append(kline)
        elif tick:
            out.append(tick)
    return out


async def _instrument(db, desk: LinearDesk):
    return await get_or_create_instrument(
        db,
        symbol=desk.symbol,
        name=desk.name,
        asset_class=desk.asset_class,
        exchange="BYBIT",
        currency="USDT",
    )


async def persist_sec_bars(
    desk: LinearDesk,
    bars: dict[int, list[float]],
    *,
    overwrite: bool = True,
) -> int:
    if not bars:
        return 0
    now = datetime.now(timezone.utc)
    source = f"{desk.source}:ticks"
    async with AsyncSessionLocal() as db:
        inst = await _instrument(db, desk)
        rows = [
            {
                "instrument_id": inst.id,
                "interval": SEC_INTERVAL,
                "ts": datetime.fromtimestamp(ts / 1000, tz=timezone.utc),
                "open": ohlcv[0],
                "high": ohlcv[1],
                "low": ohlcv[2],
                "close": ohlcv[3],
                "volume": ohlcv[4],
                "source": source,
                "data_quality": DataQuality.high,
                "as_of": now,
            }
            for ts, ohlcv in bars.items()
        ]
        for i in range(0, len(rows), 400):
            chunk = rows[i : i + 400]
            stmt = pg_insert(PriceBar).values(chunk)
            if overwrite:
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
            else:
                stmt = stmt.on_conflict_do_nothing(constraint="uq_price_bar")
            await db.execute(stmt)
        await db.commit()
    return len(rows)


async def prune_sec_bars(desk: LinearDesk) -> None:
    cutoff = datetime.now(timezone.utc) - timedelta(days=KEEP_SEC_DAYS)
    async with AsyncSessionLocal() as db:
        inst = await _instrument(db, desk)
        await db.execute(
            delete(PriceBar).where(
                PriceBar.instrument_id == inst.id,
                PriceBar.interval == SEC_INTERVAL,
                PriceBar.ts < cutoff,
            )
        )
        await db.commit()


async def load_sec_map(desk: LinearDesk, since: datetime) -> dict[int, list[float]]:
    out: dict[int, list[float]] = {}
    async with AsyncSessionLocal() as db:
        inst = await _instrument(db, desk)
        result = await db.execute(
            select(PriceBar)
            .where(
                PriceBar.instrument_id == inst.id,
                PriceBar.interval == SEC_INTERVAL,
                PriceBar.ts >= since,
            )
            .order_by(PriceBar.ts.asc())
        )
        rows = result.scalars().all()
    for row in rows:
        out[ts_ms(row.ts)] = [row.open, row.high, row.low, row.close, row.volume]
    return out


async def count_sec_day(desk: LinearDesk, day: date) -> int:
    start = datetime(day.year, day.month, day.day, tzinfo=timezone.utc)
    end = start + timedelta(days=1)
    async with AsyncSessionLocal() as db:
        inst = await _instrument(db, desk)
        n = await db.scalar(
            select(func.count(PriceBar.id)).where(
                PriceBar.instrument_id == inst.id,
                PriceBar.interval == SEC_INTERVAL,
                PriceBar.ts >= start,
                PriceBar.ts < end,
            )
        )
    return int(n or 0)


async def _ingest_archive_day(desk: LinearDesk, day: date) -> int:
    url = archive_url(desk.symbol, day)
    dec = zlib.decompressobj(16 + zlib.MAX_WBITS)
    buf = b""
    header: list[str] | None = None
    idx_ts = idx_px = idx_sz = -1
    sec: dict[int, list[float]] = {}
    timeout = httpx.Timeout(30.0, read=180.0)
    async with httpx.AsyncClient(timeout=timeout, headers=_HEADERS, follow_redirects=True) as client:
        async with client.stream("GET", url) as resp:
            if resp.status_code == 404:
                logger.info("%s tick archive missing %s", desk.symbol, day.isoformat())
                return 0
            resp.raise_for_status()

            def _consume(blob: bytes) -> None:
                nonlocal buf, header, idx_ts, idx_px, idx_sz
                buf += blob
                while True:
                    nl = buf.find(b"\n")
                    if nl < 0:
                        break
                    line, buf = buf[:nl], buf[nl + 1 :]
                    if not line:
                        continue
                    text = line.decode("utf-8", errors="replace").strip()
                    if not text:
                        continue
                    if header is None:
                        header = text.split(",")
                        try:
                            idx_ts = header.index("timestamp")
                            idx_px = header.index("price")
                            idx_sz = header.index("size")
                        except ValueError as exc:
                            raise RuntimeError(f"unexpected archive header: {header}") from exc
                        continue
                    parts = text.split(",")
                    if len(parts) <= max(idx_ts, idx_px, idx_sz):
                        continue
                    try:
                        ms = parse_archive_ts_ms(parts[idx_ts])
                        price = float(parts[idx_px])
                        size = float(parts[idx_sz])
                    except (TypeError, ValueError):
                        continue
                    if ms <= 0 or price <= 0 or size <= 0:
                        continue
                    bucket = (ms // 1000) * 1000
                    cur = sec.get(bucket)
                    if cur is None:
                        sec[bucket] = [price, price, price, price, size]
                    else:
                        cur[1] = max(cur[1], price)
                        cur[2] = min(cur[2], price)
                        cur[3] = price
                        cur[4] += size

            async for chunk in resp.aiter_bytes():
                _consume(dec.decompress(chunk))
            _consume(dec.flush())
            if buf.strip():
                _consume(b"\n")
    n = await persist_sec_bars(desk, sec, overwrite=False)
    logger.info("%s tick archive %s → %s 1s bars", desk.symbol, day.isoformat(), n)
    return n


async def backfill_archive_1s(desk: LinearDesk, days: int = ARCHIVE_DAYS) -> int:
    """Download completed UTC days from public.bybit.com and compress to 1s bars."""
    today = datetime.now(timezone.utc).date()
    total = 0
    for i in range(1, max(1, days) + 1):
        day = today - timedelta(days=i)
        try:
            existing = await count_sec_day(desk, day)
            if existing >= 3_000:
                logger.debug("%s skip archive %s (%s 1s bars)", desk.symbol, day.isoformat(), existing)
                continue
            total += await _ingest_archive_day(desk, day)
        except Exception:
            logger.exception("%s tick archive failed %s", desk.symbol, day.isoformat())
    try:
        await prune_sec_bars(desk)
    except Exception:
        logger.exception("%s tick prune failed", desk.symbol)
    return total
