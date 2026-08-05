from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Protocol

import httpx
import pandas as pd

from app.models import AssetClass, DataQuality


@dataclass
class OhlcvBar:
    ts: datetime
    open: float
    high: float
    low: float
    close: float
    volume: float
    source: str
    data_quality: DataQuality


@dataclass
class QuoteSnapshot:
    symbol: str
    price: float | None
    change_pct: float | None
    source: str
    data_quality: DataQuality
    as_of: datetime
    fundamentals: dict


class MarketDataProvider(Protocol):
    async def fetch_ohlcv(self, symbol: str, asset_class: AssetClass, interval: str = "1d", lookback: str = "6mo") -> list[OhlcvBar]:
        ...

    async def fetch_quote(self, symbol: str, asset_class: AssetClass) -> QuoteSnapshot:
        ...


def _ensure_aware(ts: datetime) -> datetime:
    if ts.tzinfo is None:
        return ts.replace(tzinfo=timezone.utc)
    return ts


class YFinanceProvider:
    async def fetch_ohlcv(
        self, symbol: str, asset_class: AssetClass, interval: str = "1d", lookback: str = "6mo"
    ) -> list[OhlcvBar]:
        import yfinance as yf

        ticker = yf.Ticker(symbol)
        df = ticker.history(period=lookback, interval=interval, auto_adjust=True)
        if df is None or df.empty:
            return []
        bars: list[OhlcvBar] = []
        for idx, row in df.iterrows():
            ts = idx.to_pydatetime() if hasattr(idx, "to_pydatetime") else datetime.fromisoformat(str(idx))
            bars.append(
                OhlcvBar(
                    ts=_ensure_aware(ts),
                    open=float(row["Open"]),
                    high=float(row["High"]),
                    low=float(row["Low"]),
                    close=float(row["Close"]),
                    volume=float(row.get("Volume") or 0),
                    source="yfinance",
                    data_quality=DataQuality.medium if interval == "1d" else DataQuality.low,
                )
            )
        return bars

    async def fetch_quote(self, symbol: str, asset_class: AssetClass) -> QuoteSnapshot:
        import yfinance as yf

        ticker = yf.Ticker(symbol)
        info = {}
        try:
            info = ticker.info or {}
        except Exception:
            info = {}
        price = info.get("regularMarketPrice") or info.get("currentPrice") or info.get("previousClose")
        change = info.get("regularMarketChangePercent")
        fundamentals = {
            "pe": info.get("trailingPE"),
            "forward_pe": info.get("forwardPE"),
            "pb": info.get("priceToBook"),
            "ps": info.get("priceToSalesTrailing12Months"),
            "roe": info.get("returnOnEquity"),
            "profit_margin": info.get("profitMargins"),
            "debt_to_equity": info.get("debtToEquity"),
            "revenue_growth": info.get("revenueGrowth"),
            "earnings_growth": info.get("earningsGrowth"),
            "market_cap": info.get("marketCap"),
            "sector": info.get("sector"),
            "industry": info.get("industry"),
            "dividend_yield": info.get("dividendYield"),
        }
        return QuoteSnapshot(
            symbol=symbol,
            price=float(price) if price is not None else None,
            change_pct=float(change) if change is not None else None,
            source="yfinance",
            data_quality=DataQuality.medium,
            as_of=datetime.now(timezone.utc),
            fundamentals={k: v for k, v in fundamentals.items() if v is not None},
        )


class StooqProvider:
    """EOD fallback via Stooq CSV."""

    async def fetch_ohlcv(
        self, symbol: str, asset_class: AssetClass, interval: str = "1d", lookback: str = "6mo"
    ) -> list[OhlcvBar]:
        stooq_symbol = symbol.lower()
        if not stooq_symbol.endswith(".us") and asset_class in (AssetClass.stock, AssetClass.etf):
            stooq_symbol = f"{stooq_symbol}.us"
        url = f"https://stooq.com/q/d/l/?s={stooq_symbol}&i=d"
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(url)
            if resp.status_code != 200 or "Date" not in resp.text:
                return []
        from io import StringIO

        df = pd.read_csv(StringIO(resp.text))
        if df.empty:
            return []
        df = df.tail(180)
        bars: list[OhlcvBar] = []
        for _, row in df.iterrows():
            ts = datetime.strptime(str(row["Date"]), "%Y-%m-%d").replace(tzinfo=timezone.utc)
            bars.append(
                OhlcvBar(
                    ts=ts,
                    open=float(row["Open"]),
                    high=float(row["High"]),
                    low=float(row["Low"]),
                    close=float(row["Close"]),
                    volume=float(row.get("Volume") or 0),
                    source="stooq",
                    data_quality=DataQuality.medium,
                )
            )
        return bars

    async def fetch_quote(self, symbol: str, asset_class: AssetClass) -> QuoteSnapshot:
        bars = await self.fetch_ohlcv(symbol, asset_class, lookback="1mo")
        if not bars:
            return QuoteSnapshot(
                symbol=symbol,
                price=None,
                change_pct=None,
                source="stooq",
                data_quality=DataQuality.unavailable,
                as_of=datetime.now(timezone.utc),
                fundamentals={},
            )
        last = bars[-1]
        prev = bars[-2] if len(bars) > 1 else last
        change = ((last.close - prev.close) / prev.close * 100) if prev.close else None
        return QuoteSnapshot(
            symbol=symbol,
            price=last.close,
            change_pct=change,
            source="stooq",
            data_quality=DataQuality.medium,
            as_of=datetime.now(timezone.utc),
            fundamentals={},
        )


class CcxtProvider:
    def __init__(self, exchange_id: str = "binance") -> None:
        self.exchange_id = exchange_id

    def _normalize(self, symbol: str) -> str:
        s = symbol.upper().replace("-", "/")
        if "/" not in s:
            if s.endswith("USDT"):
                return f"{s[:-4]}/USDT"
            return f"{s}/USDT"
        return s

    async def fetch_ohlcv(
        self, symbol: str, asset_class: AssetClass, interval: str = "1d", lookback: str = "6mo"
    ) -> list[OhlcvBar]:
        import ccxt

        exchange_cls = getattr(ccxt, self.exchange_id)
        exchange = exchange_cls({"enableRateLimit": True})
        market = self._normalize(symbol)
        timeframe = "1d" if interval in ("1d", "1day") else "1h"
        limit = 180 if timeframe == "1d" else 168
        raw = exchange.fetch_ohlcv(market, timeframe=timeframe, limit=limit)
        bars: list[OhlcvBar] = []
        for row in raw:
            bars.append(
                OhlcvBar(
                    ts=datetime.fromtimestamp(row[0] / 1000, tz=timezone.utc),
                    open=float(row[1]),
                    high=float(row[2]),
                    low=float(row[3]),
                    close=float(row[4]),
                    volume=float(row[5]),
                    source=f"ccxt:{self.exchange_id}",
                    data_quality=DataQuality.high,
                )
            )
        return bars

    async def fetch_quote(self, symbol: str, asset_class: AssetClass) -> QuoteSnapshot:
        import ccxt

        exchange_cls = getattr(ccxt, self.exchange_id)
        exchange = exchange_cls({"enableRateLimit": True})
        market = self._normalize(symbol)
        ticker = exchange.fetch_ticker(market)
        funding = None
        try:
            if hasattr(exchange, "fetch_funding_rate"):
                fr = exchange.fetch_funding_rate(market)
                funding = fr.get("fundingRate")
        except Exception:
            funding = None
        return QuoteSnapshot(
            symbol=symbol,
            price=float(ticker["last"]) if ticker.get("last") is not None else None,
            change_pct=float(ticker["percentage"]) if ticker.get("percentage") is not None else None,
            source=f"ccxt:{self.exchange_id}",
            data_quality=DataQuality.high,
            as_of=datetime.now(timezone.utc),
            fundamentals={"funding_rate": funding} if funding is not None else {},
        )


class CompositeMarketData:
    def __init__(self) -> None:
        self.yf = YFinanceProvider()
        self.stooq = StooqProvider()
        self.ccxt = CcxtProvider()

    async def fetch_ohlcv(
        self, symbol: str, asset_class: AssetClass, interval: str = "1d", lookback: str = "6mo"
    ) -> list[OhlcvBar]:
        if asset_class == AssetClass.crypto:
            bars = await self.ccxt.fetch_ohlcv(symbol, asset_class, interval, lookback)
            if bars:
                return bars
        bars = await self.yf.fetch_ohlcv(symbol, asset_class, interval, lookback)
        if bars:
            return bars
        return await self.stooq.fetch_ohlcv(symbol, asset_class, interval, lookback)

    async def fetch_quote(self, symbol: str, asset_class: AssetClass) -> QuoteSnapshot:
        if asset_class == AssetClass.crypto:
            q = await self.ccxt.fetch_quote(symbol, asset_class)
            if q.price is not None:
                return q
        q = await self.yf.fetch_quote(symbol, asset_class)
        if q.price is not None:
            return q
        return await self.stooq.fetch_quote(symbol, asset_class)


market_data = CompositeMarketData()
