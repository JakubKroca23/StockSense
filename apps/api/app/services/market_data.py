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
        info: dict = {}
        try:
            info = ticker.info or {}
        except Exception:
            info = {}

        price = info.get("regularMarketPrice") or info.get("currentPrice") or info.get("previousClose")
        change = info.get("regularMarketChangePercent")

        # Yahoo often rate-limits `.info`; fall back to recent history for price.
        if price is None:
            try:
                hist = ticker.history(period="5d", interval="1d", auto_adjust=True)
                if hist is not None and not hist.empty:
                    closes = hist["Close"].dropna()
                    if len(closes) >= 1:
                        price = float(closes.iloc[-1])
                    if len(closes) >= 2 and closes.iloc[-2]:
                        change = float((closes.iloc[-1] - closes.iloc[-2]) / closes.iloc[-2] * 100)
            except Exception:
                pass

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
        dq = DataQuality.medium if price is not None else DataQuality.unavailable
        if price is not None and not info:
            dq = DataQuality.low
        return QuoteSnapshot(
            symbol=symbol,
            price=float(price) if price is not None else None,
            change_pct=float(change) if change is not None else None,
            source="yfinance",
            data_quality=dq,
            as_of=datetime.now(timezone.utc),
            fundamentals={k: v for k, v in fundamentals.items() if v is not None},
        )


class StooqProvider:
    """EOD fallback via Stooq CSV."""

    async def fetch_ohlcv(
        self, symbol: str, asset_class: AssetClass, interval: str = "1d", lookback: str = "6mo"
    ) -> list[OhlcvBar]:
        raw = symbol.lower().replace("-usd", "").replace("/", "")
        candidates = [raw]
        if asset_class in (AssetClass.stock, AssetClass.etf) and not raw.endswith(".us"):
            candidates.append(f"{raw}.us")
        text = ""
        async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
            for stooq_symbol in candidates:
                url = f"https://stooq.com/q/d/l/?s={stooq_symbol}&i=d"
                resp = await client.get(url)
                if resp.status_code == 200 and "Date" in resp.text and "No data" not in resp.text:
                    text = resp.text
                    break
        if not text:
            return []
        from io import StringIO

        df = pd.read_csv(StringIO(text))
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


class YahooChartProvider:
    """Direct Yahoo chart API — more resilient than yfinance `.info` under rate limits."""

    async def fetch_ohlcv(
        self, symbol: str, asset_class: AssetClass, interval: str = "1d", lookback: str = "6mo"
    ) -> list[OhlcvBar]:
        range_map = {"1mo": "1mo", "3mo": "3mo", "6mo": "6mo", "1y": "1y", "5d": "5d"}
        rng = range_map.get(lookback, "6mo")
        iv = "1d" if interval in ("1d", "1day") else "1h"
        url = f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
        params = {"range": rng, "interval": iv}
        headers = {"User-Agent": "Mozilla/5.0 StockSense/1.0"}
        async with httpx.AsyncClient(timeout=30.0, headers=headers) as client:
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
        bars: list[OhlcvBar] = []
        for i, ts in enumerate(ts_list):
            c = closes[i] if i < len(closes) else None
            if c is None:
                continue
            bars.append(
                OhlcvBar(
                    ts=datetime.fromtimestamp(ts, tz=timezone.utc),
                    open=float(opens[i] if i < len(opens) and opens[i] is not None else c),
                    high=float(highs[i] if i < len(highs) and highs[i] is not None else c),
                    low=float(lows[i] if i < len(lows) and lows[i] is not None else c),
                    close=float(c),
                    volume=float(vols[i] if i < len(vols) and vols[i] is not None else 0),
                    source="yahoo_chart",
                    data_quality=DataQuality.medium,
                )
            )
        return bars

    async def fetch_quote(self, symbol: str, asset_class: AssetClass) -> QuoteSnapshot:
        bars = await self.fetch_ohlcv(symbol, asset_class, lookback="5d")
        if not bars:
            return QuoteSnapshot(
                symbol=symbol,
                price=None,
                change_pct=None,
                source="yahoo_chart",
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
            source="yahoo_chart",
            data_quality=DataQuality.medium,
            as_of=datetime.now(timezone.utc),
            fundamentals={},
        )


class CompositeMarketData:
    def __init__(self) -> None:
        self.yf = YFinanceProvider()
        self.yahoo_chart = YahooChartProvider()
        self.stooq = StooqProvider()
        self.ccxt = CcxtProvider()

    async def fetch_ohlcv(
        self, symbol: str, asset_class: AssetClass, interval: str = "1d", lookback: str = "6mo"
    ) -> list[OhlcvBar]:
        if asset_class == AssetClass.crypto:
            bars = await self.ccxt.fetch_ohlcv(symbol, asset_class, interval, lookback)
            if bars:
                return bars
        bars = await self.yahoo_chart.fetch_ohlcv(symbol, asset_class, interval, lookback)
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
        q = await self.yahoo_chart.fetch_quote(symbol, asset_class)
        if q.price is not None:
            return q
        q = await self.yf.fetch_quote(symbol, asset_class)
        if q.price is not None:
            return q
        return await self.stooq.fetch_quote(symbol, asset_class)


market_data = CompositeMarketData()
