"""Bybit public-trade footprint — 1m bars persisted per linear symbol."""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.core.database import AsyncSessionLocal
from app.models import AssetClass, FootprintBar, Instrument
from app.services.instruments import get_or_create_instrument
from app.services.market_data import clamp_lookback, normalize_interval
from app.services.oil_bybit import BTC_DESK, OIL_DESK, LinearDesk, _WS_URL, fetch_linear_trades
from app.services.oil_store import LOOKBACK_DELTA

logger = logging.getLogger(__name__)

NATIVE = "1m"
KEEP_DAYS = 30
MEM_BARS = 480
FLUSH_SEC = 5.0
PRUNE_EVERY = timedelta(minutes=30)

INTERVAL_MS: dict[str, int] = {
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
    "1m": 2500,
    "5m": 900,
    "15m": 700,
    "30m": 600,
    "1h": 480,
    "4h": 360,
    "1d": 240,
    "1wk": 140,
}


class FootprintEngine:
    def __init__(
        self,
        desk: LinearDesk,
        *,
        display: str,
        name: str,
        asset_class: AssetClass,
    ) -> None:
        self.desk = desk
        self.display = display
        self.name = name
        self.asset_class = asset_class
        self._levels: dict[int, dict[float, list[float]]] = {}
        self._ohlc: dict[int, list[float]] = {}
        self._dirty: set[int] = set()
        self._lock = asyncio.Lock()
        self._seen: set[str] = set()
        self._seen_cap = 8_000
        self._last_prune: datetime | None = None

    def _tick(self, price: float) -> float:
        t = self.desk.tick
        return round(round(price / t) * t, self.desk.tick_decimals)

    def _ingest_unlocked(self, ts_ms: int, price: float, size: float, side: str, trade_id: str = "") -> None:
        if trade_id:
            if trade_id in self._seen:
                return
            self._seen.add(trade_id)
            if len(self._seen) > self._seen_cap:
                self._seen.clear()
        if ts_ms <= 0 or price <= 0 or size <= 0:
            return
        p = self._tick(price)
        buy = size if side == "buy" else 0.0
        sell = size if side != "buy" else 0.0
        width = INTERVAL_MS[NATIVE]
        bar_ts = (ts_ms // width) * width
        levels = self._levels.setdefault(bar_ts, {})
        cur = levels.get(p)
        if cur is None:
            levels[p] = [buy, sell]
        else:
            cur[0] += buy
            cur[1] += sell
        ohlc = self._ohlc.get(bar_ts)
        if ohlc is None:
            self._ohlc[bar_ts] = [p, p, p, p]
        else:
            ohlc[1] = max(ohlc[1], p)
            ohlc[2] = min(ohlc[2], p)
            ohlc[3] = p
        self._dirty.add(bar_ts)

    def _trim_memory(self) -> None:
        keys = sorted(self._levels)
        drop = keys[:-MEM_BARS] if len(keys) > MEM_BARS else []
        for k in drop:
            if k in self._dirty:
                continue
            self._levels.pop(k, None)
            self._ohlc.pop(k, None)

    def _pack_bar(self, ts_ms: int, levels: dict[float, list[float]], ohlc: list[float]) -> dict:
        rows: list[dict] = []
        poc = None
        poc_vol = -1.0
        buy_tot = 0.0
        sell_tot = 0.0
        for price in sorted(levels):
            b, s = levels[price]
            buy_tot += b
            sell_tot += s
            vol = b + s
            if vol > poc_vol:
                poc_vol = vol
                poc = price
            rows.append({"price": float(price), "buy": round(b, 4), "sell": round(s, 4)})
        return {
            "ts": datetime.fromtimestamp(ts_ms / 1000, tz=timezone.utc).isoformat(),
            "open": ohlc[0],
            "high": ohlc[1],
            "low": ohlc[2],
            "close": ohlc[3],
            "volume": round(buy_tot + sell_tot, 4),
            "delta": round(buy_tot - sell_tot, 4),
            "poc": poc,
            "levels": rows,
        }

    @staticmethod
    def _aggregate(
        store: dict[int, dict[float, list[float]]],
        meta: dict[int, list[float]],
        width: int,
    ) -> tuple[dict[int, dict[float, list[float]]], dict[int, list[float]]]:
        out_store: dict[int, dict[float, list[float]]] = {}
        out_meta: dict[int, list[float]] = {}
        for ts_ms in sorted(store):
            bar_ts = (ts_ms // width) * width
            levels = out_store.setdefault(bar_ts, {})
            for p, pair in store[ts_ms].items():
                cur = levels.get(p)
                if cur is None:
                    levels[p] = [pair[0], pair[1]]
                else:
                    cur[0] += pair[0]
                    cur[1] += pair[1]
            o = meta[ts_ms]
            existing = out_meta.get(bar_ts)
            if existing is None:
                out_meta[bar_ts] = list(o)
            else:
                existing[1] = max(existing[1], o[1])
                existing[2] = min(existing[2], o[2])
                existing[3] = o[3]
        return out_store, out_meta

    async def _instrument(self, db) -> Instrument:
        return await get_or_create_instrument(
            db,
            symbol=self.desk.symbol,
            name=self.name,
            asset_class=self.asset_class,
            exchange="BYBIT",
            currency="USDT",
        )

    async def persist_dirty(self) -> int:
        async with self._lock:
            dirty = sorted(self._dirty)
            payload: list[tuple[int, dict[float, list[float]], list[float]]] = []
            for ts in dirty:
                lvls = self._levels.get(ts)
                ohlc = self._ohlc.get(ts)
                if not lvls or not ohlc:
                    continue
                payload.append((ts, {p: [b, s] for p, (b, s) in lvls.items()}, list(ohlc)))
            self._dirty.difference_update(dirty)
        if not payload:
            return 0
        now = datetime.now(timezone.utc)
        try:
            async with AsyncSessionLocal() as db:
                inst = await self._instrument(db)
                rows = []
                for ts_ms, lvls, ohlc in payload:
                    packed = self._pack_bar(ts_ms, lvls, ohlc)
                    rows.append(
                        {
                            "instrument_id": inst.id,
                            "interval": NATIVE,
                            "ts": datetime.fromtimestamp(ts_ms / 1000, tz=timezone.utc),
                            "open": packed["open"],
                            "high": packed["high"],
                            "low": packed["low"],
                            "close": packed["close"],
                            "volume": packed["volume"],
                            "delta": packed["delta"],
                            "poc": packed["poc"],
                            "levels": packed["levels"],
                            "as_of": now,
                        }
                    )
                for i in range(0, len(rows), 200):
                    chunk = rows[i : i + 200]
                    stmt = pg_insert(FootprintBar).values(chunk)
                    stmt = stmt.on_conflict_do_update(
                        constraint="uq_footprint_bar",
                        set_={
                            "open": stmt.excluded.open,
                            "high": stmt.excluded.high,
                            "low": stmt.excluded.low,
                            "close": stmt.excluded.close,
                            "volume": stmt.excluded.volume,
                            "delta": stmt.excluded.delta,
                            "poc": stmt.excluded.poc,
                            "levels": stmt.excluded.levels,
                            "as_of": stmt.excluded.as_of,
                        },
                    )
                    await db.execute(stmt)
                if self._last_prune is None or now - self._last_prune >= PRUNE_EVERY:
                    cutoff = now - timedelta(days=KEEP_DAYS)
                    await db.execute(
                        delete(FootprintBar).where(
                            FootprintBar.instrument_id == inst.id,
                            FootprintBar.ts < cutoff,
                        )
                    )
                    self._last_prune = now
                await db.commit()
        except Exception:
            async with self._lock:
                self._dirty.update(ts for ts, _, _ in payload)
            raise
        async with self._lock:
            self._trim_memory()
        return len(payload)

    async def _load_db(
        self, since: datetime, until: datetime
    ) -> tuple[dict[int, dict[float, list[float]]], dict[int, list[float]]]:
        store: dict[int, dict[float, list[float]]] = {}
        meta: dict[int, list[float]] = {}
        async with AsyncSessionLocal() as db:
            inst = await self._instrument(db)
            result = await db.execute(
                select(FootprintBar)
                .where(
                    FootprintBar.instrument_id == inst.id,
                    FootprintBar.interval == NATIVE,
                    FootprintBar.ts >= since,
                    FootprintBar.ts <= until,
                )
                .order_by(FootprintBar.ts)
            )
            rows = result.scalars().all()
        for row in rows:
            ts = row.ts
            if ts.tzinfo is None:
                ts = ts.replace(tzinfo=timezone.utc)
            ts_ms = int(ts.timestamp() * 1000)
            levels: dict[float, list[float]] = {}
            for item in row.levels or []:
                if not isinstance(item, dict):
                    continue
                try:
                    p = float(item["price"])
                    b = float(item.get("buy") or 0)
                    s = float(item.get("sell") or 0)
                except (TypeError, ValueError, KeyError):
                    continue
                levels[p] = [b, s]
            if not levels:
                continue
            store[ts_ms] = levels
            meta[ts_ms] = [row.open, row.high, row.low, row.close]
        return store, meta

    async def snapshot(self, interval: str, lookback: str = "1d") -> dict:
        iv = normalize_interval(interval)
        if iv not in INTERVAL_MS:
            iv = NATIVE
        lb = clamp_lookback(iv, lookback)
        now = datetime.now(timezone.utc)
        delta = LOOKBACK_DELTA.get(lb, timedelta(days=1))
        max_out = MAX_OUT.get(iv, 600)
        width = INTERVAL_MS[iv]
        max_1m = min(max_out * max(1, width // INTERVAL_MS[NATIVE]), 10_080)
        since = max(now - delta, now - timedelta(milliseconds=max_1m * INTERVAL_MS[NATIVE]))
        store, meta = await self._load_db(since, now)
        since_ms = int(since.timestamp() * 1000)
        async with self._lock:
            for ts, lvls in self._levels.items():
                if ts < since_ms:
                    continue
                store[ts] = {p: [b, s] for p, (b, s) in lvls.items()}
                ohlc = self._ohlc.get(ts)
                if ohlc:
                    meta[ts] = list(ohlc)
        if iv != NATIVE:
            store, meta = self._aggregate(store, meta, width)
        keys = sorted(store)
        if max_out > 0:
            keys = keys[-max_out:]
        bars = [self._pack_bar(ts, store[ts], meta.get(ts) or [0, 0, 0, 0]) for ts in keys if store[ts]]
        last = bars[-1] if bars else None
        return {
            "symbol": self.display,
            "source": f"{self.desk.source}:trades",
            "interval": iv,
            "lookback": lb,
            "tick": self.desk.tick,
            "bars_count": len(bars),
            "as_of": last["ts"] if last else now.isoformat(),
            "note": "Footprint z Bybit public tradů. 1m bary se ukládají do databáze (až 30 dní).",
            "bars": bars,
        }

    async def _backfill(self) -> None:
        try:
            payload = await fetch_linear_trades(self.desk, limit=1000)
        except Exception:
            logger.exception("%s footprint backfill failed", self.desk.symbol)
            return
        rows = list(reversed(payload.get("trades") or []))
        async with self._lock:
            for t in rows:
                self._ingest_unlocked(
                    int(t.get("ts_ms") or 0),
                    float(t.get("price") or 0),
                    float(t.get("amount") or 0),
                    str(t.get("side") or "sell"),
                    str(t.get("id") or ""),
                )
        logger.info("%s footprint backfill %s trades", self.desk.symbol, len(rows))
        try:
            n = await self.persist_dirty()
            if n:
                logger.info("%s footprint flushed %s bars after backfill", self.desk.symbol, n)
        except Exception:
            logger.exception("%s footprint backfill persist failed", self.desk.symbol)

    async def _flush_loop(self, stop: asyncio.Event) -> None:
        while not stop.is_set():
            try:
                n = await self.persist_dirty()
                if n:
                    logger.debug("%s footprint flushed %s bars", self.desk.symbol, n)
            except Exception:
                logger.exception("%s footprint persist failed", self.desk.symbol)
            try:
                await asyncio.wait_for(stop.wait(), timeout=FLUSH_SEC)
            except TimeoutError:
                pass

    async def _ws_loop(self, stop: asyncio.Event) -> None:
        import websockets

        topic = f"publicTrade.{self.desk.symbol}"
        while not stop.is_set():
            try:
                logger.info("%s footprint ws → %s (%s)", self.desk.symbol, _WS_URL, topic)
                async with websockets.connect(
                    _WS_URL, ping_interval=20, ping_timeout=20, max_queue=256
                ) as ws:
                    await ws.send(json.dumps({"op": "subscribe", "args": [topic]}))
                    async for raw in ws:
                        if stop.is_set():
                            return
                        try:
                            data = json.loads(raw)
                        except json.JSONDecodeError:
                            continue
                        if data.get("op") == "subscribe" or (
                            data.get("success") is True and "topic" not in data
                        ):
                            continue
                        rows = data.get("data") or []
                        if not isinstance(rows, list):
                            continue
                        async with self._lock:
                            for row in rows:
                                if not isinstance(row, dict):
                                    continue
                                try:
                                    ts_ms = int(row.get("T") or 0)
                                    price = float(row.get("p") or 0)
                                    size = float(row.get("v") or 0)
                                except (TypeError, ValueError):
                                    continue
                                side = str(row.get("S") or "").lower()
                                tid = str(row.get("i") or "")
                                self._ingest_unlocked(ts_ms, price, size, side, tid)
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("%s footprint ws dropped", self.desk.symbol)
                try:
                    await asyncio.wait_for(stop.wait(), timeout=1.5)
                except TimeoutError:
                    pass

    async def run(self, stop: asyncio.Event) -> None:
        await asyncio.sleep(1.5)
        await self._backfill()
        flusher = asyncio.create_task(self._flush_loop(stop))
        try:
            await self._ws_loop(stop)
        finally:
            flusher.cancel()
            try:
                await flusher
            except asyncio.CancelledError:
                pass
            try:
                await self.persist_dirty()
            except Exception:
                logger.exception("%s footprint final flush failed", self.desk.symbol)


OIL_FP = FootprintEngine(
    OIL_DESK,
    display="WTI",
    name="WTI Crude (Bybit CLUSDT)",
    asset_class=AssetClass.commodity,
)
BTC_FP = FootprintEngine(
    BTC_DESK,
    display="BTC",
    name="Bitcoin (Bybit BTCUSDT)",
    asset_class=AssetClass.crypto,
)


async def snapshot_footprint(interval: str, lookback: str = "1d") -> dict:
    return await OIL_FP.snapshot(interval, lookback)


async def snapshot_btc_footprint(interval: str, lookback: str = "1d") -> dict:
    return await BTC_FP.snapshot(interval, lookback)


async def run_oil_footprint(stop: asyncio.Event) -> None:
    """Backfill + stream for WTI and BTC footprints."""
    await asyncio.gather(OIL_FP.run(stop), BTC_FP.run(stop))
