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
    """Public-market CCXT pool. Live quotes from N exchanges; OHLCV from primary."""

    def __init__(self) -> None:
        settings = get_settings()
        raw = [x.strip().lower() for x in settings.ccxt_exchanges.split(",") if x.strip()]
        self.exchange_ids = raw or ["binance"]
        self.primary = (settings.ccxt_primary or self.exchange_ids[0]).strip().lower()
        if self.primary not in self.exchange_ids:
            self.exchange_ids.insert(0, self.primary)
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
            # try USD quote for coinbase/kraken style
            alt = market.replace("/USDT", "/USD")
            if alt in markets:
                return alt
            # base only search
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
        primary = next((r for r in rows if r.exchange == self.primary and r.ok), None)
        if primary is None:
            primary = next((r for r in rows if r.ok), None)

        best_bid = max(bids) if bids else None
        best_ask = min(asks) if asks else None
        spread = None
        if best_bid and best_ask and best_bid > 0:
            spread = ((best_ask - best_bid) / best_bid) * 100

        change = primary.change_pct if primary else None
        if change is None:
            changes = [r.change_pct for r in rows if r.change_pct is not None]
            change = median(changes) if changes else None

        return AggregatedCryptoQuote(
            symbol=symbol,
            primary_exchange=self.primary,
            primary_price=primary.price if primary else None,
            median_price=float(median(ok_prices)) if ok_prices else None,
            best_bid=best_bid,
            best_ask=best_ask,
            spread_pct=spread,
            change_pct=change,
            exchanges=list(rows),
            as_of=datetime.now(timezone.utc),
        )

    def _fetch_ohlcv_sync(
        self, symbol: str, interval: str = "1d", limit: int = 180
    ) -> list[OhlcvBar]:
        client = self._get_client(self.primary)
        market = self._resolve_market(client, symbol)
        tf_map = {"15m": "15m", "1h": "1h", "4h": "4h", "1d": "1d", "1wk": "1w"}
        timeframe = tf_map.get(interval, "1d")
        raw = client.fetch_ohlcv(market, timeframe=timeframe, limit=limit)
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
                    source=f"ccxt:{self.primary}",
                    data_quality=DataQuality.high,
                )
            )
        return bars

    async def fetch_ohlcv(
        self, symbol: str, interval: str = "1d", lookback: str = "6mo"
    ) -> list[OhlcvBar]:
        limit_map = {"15m": 288, "1h": 336, "4h": 180, "1d": 365, "1wk": 260}
        limit = limit_map.get(interval, 180)
        return await asyncio.to_thread(self._fetch_ohlcv_sync, _normalize_market(symbol), interval, limit)

    async def overview(self, symbols: list[str] | None = None) -> dict:
        symbols = symbols or list(DEFAULT_CRYPTO_SYMBOLS)
        quotes = await asyncio.gather(*[self.fetch_aggregated_quote(s) for s in symbols])
        return {
            "primary_exchange": self.primary,
            "exchanges": self.exchange_ids,
            "as_of": datetime.now(timezone.utc).isoformat(),
            "quotes": [self._agg_to_dict(q) for q in quotes],
        }

    def health(self) -> dict:
        return {
            "primary_exchange": self.primary,
            "exchanges": self.exchange_ids,
            "default_symbols": list(DEFAULT_CRYPTO_SYMBOLS),
        }

    @staticmethod
    def _agg_to_dict(q: AggregatedCryptoQuote) -> dict:
        return {
            "symbol": q.symbol,
            "primary_exchange": q.primary_exchange,
            "primary_price": q.primary_price,
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
        price = q.primary_price if q.primary_price is not None else q.median_price
        return QuoteSnapshot(
            symbol=q.symbol,
            price=price,
            change_pct=q.change_pct,
            source=f"ccxt:{q.primary_exchange}+multi",
            data_quality=DataQuality.high if price is not None else DataQuality.unavailable,
            as_of=q.as_of,
            fundamentals={
                "median_price": q.median_price,
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
