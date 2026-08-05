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
            out.append(
                {
                    "form": forms[i],
                    "filing_date": dates[i],
                    "accession": accessions[i],
                    "document": primaries[i] if i < len(primaries) else None,
                    "cik": cik,
                }
            )
        return out
