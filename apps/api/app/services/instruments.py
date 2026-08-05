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
    ("GLD", "SPDR Gold", AssetClass.commodity),
    ("SLV", "iShares Silver", AssetClass.commodity),
    ("USO", "United States Oil", AssetClass.commodity),
    ("BTC-USD", "Bitcoin", AssetClass.crypto),
    ("ETH-USD", "Ethereum", AssetClass.crypto),
    ("SOL-USD", "Solana", AssetClass.crypto),
    ("AAPL", "Apple", AssetClass.stock),
    ("MSFT", "Microsoft", AssetClass.stock),
    ("NVDA", "NVIDIA", AssetClass.stock),
    ("AMZN", "Amazon", AssetClass.stock),
    ("GOOGL", "Alphabet", AssetClass.stock),
]


async def ensure_discovery_universe(db: AsyncSession) -> None:
    for symbol, name, asset_class in DISCOVERY_SEED:
        await get_or_create_instrument(
            db, symbol=symbol, name=name, asset_class=asset_class, is_discovery=True
        )
    await db.commit()
