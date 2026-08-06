"""Realtime crypto OHLCV — aggregate Binance + Bybit public kline websockets."""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timezone
from statistics import median

logger = logging.getLogger(__name__)

SUPPORTED_INTERVALS = {
    "1s": "1s",
    "1m": "1m",
    "5m": "5m",
    "15m": "15m",
    "30m": "30m",
    "1h": "1h",
    "4h": "4h",
    "1d": "1d",
    "1wk": "1w",
}

# Keep old name for route imports
BINANCE_INTERVALS = SUPPORTED_INTERVALS

BYBIT_INTERVAL = {
    "1s": None,  # Bybit spot has no 1s kline — Binance-only for 1s
    "1m": "1",
    "5m": "5",
    "15m": "15",
    "30m": "30",
    "1h": "60",
    "4h": "240",
    "1d": "D",
    "1wk": "W",
}


def to_stream_symbol(symbol: str) -> str:
    s = symbol.upper().strip().replace("-", "/").replace("/", "")
    if not s.endswith("USDT") and not s.endswith("USD"):
        s = f"{s}USDT"
    return s.lower()


def binance_kline_url(symbol: str, interval: str) -> str:
    stream_sym = to_stream_symbol(symbol)
    tf = SUPPORTED_INTERVALS.get(interval, "1m")
    return f"wss://stream.binance.com:9443/ws/{stream_sym}@kline_{tf}"


def parse_binance_kline(payload: dict) -> dict | None:
    k = payload.get("k") if isinstance(payload, dict) else None
    if not isinstance(k, dict):
        return None
    try:
        ts_ms = int(k["t"])
        return {
            "exchange": "binance",
            "type": "kline",
            "symbol": str(k.get("s") or "").upper(),
            "interval": str(k.get("i") or ""),
            "ts": datetime.fromtimestamp(ts_ms / 1000, tz=timezone.utc).isoformat(),
            "ts_ms": ts_ms,
            "open": float(k["o"]),
            "high": float(k["h"]),
            "low": float(k["l"]),
            "close": float(k["c"]),
            "volume": float(k.get("v") or 0),
            "is_closed": bool(k.get("x")),
            "source": "binance:ws",
        }
    except (KeyError, TypeError, ValueError) as exc:
        logger.debug("bad binance kline: %s", exc)
        return None


def parse_bybit_kline(payload: dict, interval: str) -> dict | None:
    if not isinstance(payload, dict):
        return None
    data = payload.get("data")
    if not data:
        return None
    row = data[0] if isinstance(data, list) else data
    if not isinstance(row, dict):
        return None
    try:
        ts_ms = int(row.get("start") or row.get("timestamp") or 0)
        if not ts_ms:
            return None
        return {
            "exchange": "bybit",
            "type": "kline",
            "symbol": str(payload.get("topic", "")).split(".")[-1].upper(),
            "interval": interval,
            "ts": datetime.fromtimestamp(ts_ms / 1000, tz=timezone.utc).isoformat(),
            "ts_ms": ts_ms,
            "open": float(row["open"]),
            "high": float(row["high"]),
            "low": float(row["low"]),
            "close": float(row["close"]),
            "volume": float(row.get("volume") or 0),
            "is_closed": bool(row.get("confirm")),
            "source": "bybit:ws",
        }
    except (KeyError, TypeError, ValueError) as exc:
        logger.debug("bad bybit kline: %s", exc)
        return None


def _aggregate_live(parts: dict[str, dict]) -> dict | None:
    if not parts:
        return None
    rows = list(parts.values())
    # Prefer matching the newest shared bucket; if only one venue, use it.
    ts_ms = max(r["ts_ms"] for r in rows)
    same = [r for r in rows if r["ts_ms"] == ts_ms]
    if not same:
        same = rows
    opens = [r["open"] for r in same]
    highs = [r["high"] for r in same]
    lows = [r["low"] for r in same]
    closes = [r["close"] for r in same]
    vols = [r["volume"] for r in same]
    venues = "+".join(sorted(r["exchange"] for r in same))
    return {
        "type": "kline",
        "symbol": same[0].get("symbol"),
        "interval": same[0].get("interval"),
        "ts": same[0]["ts"],
        "open": float(median(opens)),
        "high": max(highs),
        "low": min(lows),
        "close": float(median(closes)),
        "volume": float(sum(vols)),
        "is_closed": all(bool(r.get("is_closed")) for r in same),
        "source": f"agg:{venues}:ws",
        "venues": [r["exchange"] for r in same],
    }


async def _binance_reader(symbol: str, interval: str, queue: asyncio.Queue) -> None:
    import websockets

    url = binance_kline_url(symbol, interval)
    logger.info("crypto ws binance → %s", url)
    async with websockets.connect(url, ping_interval=20, ping_timeout=20, max_queue=64) as ws:
        async for raw in ws:
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                continue
            bar = parse_binance_kline(data)
            if bar:
                await queue.put(bar)


async def _bybit_reader(symbol: str, interval: str, queue: asyncio.Queue) -> None:
    import websockets

    bybit_iv = BYBIT_INTERVAL.get(interval)
    if not bybit_iv:
        return  # e.g. 1s — skip
    stream_sym = to_stream_symbol(symbol).upper()
    url = "wss://stream.bybit.com/v5/public/spot"
    topic = f"kline.{bybit_iv}.{stream_sym}"
    logger.info("crypto ws bybit → %s (%s)", url, topic)
    async with websockets.connect(url, ping_interval=20, ping_timeout=20, max_queue=64) as ws:
        await ws.send(json.dumps({"op": "subscribe", "args": [topic]}))
        async for raw in ws:
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                continue
            if data.get("op") == "subscribe" or data.get("success") is True and "topic" not in data:
                continue
            bar = parse_bybit_kline(data, interval)
            if bar:
                await queue.put(bar)


async def iter_aggregated_klines(symbol: str, interval: str):
    """Yield aggregated kline updates from Binance + Bybit."""
    queue: asyncio.Queue = asyncio.Queue(maxsize=256)
    latest: dict[str, dict] = {}
    tasks = [
        asyncio.create_task(_binance_reader(symbol, interval, queue), name="binance-kline"),
    ]
    if BYBIT_INTERVAL.get(interval):
        tasks.append(asyncio.create_task(_bybit_reader(symbol, interval, queue), name="bybit-kline"))

    try:
        while True:
            # If all readers die, surface error
            if all(t.done() for t in tasks):
                errs = [t.exception() for t in tasks if t.done() and t.exception()]
                raise RuntimeError(str(errs[0]) if errs else "kline readers stopped")

            try:
                bar = await asyncio.wait_for(queue.get(), timeout=30)
            except asyncio.TimeoutError:
                # keep-alive tick so client knows link is up
                if latest:
                    agg = _aggregate_live(latest)
                    if agg:
                        agg["type"] = "heartbeat"
                        yield agg
                continue

            latest[bar["exchange"]] = bar
            agg = _aggregate_live(latest)
            if agg:
                yield agg
    finally:
        for t in tasks:
            t.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)


# Back-compat alias used by older route code
async def iter_binance_klines(symbol: str, interval: str):
    async for bar in iter_aggregated_klines(symbol, interval):
        yield bar
