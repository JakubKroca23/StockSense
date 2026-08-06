"""CryptoSense market layer — multi-exchange CCXT quotes + canonical OHLCV."""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from statistics import median

from app.core.config import get_settings
from app.models import DataQuality
from app.services.market_data import OhlcvBar, QuoteSnapshot

logger = logging.getLogger(__name__)

DEFAULT_CRYPTO_SYMBOLS = (
    "BTC/USDT",
    "ETH/USDT",
    "SOL/USDT",
    "XRP/USDT",
    "BNB/USDT",
    "DOGE/USDT",
)


@dataclass
class ExchangeQuote:
    exchange: str
    symbol: str
    market: str
    price: float | None
    bid: float | None
    ask: float | None
    change_pct: float | None
    volume_24h: float | None
    ok: bool
    error: str | None
    as_of: datetime


@dataclass
class AggregatedCryptoQuote:
    symbol: str
    primary_exchange: str
    primary_price: float | None
    median_price: float | None
    best_bid: float | None
    best_ask: float | None
    spread_pct: float | None
    change_pct: float | None
    exchanges: list[ExchangeQuote]
    as_of: datetime


def _normalize_market(symbol: str, quote: str = "USDT") -> str:
    s = symbol.upper().strip().replace("-", "/")
    if "/" in s:
        return s
    if s.endswith("USDT") or s.endswith("USD"):
        base = s[:-4] if s.endswith("USDT") else s[:-3]
        return f"{base}/{quote if s.endswith('USDT') else 'USD'}"
    return f"{s}/{quote}"


class MultiExchangeCcxt:
    """Public-market CCXT pool.

    Quotes + chart OHLCV: aggregate across ``exchange_ids`` (Binance + Bybit).
    Bot / execution quotes: ``execution`` exchange (Bybit).
    """

    def __init__(self) -> None:
        settings = get_settings()
        raw = [x.strip().lower() for x in settings.ccxt_exchanges.split(",") if x.strip()]
        # Hard-limit to the two venues we care about
        allowed = {"binance", "bybit"}
        self.exchange_ids = [x for x in raw if x in allowed] or ["binance", "bybit"]
        for must in ("binance", "bybit"):
            if must not in self.exchange_ids:
                self.exchange_ids.append(must)
        self.execution = (
            settings.ccxt_execution or settings.ccxt_primary or "bybit"
        ).strip().lower()
        if self.execution not in allowed:
            self.execution = "bybit"
        if self.execution not in self.exchange_ids:
            self.exchange_ids.append(self.execution)
        # primary == execution (bot venue); charts use aggregate helpers
        self.primary = self.execution
        self._clients: dict[str, object] = {}

    def _get_client(self, exchange_id: str):
        if exchange_id in self._clients:
            return self._clients[exchange_id]
        import ccxt

        if not hasattr(ccxt, exchange_id):
            raise ValueError(f"Neznámá CCXT burza: {exchange_id}")
        cls = getattr(ccxt, exchange_id)
        client = cls({"enableRateLimit": True, "timeout": 15000})
        self._clients[exchange_id] = client
        return client

    def _resolve_market(self, client, symbol: str) -> str:
        market = _normalize_market(symbol)
        try:
            if not getattr(client, "markets", None):
                client.load_markets()
            markets = client.markets or {}
            if market in markets:
                return market
            alt = market.replace("/USDT", "/USD")
            if alt in markets:
                return alt
            base = market.split("/")[0]
            for m in markets:
                if m.startswith(f"{base}/") and markets[m].get("active", True):
                    if m.endswith("/USDT") or m.endswith("/USD"):
                        return m
        except Exception as exc:
            logger.debug("load_markets %s failed: %s", getattr(client, "id", "?"), exc)
        return market

    def _fetch_ticker_sync(self, exchange_id: str, symbol: str) -> ExchangeQuote:
        now = datetime.now(timezone.utc)
        try:
            client = self._get_client(exchange_id)
            market = self._resolve_market(client, symbol)
            ticker = client.fetch_ticker(market)
            last = ticker.get("last")
            bid = ticker.get("bid")
            ask = ticker.get("ask")
            return ExchangeQuote(
                exchange=exchange_id,
                symbol=symbol,
                market=market,
                price=float(last) if last is not None else None,
                bid=float(bid) if bid is not None else None,
                ask=float(ask) if ask is not None else None,
                change_pct=float(ticker["percentage"]) if ticker.get("percentage") is not None else None,
                volume_24h=float(ticker["quoteVolume"]) if ticker.get("quoteVolume") is not None else (
                    float(ticker["baseVolume"]) if ticker.get("baseVolume") is not None else None
                ),
                ok=last is not None,
                error=None,
                as_of=now,
            )
        except Exception as exc:
            logger.warning("CCXT %s quote %s failed: %s", exchange_id, symbol, exc)
            return ExchangeQuote(
                exchange=exchange_id,
                symbol=symbol,
                market=_normalize_market(symbol),
                price=None,
                bid=None,
                ask=None,
                change_pct=None,
                volume_24h=None,
                ok=False,
                error=str(exc)[:180],
                as_of=now,
            )

    async def fetch_exchange_quote(self, exchange_id: str, symbol: str) -> ExchangeQuote:
        return await asyncio.to_thread(self._fetch_ticker_sync, exchange_id, symbol)

    async def fetch_aggregated_quote(self, symbol: str) -> AggregatedCryptoQuote:
        symbol = _normalize_market(symbol)
        rows = await asyncio.gather(
            *[self.fetch_exchange_quote(ex, symbol) for ex in self.exchange_ids]
        )
        ok_prices = [r.price for r in rows if r.ok and r.price is not None]
        bids = [r.bid for r in rows if r.bid is not None]
        asks = [r.ask for r in rows if r.ask is not None]
        execution = next((r for r in rows if r.exchange == self.execution and r.ok), None)
        if execution is None:
            execution = next((r for r in rows if r.ok), None)

        best_bid = max(bids) if bids else None
        best_ask = min(asks) if asks else None
        spread = None
        if best_bid and best_ask and best_bid > 0:
            spread = ((best_ask - best_bid) / best_bid) * 100

        changes = [r.change_pct for r in rows if r.change_pct is not None]
        change = float(median(changes)) if changes else (execution.change_pct if execution else None)

        return AggregatedCryptoQuote(
            symbol=symbol,
            primary_exchange=self.execution,
            primary_price=execution.price if execution else None,
            median_price=float(median(ok_prices)) if ok_prices else None,
            best_bid=best_bid,
            best_ask=best_ask,
            spread_pct=spread,
            change_pct=change,
            exchanges=list(rows),
            as_of=datetime.now(timezone.utc),
        )

    def _fetch_ohlcv_exchange_sync(
        self, exchange_id: str, symbol: str, interval: str = "1d", limit: int = 180
    ) -> list[OhlcvBar]:
        client = self._get_client(exchange_id)
        market = self._resolve_market(client, symbol)
        tf_map = {
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
        timeframe = tf_map.get(interval, "1d")
        try:
            raw = client.fetch_ohlcv(market, timeframe=timeframe, limit=limit)
        except Exception as exc:
            if interval == "1s":
                logger.info("1s OHLCV unavailable on %s (%s) — building from trades", exchange_id, exc)
                return self._ohlcv_from_trades_sync(client, market, limit=limit, exchange_id=exchange_id)
            logger.warning("OHLCV %s %s %s failed: %s", exchange_id, symbol, interval, exc)
            return []
        if not raw and interval == "1s":
            return self._ohlcv_from_trades_sync(client, market, limit=limit, exchange_id=exchange_id)
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
                    source=f"ccxt:{exchange_id}",
                    data_quality=DataQuality.high,
                )
            )
        return bars

    def _ohlcv_from_trades_sync(
        self, client, market: str, limit: int = 300, exchange_id: str = "unknown"
    ) -> list[OhlcvBar]:
        """Synthesize 1s candles from recent trades when exchange has no 1s klines."""
        trades = client.fetch_trades(market, limit=min(1000, max(limit * 3, 200)))
        buckets: dict[int, list] = {}
        for t in trades or []:
            ts_ms = int(t.get("timestamp") or 0)
            if not ts_ms:
                continue
            sec = ts_ms // 1000
            price = float(t.get("price") or 0)
            amount = float(t.get("amount") or 0)
            if price <= 0:
                continue
            buckets.setdefault(sec, []).append((price, amount))
        bars: list[OhlcvBar] = []
        for sec in sorted(buckets.keys()):
            rows = buckets[sec]
            prices = [p for p, _ in rows]
            vol = sum(a for _, a in rows)
            bars.append(
                OhlcvBar(
                    ts=datetime.fromtimestamp(sec, tz=timezone.utc),
                    open=prices[0],
                    high=max(prices),
                    low=min(prices),
                    close=prices[-1],
                    volume=vol,
                    source=f"ccxt:{exchange_id}:trades1s",
                    data_quality=DataQuality.medium,
                )
            )
        if limit and len(bars) > limit:
            bars = bars[-limit:]
        return bars

    @staticmethod
    def _aggregate_ohlcv_series(series: list[list[OhlcvBar]]) -> list[OhlcvBar]:
        """Merge same-timestamp candles: median OHLC, sum volume."""
        by_ts: dict[datetime, list[OhlcvBar]] = {}
        for bars in series:
            for b in bars:
                by_ts.setdefault(b.ts, []).append(b)
        out: list[OhlcvBar] = []
        for ts in sorted(by_ts.keys()):
            group = by_ts[ts]
            opens = [g.open for g in group]
            highs = [g.high for g in group]
            lows = [g.low for g in group]
            closes = [g.close for g in group]
            vols = [g.volume for g in group]
            sources = sorted({(g.source or "").split(":")[1] for g in group if g.source})
            src = "agg:" + "+".join(sources) if sources else "agg:binance+bybit"
            out.append(
                OhlcvBar(
                    ts=ts,
                    open=float(median(opens)),
                    high=max(highs),
                    low=min(lows),
                    close=float(median(closes)),
                    volume=float(sum(vols)),
                    source=src,
                    data_quality=DataQuality.high if len(group) >= 2 else DataQuality.medium,
                )
            )
        return out

    def _fetch_ohlcv_sync(
        self, symbol: str, interval: str = "1d", limit: int = 180
    ) -> list[OhlcvBar]:
        """Aggregated OHLCV across Binance + Bybit (chart data)."""
        from concurrent.futures import ThreadPoolExecutor

        with ThreadPoolExecutor(max_workers=len(self.exchange_ids) or 2) as pool:
            futures = [
                pool.submit(self._fetch_ohlcv_exchange_sync, ex, symbol, interval, limit)
                for ex in self.exchange_ids
            ]
            series = [f.result() for f in futures]
        series = [s for s in series if s]
        if not series:
            return []
        if len(series) == 1:
            return series[0][-limit:] if limit else series[0]
        agg = self._aggregate_ohlcv_series(series)
        return agg[-limit:] if limit else agg

    def _fetch_ohlcv_execution_sync(
        self, symbol: str, interval: str = "1d", limit: int = 180
    ) -> list[OhlcvBar]:
        """Single-venue OHLCV for the bot (Bybit)."""
        return self._fetch_ohlcv_exchange_sync(
            self.execution, symbol, interval=interval, limit=limit
        )

    async def fetch_ohlcv(
        self, symbol: str, interval: str = "1d", lookback: str = "6mo"
    ) -> list[OhlcvBar]:
        """Chart OHLCV — aggregated Binance + Bybit."""
        limit_map = {
            "1s": 300,
            "1m": 240,
            "5m": 288,
            "15m": 288,
            "30m": 240,
            "1h": 336,
            "4h": 180,
            "1d": 365,
            "1wk": 260,
        }
        limit = limit_map.get(interval, 180)
        return await asyncio.to_thread(
            self._fetch_ohlcv_sync, _normalize_market(symbol), interval, limit
        )

    async def fetch_ohlcv_execution(
        self, symbol: str, interval: str = "1d", lookback: str = "6mo"
    ) -> list[OhlcvBar]:
        """Bot OHLCV — Bybit only."""
        limit_map = {
            "1s": 300,
            "1m": 240,
            "5m": 288,
            "15m": 288,
            "30m": 240,
            "1h": 336,
            "4h": 180,
            "1d": 365,
            "1wk": 260,
        }
        limit = limit_map.get(interval, 180)
        return await asyncio.to_thread(
            self._fetch_ohlcv_execution_sync, _normalize_market(symbol), interval, limit
        )

    def _tick_size(self, price: float, *, fine: bool = False) -> float:
        if price >= 10_000:
            tick = 1.0
        elif price >= 1_000:
            tick = 0.5
        elif price >= 100:
            tick = 0.1
        elif price >= 10:
            tick = 0.01
        elif price >= 1:
            tick = 0.001
        else:
            tick = 0.0001
        if fine:
            tick = tick / 2.0
        return tick

    def _fetch_order_book_sync(self, exchange_id: str, symbol: str, limit: int = 50) -> dict:
        try:
            client = self._get_client(exchange_id)
            market = self._resolve_market(client, symbol)
            # Exchanges typically allow 5–1000; ask high and trim later.
            raw = client.fetch_order_book(market, limit=min(max(int(limit), 5), 1000))
            bids = [[float(p), float(a)] for p, a in (raw.get("bids") or []) if p and a]
            asks = [[float(p), float(a)] for p, a in (raw.get("asks") or []) if p and a]
            return {
                "exchange": exchange_id,
                "market": market,
                "bids": bids,
                "asks": asks,
                "ok": bool(bids or asks),
                "error": None,
                "as_of": datetime.now(timezone.utc).isoformat(),
            }
        except Exception as exc:
            logger.warning("order book %s %s failed: %s", exchange_id, symbol, exc)
            return {
                "exchange": exchange_id,
                "market": _normalize_market(symbol),
                "bids": [],
                "asks": [],
                "ok": False,
                "error": str(exc)[:180],
                "as_of": datetime.now(timezone.utc).isoformat(),
            }

    async def fetch_aggregated_order_book(self, symbol: str, limit: int = 100) -> dict:
        """Aggregate L2 books from Binance + Bybit into one depth ladder."""
        sym = _normalize_market(symbol)
        lim = max(10, min(int(limit), 500))
        books = await asyncio.gather(
            *[asyncio.to_thread(self._fetch_order_book_sync, ex, sym, lim) for ex in self.exchange_ids]
        )

        mid_candidates: list[float] = []
        for b in books:
            if b["bids"]:
                mid_candidates.append(b["bids"][0][0])
            if b["asks"]:
                mid_candidates.append(b["asks"][0][0])
        mid = float(median(mid_candidates)) if mid_candidates else 0.0
        # Finer buckets when deep book — better walls / stop clusters for heatmap.
        tick = self._tick_size(mid, fine=lim >= 80) if mid > 0 else 0.01

        def bucket(price: float) -> float:
            return round(round(price / tick) * tick, 10)

        bid_map: dict[float, float] = {}
        ask_map: dict[float, float] = {}
        for book in books:
            if not book.get("ok"):
                continue
            for price, amount in book["bids"]:
                p = bucket(price)
                bid_map[p] = bid_map.get(p, 0.0) + amount
            for price, amount in book["asks"]:
                p = bucket(price)
                ask_map[p] = ask_map.get(p, 0.0) + amount

        bids = sorted(bid_map.items(), key=lambda x: x[0], reverse=True)[:lim]
        asks = sorted(ask_map.items(), key=lambda x: x[0])[:lim]

        best_bid = bids[0][0] if bids else None
        best_ask = asks[0][0] if asks else None
        spread = None
        spread_pct = None
        if best_bid and best_ask and best_bid > 0:
            spread = best_ask - best_bid
            spread_pct = (spread / best_bid) * 100

        bid_cum = 0.0
        bid_levels = []
        for price, amount in bids:
            bid_cum += amount
            bid_levels.append({"price": price, "amount": amount, "total": bid_cum, "side": "bid"})

        ask_cum = 0.0
        ask_levels = []
        for price, amount in asks:
            ask_cum += amount
            ask_levels.append({"price": price, "amount": amount, "total": ask_cum, "side": "ask"})

        return {
            "symbol": sym,
            "tick": tick,
            "mid": mid or None,
            "best_bid": best_bid,
            "best_ask": best_ask,
            "spread": spread,
            "spread_pct": spread_pct,
            "exchanges": self.exchange_ids,
            "execution_exchange": self.execution,
            "chart_mode": "aggregated",
            "books": list(books),
            "bids": bid_levels,
            "asks": ask_levels,
            "as_of": datetime.now(timezone.utc).isoformat(),
        }

    async def overview(self, symbols: list[str] | None = None) -> dict:
        symbols = symbols or list(DEFAULT_CRYPTO_SYMBOLS)
        quotes = await asyncio.gather(*[self.fetch_aggregated_quote(s) for s in symbols])
        return {
            "primary_exchange": self.primary,
            "execution_exchange": self.execution,
            "chart_mode": "aggregated",
            "exchanges": self.exchange_ids,
            "as_of": datetime.now(timezone.utc).isoformat(),
            "quotes": [self._agg_to_dict(q) for q in quotes],
        }

    def health(self) -> dict:
        return {
            "primary_exchange": self.primary,
            "execution_exchange": self.execution,
            "chart_mode": "aggregated",
            "exchanges": self.exchange_ids,
            "default_symbols": list(DEFAULT_CRYPTO_SYMBOLS),
        }

    @staticmethod
    def _agg_to_dict(q: AggregatedCryptoQuote) -> dict:
        return {
            "symbol": q.symbol,
            "primary_exchange": q.primary_exchange,
            "execution_price": q.primary_price,
            "primary_price": q.median_price if q.median_price is not None else q.primary_price,
            "median_price": q.median_price,
            "best_bid": q.best_bid,
            "best_ask": q.best_ask,
            "spread_pct": q.spread_pct,
            "change_pct": q.change_pct,
            "as_of": q.as_of.isoformat(),
            "exchanges": [
                {
                    "exchange": e.exchange,
                    "market": e.market,
                    "price": e.price,
                    "bid": e.bid,
                    "ask": e.ask,
                    "change_pct": e.change_pct,
                    "volume_24h": e.volume_24h,
                    "ok": e.ok,
                    "error": e.error,
                    "as_of": e.as_of.isoformat(),
                }
                for e in q.exchanges
            ],
        }

    def as_quote_snapshot(self, q: AggregatedCryptoQuote) -> QuoteSnapshot:
        # Prefer aggregated median for analytics; bot should call execution venue explicitly.
        price = q.median_price if q.median_price is not None else q.primary_price
        return QuoteSnapshot(
            symbol=q.symbol,
            price=price,
            change_pct=q.change_pct,
            source="ccxt:agg:binance+bybit",
            data_quality=DataQuality.high if price is not None else DataQuality.unavailable,
            as_of=q.as_of,
            fundamentals={
                "median_price": q.median_price,
                "execution_exchange": self.execution,
                "execution_price": q.primary_price,
                "best_bid": q.best_bid,
                "best_ask": q.best_ask,
                "spread_pct": q.spread_pct,
                "exchanges_ok": sum(1 for e in q.exchanges if e.ok),
            },
        )


_crypto_market: MultiExchangeCcxt | None = None


def get_crypto_market() -> MultiExchangeCcxt:
    global _crypto_market
    if _crypto_market is None:
        _crypto_market = MultiExchangeCcxt()
    return _crypto_market


async def persist_crypto_ohlcv(
    db,
    *,
    symbol: str,
    interval: str = "1d",
    limit: int = 180,
) -> dict:
    """Fetch aggregated OHLCV (Binance + Bybit) and upsert into price_bars."""
    from sqlalchemy import select

    from app.models import AssetClass, PriceBar
    from app.services.instruments import get_or_create_instrument

    market = get_crypto_market()
    sym = _normalize_market(symbol)
    bars = await market.fetch_ohlcv(sym, interval=interval, lookback="6mo")
    if limit and len(bars) > limit:
        bars = bars[-limit:]

    base = sym.split("/")[0]
    inst = await get_or_create_instrument(
        db,
        symbol=sym,
        name=base,
        asset_class=AssetClass.crypto,
        exchange=market.execution,
        currency=sym.split("/")[-1] if "/" in sym else "USDT",
        is_discovery=True,
    )

    inserted = 0
    updated = 0
    now = datetime.now(timezone.utc)
    for bar in bars:
        existing = (
            await db.execute(
                select(PriceBar).where(
                    PriceBar.instrument_id == inst.id,
                    PriceBar.interval == interval,
                    PriceBar.ts == bar.ts,
                )
            )
        ).scalar_one_or_none()
        if existing:
            existing.open = bar.open
            existing.high = bar.high
            existing.low = bar.low
            existing.close = bar.close
            existing.volume = bar.volume
            existing.source = bar.source
            existing.data_quality = bar.data_quality
            existing.as_of = now
            updated += 1
        else:
            db.add(
                PriceBar(
                    instrument_id=inst.id,
                    interval=interval,
                    ts=bar.ts,
                    open=bar.open,
                    high=bar.high,
                    low=bar.low,
                    close=bar.close,
                    volume=bar.volume,
                    source=bar.source,
                    data_quality=bar.data_quality,
                    as_of=now,
                )
            )
            inserted += 1
    await db.commit()

    return {
        "symbol": sym,
        "instrument_id": inst.id,
        "interval": interval,
        "primary_exchange": market.primary,
        "execution_exchange": market.execution,
        "chart_mode": "aggregated",
        "bars": len(bars),
        "inserted": inserted,
        "updated": updated,
        "ohlcv": [
            {
                "ts": b.ts.isoformat(),
                "open": b.open,
                "high": b.high,
                "low": b.low,
                "close": b.close,
                "volume": b.volume,
                "source": b.source,
                "data_quality": b.data_quality.value
                if hasattr(b.data_quality, "value")
                else str(b.data_quality),
            }
            for b in bars
        ],
    }
