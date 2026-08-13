"""Anchored VWAP Midas heatmap for gold (COMEX GC=F proxy for XAU).

Computes up to 168 hourly-anchored VWAPs over ~7d of 1m bars, each with
Fibonacci std-dev bands at 0.618 / 1.618 / 2.618 σ.
"""

from __future__ import annotations

import math
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

import httpx

GOLD_SYMBOL = "GC=F"
GOLD_LABEL = "Gold (COMEX)"
GOLD_TICKER_NOTE = (
    "Yahoo GC=F — likvidní proxy za spot XAU/USD "
    "(XAUUSD=X na Yahoo není dostupný)."
)
FIB_LEVELS = (0.618, 1.618, 2.618)
MAX_ANCHORS = 168  # 7d × 24h
DEFAULT_MAX_POINTS = 160  # per-anchor downsample budget for JSON payload

_cache: dict[str, Any] = {"ts": 0.0, "payload": None, "key": None}
_CACHE_TTL_SEC = 90.0


@dataclass
class GoldBar:
    ts: datetime
    open: float
    high: float
    low: float
    close: float
    volume: float


@dataclass
class _AnchorState:
    anchor_ts: datetime
    sum_v: float = 0.0
    sum_pv: float = 0.0
    sum_p2v: float = 0.0
    # Packed samples: [t, vwap, u0618, l0618, u1618, l1618, u2618, l2618] …
    samples: list[float] = field(default_factory=list)


def _ensure_aware(ts: datetime) -> datetime:
    if ts.tzinfo is None:
        return ts.replace(tzinfo=timezone.utc)
    return ts


def _typical_price(bar: GoldBar) -> float:
    return (bar.high + bar.low + bar.close) / 3.0


def _effective_volume(bar: GoldBar) -> float:
    """FX/metals sometimes lack volume — fall back to range proxy / unit weight."""
    v = float(bar.volume or 0.0)
    if v > 0:
        return v
    rng = abs(bar.high - bar.low)
    if rng > 0:
        return max(rng, 1e-6)
    return 1.0


async def fetch_gold_1m_bars(*, lookback: str = "7d") -> list[GoldBar]:
    """Pull 1-minute COMEX gold candles from Yahoo chart API."""
    rng = lookback if lookback in ("5d", "7d", "1mo") else "7d"
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{GOLD_SYMBOL}"
    params = {"range": rng, "interval": "1m"}
    headers = {"User-Agent": "Mozilla/5.0 StockSense/1.0"}
    async with httpx.AsyncClient(timeout=45.0, headers=headers) as client:
        resp = await client.get(url, params=params)
        if resp.status_code != 200:
            return []
        payload = resp.json()

    result = (payload.get("chart") or {}).get("result") or []
    if not result:
        return []
    node = result[0]
    ts_list = node.get("timestamp") or []
    quote = ((node.get("indicators") or {}).get("quote") or [{}])[0]
    opens = quote.get("open") or []
    highs = quote.get("high") or []
    lows = quote.get("low") or []
    closes = quote.get("close") or []
    vols = quote.get("volume") or []

    bars: list[GoldBar] = []
    for i, ts in enumerate(ts_list):
        c = closes[i] if i < len(closes) else None
        if c is None:
            continue
        o = opens[i] if i < len(opens) and opens[i] is not None else c
        h = highs[i] if i < len(highs) and highs[i] is not None else c
        low = lows[i] if i < len(lows) and lows[i] is not None else c
        v = vols[i] if i < len(vols) and vols[i] is not None else 0
        bars.append(
            GoldBar(
                ts=datetime.fromtimestamp(int(ts), tz=timezone.utc),
                open=float(o),
                high=float(h),
                low=float(low),
                close=float(c),
                volume=float(v),
            )
        )
    return bars


def _is_hour_anchor(ts: datetime, prev: datetime | None) -> bool:
    """True on minute 00, or when the UTC hour rolls after a gap."""
    t = _ensure_aware(ts)
    if t.minute == 0:
        return True
    if prev is None:
        return False
    p = _ensure_aware(prev)
    return (t.year, t.month, t.day, t.hour) != (p.year, p.month, p.day, p.hour)


def _append_sample(state: _AnchorState, t_unix: int, vwap: float, sigma: float) -> None:
    r = round
    state.samples.extend(
        [
            float(t_unix),
            r(vwap, 4),
            r(vwap + 0.618 * sigma, 4),
            r(vwap - 0.618 * sigma, 4),
            r(vwap + 1.618 * sigma, 4),
            r(vwap - 1.618 * sigma, 4),
            r(vwap + 2.618 * sigma, 4),
            r(vwap - 2.618 * sigma, 4),
        ]
    )


def _downsample_packed(samples: list[float], max_points: int) -> list[float]:
    """Keep first/last and evenly spaced packed 8-float samples."""
    width = 8
    n = len(samples) // width
    if n <= max_points or max_points < 3:
        return samples
    keep = {0, n - 1}
    for i in range(1, max_points - 1):
        keep.add(round(i * (n - 1) / (max_points - 1)))
    out: list[float] = []
    for idx in sorted(keep):
        base = idx * width
        out.extend(samples[base : base + width])
    return out


def compute_anchored_vwap_midas(
    bars: list[GoldBar],
    *,
    max_anchors: int = MAX_ANCHORS,
    max_points_per_anchor: int = DEFAULT_MAX_POINTS,
) -> list[dict[str, Any]]:
    """Walk 1m bars, spawn hourly anchors, accumulate VWAP + σ bands."""
    if not bars:
        return []

    active: list[_AnchorState] = []
    prev_ts: datetime | None = None

    for bar in bars:
        ts = _ensure_aware(bar.ts)
        if _is_hour_anchor(ts, prev_ts):
            active.append(_AnchorState(anchor_ts=ts))

        price = _typical_price(bar)
        vol = _effective_volume(bar)
        t_unix = int(ts.timestamp())

        for state in active:
            state.sum_v += vol
            state.sum_pv += price * vol
            state.sum_p2v += price * price * vol
            if state.sum_v <= 0:
                continue
            vwap = state.sum_pv / state.sum_v
            var = max(state.sum_p2v / state.sum_v - vwap * vwap, 0.0)
            sigma = math.sqrt(var)
            _append_sample(state, t_unix, vwap, sigma)

        prev_ts = ts

    states = active[-max_anchors:] if len(active) > max_anchors else active

    out: list[dict[str, Any]] = []
    for state in states:
        packed = _downsample_packed(state.samples, max_points_per_anchor)
        if len(packed) < 16:  # need ≥2 points
            continue
        out.append(
            {
                "anchor_ts": state.anchor_ts.isoformat(),
                "anchor_unix": int(state.anchor_ts.timestamp()),
                "points": len(packed) // 8,
                # Flat: t, vwap, u0618, l0618, u1618, l1618, u2618, l2618
                "band": packed,
            }
        )
    return out


def bars_to_ohlcv_payload(bars: list[GoldBar]) -> list[dict[str, Any]]:
    return [
        {
            "ts": _ensure_aware(b.ts).isoformat(),
            "open": round(b.open, 4),
            "high": round(b.high, 4),
            "low": round(b.low, 4),
            "close": round(b.close, 4),
            "volume": round(b.volume, 2),
        }
        for b in bars
    ]


async def build_gold_midas_payload(
    *,
    lookback: str = "7d",
    max_points_per_anchor: int = DEFAULT_MAX_POINTS,
    use_cache: bool = True,
) -> dict[str, Any]:
    now = time.time()
    cache_key = f"{lookback}:{max_points_per_anchor}"
    if (
        use_cache
        and _cache.get("key") == cache_key
        and _cache.get("payload") is not None
        and now - float(_cache.get("ts") or 0) < _CACHE_TTL_SEC
    ):
        return _cache["payload"]

    bars = await fetch_gold_1m_bars(lookback=lookback)
    anchors = compute_anchored_vwap_midas(
        bars, max_points_per_anchor=max_points_per_anchor
    )
    last = bars[-1] if bars else None
    change_pct = None
    if len(bars) >= 2 and bars[0].close:
        change_pct = (bars[-1].close - bars[0].close) / bars[0].close * 100.0

    payload = {
        "symbol": GOLD_SYMBOL,
        "label": GOLD_LABEL,
        "note": GOLD_TICKER_NOTE,
        "interval": "1m",
        "lookback": lookback,
        "fib_levels": list(FIB_LEVELS),
        "bars_count": len(bars),
        "anchors_count": len(anchors),
        "as_of": datetime.now(timezone.utc).isoformat(),
        "price": last.close if last else None,
        "change_pct_window": change_pct,
        "ohlcv": bars_to_ohlcv_payload(bars),
        "anchors": anchors,
        "render_hint": {
            "fill": "0.618",
            "fill_rgba": "rgba(0, 80, 255, 0.03)",
            "upper_stroke": "#3dce7a",
            "lower_stroke": "#e05a8a",
            "outer_levels": [1.618, 2.618],
        },
    }
    _cache["ts"] = now
    _cache["key"] = cache_key
    _cache["payload"] = payload
    return payload
