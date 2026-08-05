from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AssetClass, Instrument


async def get_or_create_instrument(
    db: AsyncSession,
    *,
    symbol: str,
    name: str = "",
    asset_class: AssetClass = AssetClass.stock,
    exchange: str | None = None,
    currency: str = "USD",
    is_discovery: bool = False,
) -> Instrument:
    sym = symbol.strip().upper()
    result = await db.execute(select(Instrument).where(Instrument.symbol == sym))
    inst = result.scalar_one_or_none()
    if inst:
        if name and not inst.name:
            inst.name = name
        return inst
    inst = Instrument(
        symbol=sym,
        name=name or sym,
        asset_class=asset_class,
        exchange=exchange,
        currency=currency,
        is_discovery=is_discovery,
    )
    db.add(inst)
    await db.flush()
    return inst


DISCOVERY_SEED = [
    ("SPY", "SPDR S&P 500 ETF", AssetClass.etf),
    ("QQQ", "Invesco QQQ", AssetClass.etf),
    ("IWM", "iShares Russell 2000", AssetClass.etf),
    ("EFA", "iShares MSCI EAFE", AssetClass.etf),
    ("DIA", "SPDR Dow Jones", AssetClass.etf),
    ("VTI", "Vanguard Total Stock", AssetClass.etf),
    ("XLF", "Financial Select Sector", AssetClass.etf),
    ("XLK", "Technology Select Sector", AssetClass.etf),
    ("XLE", "Energy Select Sector", AssetClass.etf),
    ("GLD", "SPDR Gold", AssetClass.commodity),
    ("SLV", "iShares Silver", AssetClass.commodity),
    ("USO", "United States Oil", AssetClass.commodity),
    ("UNG", "United States Natural Gas", AssetClass.commodity),
    ("DBC", "Invesco DB Commodity", AssetClass.commodity),
    ("BTC-USD", "Bitcoin", AssetClass.crypto),
    ("ETH-USD", "Ethereum", AssetClass.crypto),
    ("SOL-USD", "Solana", AssetClass.crypto),
    ("XRP-USD", "XRP", AssetClass.crypto),
    ("ADA-USD", "Cardano", AssetClass.crypto),
    ("DOGE-USD", "Dogecoin", AssetClass.crypto),
    ("AAPL", "Apple", AssetClass.stock),
    ("MSFT", "Microsoft", AssetClass.stock),
    ("NVDA", "NVIDIA", AssetClass.stock),
    ("AMZN", "Amazon", AssetClass.stock),
    ("GOOGL", "Alphabet", AssetClass.stock),
    ("META", "Meta Platforms", AssetClass.stock),
    ("TSLA", "Tesla", AssetClass.stock),
    ("BRK-B", "Berkshire Hathaway", AssetClass.stock),
    ("JPM", "JPMorgan Chase", AssetClass.stock),
    ("V", "Visa", AssetClass.stock),
    ("MA", "Mastercard", AssetClass.stock),
    ("UNH", "UnitedHealth", AssetClass.stock),
    ("XOM", "Exxon Mobil", AssetClass.stock),
    ("JNJ", "Johnson & Johnson", AssetClass.stock),
    ("AMD", "Advanced Micro Devices", AssetClass.stock),
    ("NFLX", "Netflix", AssetClass.stock),
    ("COST", "Costco", AssetClass.stock),
    ("AVGO", "Broadcom", AssetClass.stock),
]


async def ensure_discovery_universe(db: AsyncSession) -> None:
    for symbol, name, asset_class in DISCOVERY_SEED:
        await get_or_create_instrument(
            db, symbol=symbol, name=name, asset_class=asset_class, is_discovery=True
        )
    await db.commit()


def _guess_asset_class(quote_type: str | None, symbol: str) -> AssetClass:
    qt = (quote_type or "").upper()
    sym = symbol.upper()
    if "CRYPTO" in qt or sym.endswith("-USD"):
        return AssetClass.crypto
    if "ETF" in qt:
        return AssetClass.etf
    if "INDEX" in qt:
        return AssetClass.index
    if "FUTURE" in qt or "COMMODITY" in qt:
        return AssetClass.commodity
    if "EQUITY" in qt or "STOCK" in qt:
        return AssetClass.stock
    return AssetClass.other


async def search_instruments(db: AsyncSession, query: str, limit: int = 10) -> list[dict]:
    q = query.strip()
    if len(q) < 1:
        return []

    # 1) Local DB (watchlist/portfolio/discovery)
    pattern = f"%{q.upper()}%"
    rows = (
        await db.execute(
            select(Instrument)
            .where(
                (Instrument.symbol.ilike(pattern)) | (Instrument.name.ilike(f"%{q}%"))
            )
            .order_by(Instrument.symbol.asc())
            .limit(limit)
        )
    ).scalars().all()

    seen: set[str] = set()
    out: list[dict] = []
    for inst in rows:
        seen.add(inst.symbol.upper())
        out.append(
            {
                "symbol": inst.symbol,
                "name": inst.name,
                "asset_class": inst.asset_class.value,
                "currency": (inst.currency or "USD").upper(),
                "exchange": inst.exchange,
                "source": "db",
            }
        )

    if len(out) >= limit:
        return out[:limit]

    # 2) Yahoo finance search (broader universe)
    import httpx

    try:
        async with httpx.AsyncClient(timeout=8.0, headers={"User-Agent": "Mozilla/5.0 StockSense/1.0"}) as client:
            resp = await client.get(
                "https://query1.finance.yahoo.com/v1/finance/search",
                params={"q": q, "quotesCount": limit, "newsCount": 0},
            )
            if resp.status_code == 200:
                for item in (resp.json().get("quotes") or []):
                    symbol = (item.get("symbol") or "").upper()
                    if not symbol or symbol in seen:
                        continue
                    # Skip options/weird contracts
                    if len(symbol) > 16 or any(ch in symbol for ch in ("=", "^")):
                        if not symbol.startswith("^"):
                            continue
                    asset = _guess_asset_class(item.get("quoteType"), symbol)
                    from app.services.fx import guess_currency

                    currency = (item.get("currency") or "").upper() or guess_currency(
                        symbol, item.get("exchDisp") or item.get("exchange")
                    )
                    out.append(
                        {
                            "symbol": symbol,
                            "name": item.get("shortname") or item.get("longname") or symbol,
                            "asset_class": asset.value,
                            "currency": currency,
                            "exchange": item.get("exchDisp") or item.get("exchange"),
                            "source": "yahoo",
                        }
                    )
                    seen.add(symbol)
                    if len(out) >= limit:
                        break
    except Exception:
        pass

    return out[:limit]