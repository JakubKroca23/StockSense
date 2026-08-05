"""FX rates for portfolio display currency (USD / EUR / CZK)."""

from __future__ import annotations

from datetime import datetime, timezone
import time

import httpx

SUPPORTED = ("USD", "EUR", "CZK")


_cache: dict[str, tuple[float, dict[str, float]]] = {}
_CACHE_TTL = 3600.0


async def fetch_usd_rates() -> dict[str, float]:
    """Return map currency -> units per 1 USD (USD=1). Cached ~1h."""
    now = time.time()
    hit = _cache.get("USD")
    if hit and now - hit[0] < _CACHE_TTL:
        return hit[1]

    rates: dict[str, float] = {"USD": 1.0}
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            # Frankfurter (ECB) — free, no key
            resp = await client.get(
                "https://api.frankfurter.app/latest",
                params={"from": "USD", "to": "EUR,CZK"},
            )
            if resp.status_code == 200:
                body = resp.json()
                for k, v in (body.get("rates") or {}).items():
                    rates[k.upper()] = float(v)
    except Exception:
        pass

    # Sensible fallbacks if API fails
    rates.setdefault("EUR", 0.92)
    rates.setdefault("CZK", 23.0)
    rates["USD"] = 1.0
    _cache["USD"] = (now, rates)
    return rates


def convert(amount: float, from_ccy: str, to_ccy: str, usd_rates: dict[str, float]) -> float:
    src = (from_ccy or "USD").upper()
    dst = (to_ccy or "USD").upper()
    if src == dst:
        return amount
    r_src = usd_rates.get(src) or 1.0
    r_dst = usd_rates.get(dst) or 1.0
    # rates are units of CCY per 1 USD
    amount_usd = amount / r_src
    return amount_usd * r_dst


def guess_currency(symbol: str, exchange: str | None = None) -> str:
    s = (symbol or "").upper()
    ex = (exchange or "").upper()
    if s.endswith("-USD") or s.endswith("USDT") or s.endswith("-USDT"):
        return "USD"
    if s.endswith("-EUR"):
        return "EUR"
    if s.endswith(".PR") or "PRAGUE" in ex or ex in {"PRA", "PR"}:
        return "CZK"
    if s.endswith((".DE", ".PA", ".AS", ".MI", ".MC", ".BR", ".HE", ".VI")):
        return "EUR"
    if "FRANKFURT" in ex or "XETRA" in ex or "PARIS" in ex or "AMSTERDAM" in ex:
        return "EUR"
    if "PRAGUE" in ex:
        return "CZK"
    return "USD"


def rates_payload(usd_rates: dict[str, float]) -> dict:
    return {
        "base": "USD",
        "rates": {c: usd_rates.get(c, 1.0) for c in SUPPORTED},
        "as_of": datetime.now(timezone.utc).isoformat(),
        "supported": list(SUPPORTED),
    }
