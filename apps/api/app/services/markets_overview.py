"""Home market-sector overviews — crypto / stocks / commodities."""

from __future__ import annotations

import asyncio
import logging
import time
from datetime import datetime, timezone

from app.models import AssetClass, DataQuality
from app.services.market_data import market_data

logger = logging.getLogger(__name__)

_CACHE: dict[str, tuple[float, dict]] = {}
_CACHE_TTL_SEC = 45.0

SECTORS: dict[str, dict] = {
    "crypto": {
        "id": "crypto",
        "label": "Krypto",
        "href": "/cryptosense",
        "benchmarks": [
            {"symbol": "BTC/USDT", "name": "Bitcoin", "asset_class": AssetClass.crypto},
            {"symbol": "ETH/USDT", "name": "Ethereum", "asset_class": AssetClass.crypto},
            {"symbol": "SOL/USDT", "name": "Solana", "asset_class": AssetClass.crypto},
        ],
        "chart_symbol": "BTC/USDT",
        "chart_asset_class": AssetClass.crypto,
    },
    "stocks": {
        "id": "stocks",
        "label": "Akcie",
        "href": None,
        "benchmarks": [
            {"symbol": "SPY", "name": "S&P 500", "asset_class": AssetClass.etf},
            {"symbol": "QQQ", "name": "Nasdaq 100", "asset_class": AssetClass.etf},
            {"symbol": "IWM", "name": "Russell 2000", "asset_class": AssetClass.etf},
        ],
        "chart_symbol": "SPY",
        "chart_asset_class": AssetClass.etf,
    },
    "commodities": {
        "id": "commodities",
        "label": "Komodity",
        "href": None,
        "benchmarks": [
            {"symbol": "GLD", "name": "Zlato", "asset_class": AssetClass.commodity},
            {"symbol": "SLV", "name": "Stříbro", "asset_class": AssetClass.commodity},
            {"symbol": "USO", "name": "Ropa", "asset_class": AssetClass.commodity},
        ],
        "chart_symbol": "GLD",
        "chart_asset_class": AssetClass.commodity,
    },
}


def _bias_from_changes(changes: list[float]) -> tuple[str, str, str]:
    """Return (bias_key, label_cs, summary_cs)."""
    if not changes:
        return "unknown", "Bez dat", "Zatím nemám dostatek tržních dat pro hodnocení."
    avg = sum(changes) / len(changes)
    up = sum(1 for c in changes if c > 0.15)
    down = sum(1 for c in changes if c < -0.15)
    breadth = up - down

    if avg >= 1.2 and breadth >= 1:
        return (
            "risk_on",
            "Růst / risk-on",
            f"Benchmarky průměrně {avg:+.1f} %. Převládá nákupní tlak — trh je spíš v risk-on módu.",
        )
    if avg <= -1.2 and breadth <= -1:
        return (
            "risk_off",
            "Výprodej / risk-off",
            f"Benchmarky průměrně {avg:+.1f} %. Dominuje tlak na výprodej — opatrný risk-off tón.",
        )
    if abs(avg) < 0.45 and abs(breadth) <= 1:
        return (
            "range",
            "Konsolidace",
            f"Pohyby jsou malé (ø {avg:+.1f} %). Trh spíš konsoliduje bez jasného směru.",
        )
    if avg > 0:
        return (
            "mild_up",
            "Mírně pozitivní",
            f"Lehký růstový bias (ø {avg:+.1f} %). Sentiment je opatrně konstruktivní.",
        )
    return (
        "mild_down",
        "Mírně negativní",
        f"Lehký sestupný bias (ø {avg:+.1f} %). Sentiment je opatrně defenzivní.",
    )


async def _one_benchmark(item: dict) -> dict:
    sym = item["symbol"]
    ac = item["asset_class"]
    try:
        # Homepage needs price/% only — skip slow yfinance .info fundamentals.
        quote = await market_data.fetch_quote(sym, ac, fundamentals=False)
        return {
            "symbol": sym,
            "name": item["name"],
            "price": quote.price,
            "change_pct": quote.change_pct,
            "source": quote.source,
            "ok": quote.price is not None,
        }
    except Exception as exc:
        logger.warning("benchmark quote %s failed: %s", sym, exc)
        return {
            "symbol": sym,
            "name": item["name"],
            "price": None,
            "change_pct": None,
            "source": None,
            "ok": False,
        }


async def _spark_bars(symbol: str, asset_class: AssetClass, limit: int = 45) -> list[dict]:
    try:
        bars = await market_data.fetch_ohlcv(symbol, asset_class, interval="1d", lookback="3mo")
        if limit and len(bars) > limit:
            bars = bars[-limit:]
        return [
            {
                "ts": b.ts.isoformat(),
                "open": b.open,
                "high": b.high,
                "low": b.low,
                "close": b.close,
                "volume": b.volume,
            }
            for b in bars
        ]
    except Exception as exc:
        logger.warning("spark bars %s failed: %s", symbol, exc)
        return []


async def build_sector(sector_id: str) -> dict:
    cfg = SECTORS[sector_id]
    benches = await asyncio.gather(*[_one_benchmark(b) for b in cfg["benchmarks"]])
    changes = [float(b["change_pct"]) for b in benches if b.get("change_pct") is not None]
    bias_key, bias_label, summary = _bias_from_changes(changes)

    weights: list[dict] = []
    abs_moves = [abs(float(b["change_pct"])) for b in benches if b.get("change_pct") is not None]
    if abs_moves and sum(abs_moves) > 0:
        for b in benches:
            if b.get("change_pct") is None:
                continue
            weights.append(
                {
                    "key": b["symbol"],
                    "label": b["name"],
                    "value": max(abs(float(b["change_pct"])), 0.05),
                    "change_pct": b["change_pct"],
                }
            )
    else:
        for b in benches:
            weights.append(
                {
                    "key": b["symbol"],
                    "label": b["name"],
                    "value": 1.0,
                    "change_pct": b.get("change_pct"),
                }
            )

    spark = await _spark_bars(cfg["chart_symbol"], cfg["chart_asset_class"])
    avg = (sum(changes) / len(changes)) if changes else None

    return {
        "id": cfg["id"],
        "label": cfg["label"],
        "href": cfg["href"],
        "bias": bias_key,
        "bias_label": bias_label,
        "summary": summary,
        "summary_source": "rules",
        "avg_change_pct": avg,
        "benchmarks": list(benches),
        "composition": weights,
        "chart_symbol": cfg["chart_symbol"],
        "spark": spark,
        "as_of": datetime.now(timezone.utc).isoformat(),
        "data_quality": (
            DataQuality.high.value
            if all(b.get("ok") for b in benches) and spark
            else DataQuality.medium.value
            if any(b.get("ok") for b in benches)
            else DataQuality.unavailable.value
        ),
    }


async def markets_overview() -> dict:
    """Fast sector cards — rule summaries only (AI via /markets/overview/ai)."""
    now = time.monotonic()
    hit = _CACHE.get("overview")
    if hit and now - hit[0] < _CACHE_TTL_SEC:
        return hit[1]

    sectors = await asyncio.gather(
        build_sector("crypto"),
        build_sector("stocks"),
        build_sector("commodities"),
    )
    payload = {
        "as_of": datetime.now(timezone.utc).isoformat(),
        "sectors": list(sectors),
    }
    _CACHE["overview"] = (now, payload)
    return payload


async def _enrich_summary_with_llm(sector: dict) -> dict:
    from app.services.llm import narrate_market_sector

    out = dict(sector)
    try:
        out["summary"] = await narrate_market_sector(out)
        out["summary_source"] = "llm"
    except Exception as exc:
        logger.warning("LLM sector summary %s failed: %s", out.get("id"), exc)
        out["summary_source"] = "rules"
    return out


async def markets_overview_ai() -> dict:
    """Gemini AI blurbs for already-built (cached) sector cards."""
    base = await markets_overview()
    enriched = await asyncio.gather(
        *[_enrich_summary_with_llm(dict(s)) for s in base["sectors"]]
    )
    return {
        "as_of": datetime.now(timezone.utc).isoformat(),
        "sectors": [
            {
                "id": s["id"],
                "summary": s["summary"],
                "summary_source": s.get("summary_source", "llm"),
            }
            for s in enriched
        ],
    }