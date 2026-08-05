from __future__ import annotations

from datetime import datetime, timezone

import httpx

from app.core.config import get_settings


FRED_SERIES = {
    "DFF": "Fed Funds Rate",
    "DGS10": "US 10Y Yield",
    "DGS2": "US 2Y Yield",
    "CPIAUCSL": "US CPI",
    "UNRATE": "US Unemployment",
    "VIXCLS": "VIX",
}


async def fetch_fred_latest() -> list[dict]:
    settings = get_settings()
    if not settings.fred_api_key:
        return []

    results: list[dict] = []
    async with httpx.AsyncClient(timeout=30.0) as client:
        for series_id, name in FRED_SERIES.items():
            url = "https://api.stlouisfed.org/fred/series/observations"
            params = {
                "series_id": series_id,
                "api_key": settings.fred_api_key,
                "file_type": "json",
                "sort_order": "desc",
                "limit": 5,
            }
            resp = await client.get(url, params=params)
            if resp.status_code != 200:
                continue
            observations = resp.json().get("observations", [])
            for obs in observations:
                if obs.get("value") in (".", None, ""):
                    continue
                results.append(
                    {
                        "series_id": series_id,
                        "name": name,
                        "value": float(obs["value"]),
                        "ts": datetime.strptime(obs["date"], "%Y-%m-%d").replace(tzinfo=timezone.utc),
                        "source": "FRED",
                    }
                )
                break
    return results


def macro_bias_from_snapshots(snaps: list) -> float:
    """Simple heuristic: inverted yield / high VIX = risk-off.

    Accepts objects with `.series_id` / `.value` or dicts.
    """
    by_id: dict[str, float] = {}
    for s in snaps:
        sid = getattr(s, "series_id", None) or (s.get("series_id") if isinstance(s, dict) else None)
        val = getattr(s, "value", None) if not isinstance(s, dict) else s.get("value")
        if sid is not None and val is not None:
            by_id[str(sid)] = float(val)
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


async def fetch_edgar_recent_filings(ticker: str, count: int = 5) -> list[dict]:
    """Lightweight SEC EDGAR company search + recent filings metadata."""
    headers = {"User-Agent": "StockSense personal-tool jakub@propoj.app"}
    async with httpx.AsyncClient(timeout=30.0, headers=headers) as client:
        map_resp = await client.get("https://www.sec.gov/files/company_tickers.json")
        if map_resp.status_code != 200:
            return []
        data = map_resp.json()
        cik = None
        for item in data.values():
            if str(item.get("ticker", "")).upper() == ticker.upper():
                cik = str(item["cik_str"]).zfill(10)
                break
        if not cik:
            return []
        sub_resp = await client.get(f"https://data.sec.gov/submissions/CIK{cik}.json")
        if sub_resp.status_code != 200:
            return []
        recent = sub_resp.json().get("filings", {}).get("recent", {})
        forms = recent.get("form", [])
        dates = recent.get("filingDate", [])
        accessions = recent.get("accessionNumber", [])
        primaries = recent.get("primaryDocument", [])
        out = []
        for i in range(min(count, len(forms))):
            accession = accessions[i] if i < len(accessions) else None
            document = primaries[i] if i < len(primaries) else None
            url = None
            if accession and document:
                acc_nodash = accession.replace("-", "")
                url = f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/{acc_nodash}/{document}"
            elif accession:
                url = f"https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK={cik}&type={forms[i]}&dateb=&owner=include&count=10"
            out.append(
                {
                    "form": forms[i],
                    "filing_date": dates[i],
                    "accession": accession,
                    "document": document,
                    "cik": cik,
                    "url": url,
                }
            )
        return out


async def fetch_yahoo_headlines(symbol: str, limit: int = 8) -> list[dict]:
    """Lightweight Yahoo Finance news titles (no sentiment scoring)."""
    url = f"https://query1.finance.yahoo.com/v1/finance/search"
    params = {"q": symbol, "quotesCount": 0, "newsCount": limit, "listsCount": 0}
    headers = {"User-Agent": "Mozilla/5.0 StockSense/1.0"}
    try:
        async with httpx.AsyncClient(timeout=20.0, headers=headers) as client:
            resp = await client.get(url, params=params)
            if resp.status_code != 200:
                return []
            news = resp.json().get("news") or []
    except Exception:
        return []
    out: list[dict] = []
    for item in news[:limit]:
        title = item.get("title")
        if not title:
            continue
        pub = item.get("providerPublishTime")
        published = None
        if isinstance(pub, (int, float)):
            published = datetime.fromtimestamp(pub, tz=timezone.utc).isoformat()
        out.append(
            {
                "title": title,
                "publisher": item.get("publisher"),
                "link": item.get("link"),
                "published": published,
            }
        )
    return out
