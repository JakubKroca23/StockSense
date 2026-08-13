"""Live WTI via Bybit linear perp CLUSDT — same class of feed as an XTB CFD, not delayed NYMEX."""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone

import httpx

from app.models import DataQuality
from app.services.crypto_stream import BYBIT_INTERVAL, parse_bybit_kline
from app.services.market_data import OhlcvBar, normalize_interval
from app.services.oil_store import LOOKBACK_DELTA

logger = logging.getLogger(__name__)

OIL_BYBIT_SYMBOL = "CLUSDT"
_KLINE_URL = "https://api.bybit.com/v5/market/kline"
_BOOK_URL = "https://api.bybit.com/v5/market/orderbook"
_TRADES_URL = "https://api.bybit.com/v5/market/recent-trade"
_WS_URL = "wss://stream.bybit.com/v5/public/linear"
_HEADERS = {"User-Agent": "Mozilla/5.0 StockSense/1.0"}
_TICK = 0.01


def _bybit_interval(interval: str) -> str:
    iv = normalize_interval(interval)
    return BYBIT_INTERVAL.get(iv) or "1"


def _parse_kline_row(row: list) -> OhlcvBar | None:
    if not row or len(row) < 6:
        return None
    try:
        ts_ms = int(row[0])
        close = float(row[4])
        return OhlcvBar(
            ts=datetime.fromtimestamp(ts_ms / 1000, tz=timezone.utc),
            open=float(row[1]),
            high=float(row[2]),
            low=float(row[3]),
            close=close,
            volume=float(row[5] or 0),
            source="bybit:CLUSDT",
            data_quality=DataQuality.high,
        )
    except (TypeError, ValueError, IndexError):
        return None


async def fetch_clusdt_klines(
    interval: str,
    lookback: str = "1d",
    *,
    max_bars: int = 12_000,
) -> list[OhlcvBar]:
    """Paginated Bybit linear klines, oldest → newest, including the forming candle."""
    iv = _bybit_interval(interval)
    delta = LOOKBACK_DELTA.get(lookback)
    since_ms = 0
    if delta is not None:
        since_ms = int((datetime.now(timezone.utc) - delta).timestamp() * 1000)

    out: list[OhlcvBar] = []
    end: int | None = None
    async with httpx.AsyncClient(timeout=20.0, headers=_HEADERS) as client:
        for _ in range(16):
            params: dict[str, str | int] = {
                "category": "linear",
                "symbol": OIL_BYBIT_SYMBOL,
                "interval": iv,
                "limit": 1000,
            }
            if end is not None:
                params["end"] = end
            resp = await client.get(_KLINE_URL, params=params)
            if resp.status_code != 200:
                logger.warning("bybit kline http %s", resp.status_code)
                break
            rows = ((resp.json().get("result") or {}).get("list") or [])
            if not rows:
                break
            page: list[OhlcvBar] = []
            for row in rows:
                bar = _parse_kline_row(row)
                if bar is None:
                    continue
                ts_ms = int(bar.ts.timestamp() * 1000)
                if since_ms and ts_ms < since_ms:
                    continue
                page.append(bar)
            page.reverse()
            out = page + out
            oldest_ms = int(rows[-1][0])
            if since_ms and oldest_ms <= since_ms:
                break
            if len(rows) < 1000:
                break
            if len(out) >= max_bars:
                break
            end = oldest_ms - 1

    if len(out) > max_bars:
        out = out[-max_bars:]
    return out


def _levels(rows: list[list[float]], side: str) -> list[dict]:
    out: list[dict] = []
    cum = 0.0
    for price, amount in rows:
        cum += amount
        out.append({"price": price, "amount": amount, "total": cum, "side": side})
    return out


async def fetch_clusdt_orderbook(limit: int = 200) -> dict:
    """Bybit linear L2 book for CLUSDT (public orderbook, max 500)."""
    lim = max(1, min(int(limit), 500))
    params = {"category": "linear", "symbol": OIL_BYBIT_SYMBOL, "limit": lim}
    async with httpx.AsyncClient(timeout=12.0, headers=_HEADERS) as client:
        resp = await client.get(_BOOK_URL, params=params)
        if resp.status_code != 200:
            logger.warning("bybit orderbook http %s", resp.status_code)
            raise RuntimeError(f"Bybit orderbook HTTP {resp.status_code}")
        payload = resp.json()
    result = payload.get("result") or {}
    bids = [[float(p), float(a)] for p, a in (result.get("b") or []) if p and a]
    asks = [[float(p), float(a)] for p, a in (result.get("a") or []) if p and a]
    bids.sort(key=lambda x: x[0], reverse=True)
    asks.sort(key=lambda x: x[0])
    bids = bids[:lim]
    asks = asks[:lim]
    best_bid = bids[0][0] if bids else None
    best_ask = asks[0][0] if asks else None
    mid = None
    spread = None
    spread_pct = None
    if best_bid and best_ask:
        mid = (best_bid + best_ask) / 2.0
        spread = best_ask - best_bid
        if best_bid:
            spread_pct = (spread / best_bid) * 100.0
    return {
        "symbol": OIL_BYBIT_SYMBOL,
        "tick": _TICK,
        "mid": mid,
        "best_bid": best_bid,
        "best_ask": best_ask,
        "spread": spread,
        "spread_pct": spread_pct,
        "exchanges": ["bybit"],
        "execution_exchange": "bybit",
        "chart_mode": "linear",
        "books": [
            {
                "exchange": "bybit",
                "ok": bool(bids or asks),
                "error": None,
                "bids": bids,
                "asks": asks,
            }
        ],
        "bids": _levels(bids, "bid"),
        "asks": _levels(asks, "ask"),
        "as_of": datetime.now(timezone.utc).isoformat(),
    }


async def fetch_clusdt_trades(limit: int = 80) -> dict:
    """Bybit linear public prints for CLUSDT."""
    lim = max(10, min(int(limit), 1000))
    params = {"category": "linear", "symbol": OIL_BYBIT_SYMBOL, "limit": lim}
    async with httpx.AsyncClient(timeout=12.0, headers=_HEADERS) as client:
        resp = await client.get(_TRADES_URL, params=params)
        if resp.status_code != 200:
            logger.warning("bybit trades http %s", resp.status_code)
            raise RuntimeError(f"Bybit trades HTTP {resp.status_code}")
        payload = resp.json()
    rows = ((payload.get("result") or {}).get("list") or [])
    trades: list[dict] = []
    buy_vol = 0.0
    sell_vol = 0.0
    for row in rows:
        try:
            ts_ms = int(row.get("time") or 0)
            price = float(row.get("price") or 0)
            amount = float(row.get("size") or 0)
        except (TypeError, ValueError):
            continue
        if not ts_ms or price <= 0 or amount <= 0:
            continue
        side_raw = str(row.get("side") or "").lower()
        side = "buy" if side_raw == "buy" else "sell"
        if side == "buy":
            buy_vol += amount
        else:
            sell_vol += amount
        trades.append(
            {
                "id": str(row.get("execId") or f"bybit-{ts_ms}-{price}"),
                "ts": datetime.fromtimestamp(ts_ms / 1000, tz=timezone.utc).isoformat(),
                "ts_ms": ts_ms,
                "price": price,
                "amount": amount,
                "cost": price * amount,
                "side": side,
                "exchange": "bybit",
            }
        )
    trades.sort(key=lambda t: t["ts_ms"], reverse=True)
    buy_n = sum(1 for t in trades if t["side"] == "buy")
    return {
        "symbol": OIL_BYBIT_SYMBOL,
        "exchanges": ["bybit"],
        "execution_exchange": "bybit",
        "trades": trades[:lim],
        "count": len(trades[:lim]),
        "buy_count": buy_n,
        "sell_count": len(trades[:lim]) - buy_n,
        "buy_volume": buy_vol,
        "sell_volume": sell_vol,
        "as_of": datetime.now(timezone.utc).isoformat(),
    }


async def fetch_clusdt_tail(interval: str, n: int = 8) -> list[OhlcvBar]:
    iv = _bybit_interval(interval)
    params = {
        "category": "linear",
        "symbol": OIL_BYBIT_SYMBOL,
        "interval": iv,
        "limit": max(2, min(n, 200)),
    }
    async with httpx.AsyncClient(timeout=12.0, headers=_HEADERS) as client:
        resp = await client.get(_KLINE_URL, params=params)
        if resp.status_code != 200:
            return []
        rows = ((resp.json().get("result") or {}).get("list") or [])
    bars: list[OhlcvBar] = []
    for row in reversed(rows):
        bar = _parse_kline_row(row)
        if bar:
            bars.append(bar)
    return bars


async def iter_clusdt_klines(interval: str):
    """Yield live forming-candle updates from Bybit linear public websocket."""
    import websockets

    iv = normalize_interval(interval)
    bybit_iv = BYBIT_INTERVAL.get(iv)
    if not bybit_iv:
        bybit_iv = "1"
        iv = "1m"
    topic = f"kline.{bybit_iv}.{OIL_BYBIT_SYMBOL}"
    logger.info("oil ws bybit linear → %s (%s)", _WS_URL, topic)
    async with websockets.connect(_WS_URL, ping_interval=20, ping_timeout=20, max_queue=64) as ws:
        await ws.send(json.dumps({"op": "subscribe", "args": [topic]}))
        async for raw in ws:
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                continue
            if data.get("op") == "subscribe" or (data.get("success") is True and "topic" not in data):
                continue
            bar = parse_bybit_kline(data, iv)
            if bar:
                bar["symbol"] = OIL_BYBIT_SYMBOL
                yield bar
