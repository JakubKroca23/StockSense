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


def _fundamentals_from_yf_info(info: dict) -> dict:
    """Normalize yfinance `.info` into a compact fundamentals dict."""
    def _ts(val) -> str | None:
        if val is None:
            return None
        try:
            if isinstance(val, (int, float)) and val > 1e9:
                return datetime.fromtimestamp(float(val), tz=timezone.utc).date().isoformat()
            return str(val)[:32]
        except Exception:
            return None

    raw = {
        "pe": info.get("trailingPE"),
        "forward_pe": info.get("forwardPE"),
        "peg": info.get("pegRatio"),
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
        "eps_ttm": info.get("trailingEps"),
        "eps_forward": info.get("forwardEps"),
        "earnings_date": _ts(
            info.get("earningsTimestamp")
            or info.get("earningsTimestampStart")
            or (
                info.get("earningsDate")[0]
                if isinstance(info.get("earningsDate"), (list, tuple)) and info.get("earningsDate")
                else info.get("earningsDate")
            )
        ),
        "eps_surprise_pct": info.get("earningsQuarterlyGrowth"),
        "target_mean": info.get("targetMeanPrice"),
        "recommendation": info.get("recommendationKey"),
        "fifty_two_week_high": info.get("fiftyTwoWeekHigh"),
        "fifty_two_week_low": info.get("fiftyTwoWeekLow"),
        "beta": info.get("beta"),
        "short_name": info.get("shortName") or info.get("longName"),
    }
    return {k: v for k, v in raw.items() if v is not None}


def _ensure_aware(ts: datetime) -> datetime:
    if ts.tzinfo is None:
        return ts.replace(tzinfo=timezone.utc)
    return ts


def normalize_interval(interval: str) -> str:
    raw = (interval or "1d").lower().strip()
    aliases = {
        "15min": "15m",
        "60m": "1h",
        "60min": "1h",
        "1hour": "1h",
        "4hour": "4h",
        "1day": "1d",
        "day": "1d",
        "1w": "1wk",
        "1week": "1wk",
        "week": "1wk",
    }
    return aliases.get(raw, raw)


def clamp_lookback(interval: str, lookback: str) -> str:
    """Yahoo/yfinance reject long ranges for intraday intervals."""
    iv = normalize_interval(interval)
    allowed = {
        "15m": ("5d", "1mo"),
        "1h": ("5d", "1mo", "3mo", "6mo"),
        "4h": ("1mo", "3mo", "6mo", "1y"),
        "1d": ("5d", "1mo", "3mo", "6mo", "1y", "2y", "5y"),
        "1wk": ("1y", "2y", "5y"),
    }
    opts = allowed.get(iv, allowed["1d"])
    if lookback in opts:
        return lookback
    return opts[-1] if iv in ("1d", "1wk") else opts[0]


def aggregate_bars_hours(bars: list[OhlcvBar], hours: int) -> list[OhlcvBar]:
    """Bucket 1h (or finer) bars into N-hour candles (e.g. 4h)."""
    if hours <= 1 or not bars:
        return bars
    buckets: dict[datetime, list[OhlcvBar]] = {}
    order: list[datetime] = []
    for b in bars:
        ts = _ensure_aware(b.ts)
        floored = ts.replace(hour=(ts.hour // hours) * hours, minute=0, second=0, microsecond=0)
        if floored not in buckets:
            buckets[floored] = []
            order.append(floored)
        buckets[floored].append(b)
    out: list[OhlcvBar] = []
    for key in order:
        chunk = buckets[key]
        out.append(
            OhlcvBar(
                ts=key,
                open=chunk[0].open,
                high=max(c.high for c in chunk),
                low=min(c.low for c in chunk),
                close=chunk[-1].close,
                volume=sum(c.volume for c in chunk),
                source=chunk[0].source,
                data_quality=chunk[0].data_quality,
            )
        )
    return out


class YFinanceProvider:
    async def fetch_ohlcv(
        self, symbol: str, asset_class: AssetClass, interval: str = "1d", lookback: str = "6mo"
    ) -> list[OhlcvBar]:
        import yfinance as yf

        iv = normalize_interval(interval)
        lb = clamp_lookback(iv, lookback)
        yf_interval = "1h" if iv == "4h" else iv
        if yf_interval == "1wk":
            yf_interval = "1wk"

        ticker = yf.Ticker(symbol)
        df = ticker.history(period=lb, interval=yf_interval, auto_adjust=True)
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
                    data_quality=DataQuality.medium if iv == "1d" else DataQuality.low,
                )
            )
        if iv == "4h":
            bars = aggregate_bars_hours(bars, 4)
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

        fundamentals = _fundamentals_from_yf_info(info)
        dq = DataQuality.medium if price is not None else DataQuality.unavailable
        if price is not None and not info:
            dq = DataQuality.low
        # Rich fundamentals → higher confidence in quote quality
        elif price is not None and fundamentals.get("market_cap") and (
            fundamentals.get("pe") or fundamentals.get("sector")
        ):
            dq = DataQuality.high
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
                    data_quality=DataQuality.proxy,
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
            data_quality=DataQuality.proxy,
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
        iv = normalize_interval(interval)
        tf_map = {"15m": "15m", "1h": "1h", "4h": "4h", "1d": "1d", "1wk": "1w"}
        timeframe = tf_map.get(iv, "1d")
        limit_map = {"15m": 288, "1h": 336, "4h": 180, "1d": 365, "1w": 260}
        limit = limit_map.get(timeframe, 180)
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
            data_quality=(
                DataQuality.high if ticker.get("last") is not None else DataQuality.unavailable
            ),
            as_of=datetime.now(timezone.utc),
            fundamentals={"funding_rate": funding} if funding is not None else {},
        )


class YahooChartProvider:
    """Direct Yahoo chart API — more resilient than yfinance `.info` under rate limits."""

    async def fetch_ohlcv(
        self, symbol: str, asset_class: AssetClass, interval: str = "1d", lookback: str = "6mo"
    ) -> list[OhlcvBar]:
        iv = normalize_interval(interval)
        lb = clamp_lookback(iv, lookback)
        range_map = {
            "5d": "5d",
            "1mo": "1mo",
            "3mo": "3mo",
            "6mo": "6mo",
            "1y": "1y",
            "2y": "2y",
            "5y": "5y",
        }
        rng = range_map.get(lb, "6mo")
        # Yahoo has no native 4h — pull 60m and aggregate.
        yahoo_iv = {"15m": "15m", "1h": "60m", "4h": "60m", "1d": "1d", "1wk": "1wk"}.get(iv, "1d")
        url = f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
        params = {"range": rng, "interval": yahoo_iv}
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
        dq = DataQuality.low if iv not in ("1d", "1wk") else DataQuality.medium
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
                    data_quality=dq,
                )
            )
        if iv == "4h":
            bars = aggregate_bars_hours(bars, 4)
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
            data_quality=last.data_quality,
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
        iv = normalize_interval(interval)
        lb = clamp_lookback(iv, lookback)
        if asset_class == AssetClass.crypto:
            try:
                from app.services.crypto_market import get_crypto_market

                bars = await get_crypto_market().fetch_ohlcv(symbol, interval=iv)
                if bars:
                    return bars
            except Exception:
                pass
            bars = await self.ccxt.fetch_ohlcv(symbol, asset_class, iv, lb)
            if bars:
                return bars
        bars = await self.yahoo_chart.fetch_ohlcv(symbol, asset_class, iv, lb)
        if bars:
            return bars
        bars = await self.yf.fetch_ohlcv(symbol, asset_class, iv, lb)
        if bars:
            return bars
        return await self.stooq.fetch_ohlcv(symbol, asset_class, iv, lb)

    async def fetch_fundamentals(self, symbol: str, asset_class: AssetClass) -> dict:
        """Best-effort fundamentals (stocks/ETFs via yfinance; crypto keeps funding later)."""
        if asset_class == AssetClass.crypto:
            return {}
        try:
            q = await self.yf.fetch_quote(symbol, asset_class)
            return dict(q.fundamentals or {})
        except Exception:
            return {}

    async def fetch_quote(self, symbol: str, asset_class: AssetClass) -> QuoteSnapshot:
        if asset_class == AssetClass.crypto:
            try:
                from app.services.crypto_market import get_crypto_market

                agg = await get_crypto_market().fetch_aggregated_quote(symbol)
                snap = get_crypto_market().as_quote_snapshot(agg)
                if snap.price is not None:
                    return snap
            except Exception:
                pass
            q = await self.ccxt.fetch_quote(symbol, asset_class)
            if q.price is not None:
                return q

        price_q: QuoteSnapshot | None = None
        chart_q = await self.yahoo_chart.fetch_quote(symbol, asset_class)
        if chart_q.price is not None:
            price_q = chart_q
        else:
            yf_q = await self.yf.fetch_quote(symbol, asset_class)
            if yf_q.price is not None:
                # Already has fundamentals
                return yf_q
            stooq_q = await self.stooq.fetch_quote(symbol, asset_class)
            if stooq_q.price is not None:
                price_q = stooq_q
            else:
                return stooq_q

        # Merge yfinance fundamentals onto fast price quote (Yahoo chart has none).
        fund = await self.fetch_fundamentals(symbol, asset_class)
        if not fund and price_q.source == "yfinance":
            return price_q
        merged_fund = {**(price_q.fundamentals or {}), **fund}
        dq = price_q.data_quality
        if merged_fund.get("market_cap") and (merged_fund.get("pe") or merged_fund.get("sector")):
            if dq in (DataQuality.medium, DataQuality.low, DataQuality.proxy):
                dq = DataQuality.high if price_q.source in ("yahoo_chart", "yfinance") else dq
        return QuoteSnapshot(
            symbol=price_q.symbol,
            price=price_q.price,
            change_pct=price_q.change_pct,
            source=f"{price_q.source}+yf_fund" if fund else price_q.source,
            data_quality=dq,
            as_of=price_q.as_of,
            fundamentals=merged_fund,
        )


market_data = CompositeMarketData()
