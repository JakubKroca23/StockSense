from datetime import datetime, timezone
import asyncio

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.auth import AuthUser, get_current_user
from app.core.config import get_settings
from app.core.database import get_db
from app.models import (
    Alert,
    PortfolioPosition,
    PortfolioSnapshot,
    PriceAlertRule,
    PriceBar,
    RiskProfile,
    UserSettings,
    Watchlist,
    WatchlistItem,
)
from app.schemas import (
    AlertOut,
    EquityPointOut,
    InstrumentOut,
    MacroPointOut,
    PortfolioPositionCreate,
    PortfolioPositionOut,
    PortfolioPositionUpdate,
    PriceAlertRuleCreate,
    PriceAlertRuleOut,
    PriceBarOut,
    UserSettingsOut,
    UserSettingsUpdate,
    WatchlistAddItem,
    WatchlistCreate,
    WatchlistDigestItem,
    WatchlistDigestOut,
    WatchlistOut,
)
from app.services.fundament_macro import (
    fetch_edgar_recent_filings,
    fetch_yahoo_headlines,
)
from app.services.instruments import get_or_create_instrument
from app.services.market_data import market_data
from app.workers.jobs import snapshot_portfolio

router = APIRouter()


async def _ensure_settings(db: AsyncSession, user: AuthUser) -> UserSettings:
    row = (
        await db.execute(select(UserSettings).where(UserSettings.user_id == user.id))
    ).scalar_one_or_none()
    if row:
        return row
    row = UserSettings(user_id=user.id, email=user.email, risk_profile=RiskProfile.balanced)
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


def _settings_out(row: UserSettings) -> UserSettingsOut:
    cfg = get_settings()
    sub = row.push_subscription or {}
    push_ok = bool(sub.get("endpoint") and sub.get("keys"))
    out = UserSettingsOut.model_validate(row)
    out.push_configured = push_ok
    out.vapid_public_key = cfg.vapid_public_key or None
    return out



async def _ensure_default_watchlist(db: AsyncSession, user_id: str) -> Watchlist:
    row = (
        await db.execute(
            select(Watchlist)
            .where(Watchlist.user_id == user_id)
            .options(selectinload(Watchlist.items).selectinload(WatchlistItem.instrument))
        )
    ).scalars().first()
    if row:
        return row
    row = Watchlist(user_id=user_id, name="Hlavní")
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return (
        await db.execute(
            select(Watchlist)
            .where(Watchlist.id == row.id)
            .options(selectinload(Watchlist.items).selectinload(WatchlistItem.instrument))
        )
    ).scalar_one()


async def _portfolio_with_marks(
    db: AsyncSession, user_id: str
) -> list[PortfolioPositionOut]:
    rows = (
        await db.execute(
            select(PortfolioPosition)
            .where(PortfolioPosition.user_id == user_id)
            .options(selectinload(PortfolioPosition.instrument))
        )
    ).scalars().all()
    if not rows:
        return []

    instrument_ids = list({p.instrument_id for p in rows})
    # One query for latest 1d close per instrument (avoids N+1 on homepage).
    latest_rows = (
        await db.execute(
            select(PriceBar.instrument_id, PriceBar.close)
            .where(
                PriceBar.instrument_id.in_(instrument_ids),
                PriceBar.interval == "1d",
            )
            .distinct(PriceBar.instrument_id)
            .order_by(PriceBar.instrument_id, PriceBar.ts.desc())
        )
    ).all()
    last_by_inst = {int(iid): float(close) for iid, close in latest_rows}

    out: list[PortfolioPositionOut] = []
    for p in rows:
        last_price = last_by_inst.get(p.instrument_id)
        qty = float(p.quantity)
        cost = float(p.avg_cost)
        mv = last_price * qty if last_price is not None else None
        pnl = (last_price - cost) * qty if last_price is not None else None
        pnl_pct = ((last_price - cost) / cost * 100) if last_price is not None and cost else None
        out.append(
            PortfolioPositionOut(
                id=p.id,
                instrument=InstrumentOut.model_validate(p.instrument),
                quantity=p.quantity,
                avg_cost=p.avg_cost,
                opened_at=p.opened_at,
                is_paper=p.is_paper,
                notes=p.notes,
                last_price=last_price,
                market_value=mv,
                pnl=pnl,
                pnl_pct=pnl_pct,
            )
        )
    return out


@router.get("/health")
async def health():
    return {"status": "ok", "service": "stocksense-api"}


@router.get("/system/stats")
async def system_stats(
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """DB storage + process memory stats for the settings panel."""
    from app.services.system_stats import collect_system_stats

    return await collect_system_stats(db)


@router.get("/me")
async def me(user: AuthUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    settings = await _ensure_settings(db, user)
    return {
        "id": user.id,
        "email": user.email,
        "name": user.name,
        "settings": _settings_out(settings),
    }


@router.get("/settings", response_model=UserSettingsOut)
async def get_settings_endpoint(
    user: AuthUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    return _settings_out(await _ensure_settings(db, user))


@router.patch("/settings", response_model=UserSettingsOut)
async def update_settings(
    payload: UserSettingsUpdate,
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    row = await _ensure_settings(db, user)
    data = payload.model_dump(exclude_unset=True)
    if "preferences" in data and isinstance(data["preferences"], dict):
        row.preferences = {**(row.preferences or {}), **data["preferences"]}
        data.pop("preferences")
    if data.get("alert_push") is False and "push_subscription" not in data:
        row.push_subscription = None
    for k, v in data.items():
        setattr(row, k, v)
    await db.commit()
    await db.refresh(row)
    return _settings_out(row)


@router.get("/fx/rates")
async def fx_rates(user: AuthUser = Depends(get_current_user)):
    from app.services.fx import fetch_usd_rates, rates_payload

    rates = await fetch_usd_rates()
    return rates_payload(rates)


@router.get("/watchlists", response_model=list[WatchlistOut])
async def list_watchlists(
    user: AuthUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    await _ensure_default_watchlist(db, user.id)
    rows = (
        await db.execute(
            select(Watchlist)
            .where(Watchlist.user_id == user.id)
            .options(selectinload(Watchlist.items).selectinload(WatchlistItem.instrument))
        )
    ).scalars().all()
    return [WatchlistOut.model_validate(r) for r in rows]


@router.get("/watchlists/digest", response_model=WatchlistDigestOut)
async def watchlist_digest(
    user: AuthUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    await _ensure_default_watchlist(db, user.id)
    lists = (
        await db.execute(
            select(Watchlist)
            .where(Watchlist.user_id == user.id)
            .options(selectinload(Watchlist.items).selectinload(WatchlistItem.instrument))
        )
    ).scalars().all()

    movers: list[WatchlistDigestItem] = []
    for wl in lists:
        for item in wl.items:
            inst = item.instrument
            quote = await market_data.fetch_quote(inst.symbol, inst.asset_class)
            flags: list[str] = []
            ch = quote.change_pct
            if ch is not None:
                if ch >= 2:
                    flags.append("rally")
                elif ch <= -2:
                    flags.append("selloff")
                elif abs(ch) >= 1:
                    flags.append("mover")
            movers.append(
                WatchlistDigestItem(
                    item_id=item.id,
                    watchlist_id=wl.id,
                    symbol=inst.symbol,
                    name=inst.name or "",
                    asset_class=inst.asset_class,
                    price=quote.price,
                    change_pct=ch,
                    flags=flags,
                )
            )

    movers.sort(key=lambda m: abs(m.change_pct or 0), reverse=True)

    hot = [m for m in movers if m.change_pct is not None and abs(m.change_pct) >= 1][:5]
    if hot:
        digest = "Dnes se hýbe: " + ", ".join(f"{m.symbol} {m.change_pct:+.1f}%" for m in hot) + "."
    else:
        digest = "Watchlist je klidný — žádný výrazný pohyb (±1 %)."

    return WatchlistDigestOut(
        digest_cs=digest,
        movers=movers,
        as_of=datetime.now(timezone.utc),
    )


@router.post("/watchlists", response_model=WatchlistOut)
async def create_watchlist(
    payload: WatchlistCreate,
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    row = Watchlist(user_id=user.id, name=payload.name)
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return WatchlistOut(id=row.id, name=row.name, items=[])


@router.post("/watchlists/{watchlist_id}/items", response_model=WatchlistOut)
async def add_watchlist_item(
    watchlist_id: int,
    payload: WatchlistAddItem,
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    wl = (
        await db.execute(
            select(Watchlist)
            .where(Watchlist.id == watchlist_id, Watchlist.user_id == user.id)
            .options(selectinload(Watchlist.items).selectinload(WatchlistItem.instrument))
        )
    ).scalar_one_or_none()
    if not wl:
        raise HTTPException(404, "Watchlist nenalezen")
    inst = await get_or_create_instrument(
        db, symbol=payload.symbol, name=payload.name, asset_class=payload.asset_class
    )
    existing = next((i for i in wl.items if i.instrument_id == inst.id), None)
    if not existing:
        db.add(WatchlistItem(watchlist_id=wl.id, instrument_id=inst.id, notes=payload.notes))
        await db.commit()
    wl = (
        await db.execute(
            select(Watchlist)
            .where(Watchlist.id == watchlist_id)
            .options(selectinload(Watchlist.items).selectinload(WatchlistItem.instrument))
        )
    ).scalar_one()
    return WatchlistOut.model_validate(wl)


@router.delete("/watchlists/{watchlist_id}/items/{item_id}")
async def remove_watchlist_item(
    watchlist_id: int,
    item_id: int,
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    wl = (
        await db.execute(select(Watchlist).where(Watchlist.id == watchlist_id, Watchlist.user_id == user.id))
    ).scalar_one_or_none()
    if not wl:
        raise HTTPException(404, "Watchlist nenalezen")
    item = (
        await db.execute(
            select(WatchlistItem).where(WatchlistItem.id == item_id, WatchlistItem.watchlist_id == watchlist_id)
        )
    ).scalar_one_or_none()
    if not item:
        raise HTTPException(404, "Položka nenalezena")
    await db.delete(item)
    await db.commit()
    return {"ok": True}


@router.get("/portfolio", response_model=list[PortfolioPositionOut])
async def get_portfolio(
    user: AuthUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    return await _portfolio_with_marks(db, user.id)


@router.post("/portfolio", response_model=PortfolioPositionOut)
async def add_position(
    payload: PortfolioPositionCreate,
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from app.services.fx import guess_currency

    ccy = guess_currency(payload.symbol)
    inst = await get_or_create_instrument(
        db,
        symbol=payload.symbol,
        name=payload.name,
        asset_class=payload.asset_class,
        currency=ccy,
    )
    if not inst.currency:
        inst.currency = ccy
    pos = PortfolioPosition(
        user_id=user.id,
        instrument_id=inst.id,
        quantity=payload.quantity,
        avg_cost=payload.avg_cost,
        opened_at=payload.opened_at,
        is_paper=payload.is_paper,
        notes=payload.notes,
    )
    db.add(pos)
    await db.commit()
    positions = await _portfolio_with_marks(db, user.id)
    return next(p for p in positions if p.id == pos.id)


@router.patch("/portfolio/{position_id}", response_model=PortfolioPositionOut)
async def update_position(
    position_id: int,
    payload: PortfolioPositionUpdate,
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    pos = (
        await db.execute(
            select(PortfolioPosition).where(
                PortfolioPosition.id == position_id, PortfolioPosition.user_id == user.id
            )
        )
    ).scalar_one_or_none()
    if not pos:
        raise HTTPException(404, "Pozice nenalezena")
    data = payload.model_dump(exclude_unset=True)
    for key, value in data.items():
        setattr(pos, key, value)
    await db.commit()
    positions = await _portfolio_with_marks(db, user.id)
    return next(p for p in positions if p.id == position_id)


@router.delete("/portfolio/{position_id}")
async def delete_position(
    position_id: int,
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    pos = (
        await db.execute(
            select(PortfolioPosition).where(
                PortfolioPosition.id == position_id, PortfolioPosition.user_id == user.id
            )
        )
    ).scalar_one_or_none()
    if not pos:
        raise HTTPException(404, "Pozice nenalezena")
    await db.delete(pos)
    await db.commit()
    return {"ok": True}


@router.get("/portfolio/equity", response_model=list[EquityPointOut])
async def portfolio_equity(
    user: AuthUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    rows = (
        await db.execute(
            select(PortfolioSnapshot)
            .where(PortfolioSnapshot.user_id == user.id)
            .order_by(PortfolioSnapshot.as_of.asc())
            .limit(365)
        )
    ).scalars().all()
    return [
        EquityPointOut(
            as_of=r.as_of,
            total_value=r.total_value,
            total_cost=r.total_cost,
            pnl=r.pnl,
            pnl_pct=r.pnl_pct,
        )
        for r in rows
    ]


@router.post("/portfolio/equity/snapshot", response_model=EquityPointOut)
async def portfolio_equity_snapshot(
    user: AuthUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    snap = await snapshot_portfolio(db, user.id)
    if not snap:
        raise HTTPException(400, "Snapshot se nepodařil")
    return EquityPointOut(
        as_of=snap.as_of,
        total_value=snap.total_value,
        total_cost=snap.total_cost,
        pnl=snap.pnl,
        pnl_pct=snap.pnl_pct,
    )


@router.get("/price-alerts", response_model=list[PriceAlertRuleOut])
async def list_price_alerts(
    user: AuthUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    rows = (
        await db.execute(
            select(PriceAlertRule)
            .where(PriceAlertRule.user_id == user.id, PriceAlertRule.is_active.is_(True))
            .options(selectinload(PriceAlertRule.instrument))
            .order_by(PriceAlertRule.created_at.desc())
        )
    ).scalars().all()
    return [PriceAlertRuleOut.model_validate(r) for r in rows]


@router.post("/price-alerts", response_model=PriceAlertRuleOut)
async def create_price_alert(
    payload: PriceAlertRuleCreate,
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    inst = await get_or_create_instrument(db, symbol=payload.symbol)
    await db.commit()
    await db.refresh(inst)
    kind = payload.kind if payload.kind in {"avg_cost", "stop", "target", "custom"} else "custom"
    direction = payload.direction if payload.direction in {"above", "below", "cross"} else "cross"
    rule = PriceAlertRule(
        user_id=user.id,
        instrument_id=inst.id,
        kind=kind,
        price=payload.price,
        direction=direction,
        note=payload.note,
        is_active=True,
    )
    db.add(rule)
    await db.commit()
    row = (
        await db.execute(
            select(PriceAlertRule)
            .where(PriceAlertRule.id == rule.id)
            .options(selectinload(PriceAlertRule.instrument))
        )
    ).scalar_one()
    return PriceAlertRuleOut.model_validate(row)


@router.delete("/price-alerts/{rule_id}")
async def delete_price_alert(
    rule_id: int,
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    rule = (
        await db.execute(
            select(PriceAlertRule).where(
                PriceAlertRule.id == rule_id, PriceAlertRule.user_id == user.id
            )
        )
    ).scalar_one_or_none()
    if not rule:
        raise HTTPException(404, "Hlídač nenalezen")
    rule.is_active = False
    await db.commit()
    return {"ok": True}


@router.get("/export/portfolio.csv")
async def export_portfolio_csv(
    user: AuthUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    from fastapi.responses import PlainTextResponse

    rows = await _portfolio_with_marks(db, user.id)
    lines = [
        "id,symbol,name,asset_class,currency,quantity,avg_cost,opened_at,is_paper,last_price,market_value,pnl,pnl_pct,notes"
    ]
    for p in rows:
        lines.append(
            ",".join(
                [
                    str(p.id),
                    _csv(p.instrument.symbol),
                    _csv(p.instrument.name),
                    _csv(p.instrument.asset_class.value if hasattr(p.instrument.asset_class, "value") else p.instrument.asset_class),
                    _csv(p.instrument.currency),
                    str(p.quantity),
                    str(p.avg_cost),
                    _csv(p.opened_at.isoformat() if p.opened_at else ""),
                    "1" if p.is_paper else "0",
                    "" if p.last_price is None else f"{p.last_price:.6f}",
                    "" if p.market_value is None else f"{p.market_value:.4f}",
                    "" if p.pnl is None else f"{p.pnl:.4f}",
                    "" if p.pnl_pct is None else f"{p.pnl_pct:.4f}",
                    _csv(p.notes or ""),
                ]
            )
        )
    body = "\ufeff" + "\n".join(lines) + "\n"
    return PlainTextResponse(
        body,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="stocksense-portfolio.csv"'},
    )


@router.get("/instruments/search")
async def instruments_search(
    q: str = "",
    limit: int = 10,
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from app.services.instruments import ensure_discovery_universe, search_instruments

    if len(q.strip()) < 1:
        return []
    # Ensure seed universe exists for first-time autocomplete
    await ensure_discovery_universe(db)
    return await search_instruments(db, q, limit=min(max(limit, 1), 20))


@router.get("/instruments/{symbol}")
async def instrument_detail(
    symbol: str,
    lookback: str = "6mo",
    interval: str = "1d",
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from app.models import AssetClass, Instrument, MacroSnapshot
    from app.services.market_data import clamp_lookback, normalize_interval

    allowed_lb = {"5d", "1mo", "3mo", "6mo", "1y", "2y", "5y"}
    allowed_iv = {"15m", "1h", "4h", "1d", "1wk"}
    iv = normalize_interval(interval)
    if iv not in allowed_iv:
        iv = "1d"
    lb_raw = lookback if lookback in allowed_lb else "6mo"
    lb = clamp_lookback(iv, lb_raw)

    inst = (
        await db.execute(select(Instrument).where(Instrument.symbol == symbol.upper()))
    ).scalar_one_or_none()
    if not inst:
        inst = await get_or_create_instrument(db, symbol=symbol)
        await db.commit()
        await db.refresh(inst)

    quote = await market_data.fetch_quote(inst.symbol, inst.asset_class)
    bars = await market_data.fetch_ohlcv(inst.symbol, inst.asset_class, interval=iv, lookback=lb)

    filings = []
    headlines = []
    if inst.asset_class in (AssetClass.stock, AssetClass.etf):
        try:
            filings = await fetch_edgar_recent_filings(inst.symbol, count=8)
        except Exception:
            filings = []
        try:
            headlines = await fetch_yahoo_headlines(inst.symbol, limit=8)
        except Exception:
            headlines = []
    elif inst.asset_class == AssetClass.crypto:
        try:
            headlines = await fetch_yahoo_headlines(inst.symbol.replace("/", "-"), limit=6)
        except Exception:
            headlines = []

    positions = await _portfolio_with_marks(db, user.id)
    own = [p for p in positions if p.instrument.id == inst.id]

    macro_rows = (
        await db.execute(select(MacroSnapshot).order_by(MacroSnapshot.as_of.desc()).limit(50))
    ).scalars().all()
    seen_m: set[str] = set()
    macro_strip = []
    for r in macro_rows:
        if r.series_id in seen_m:
            continue
        seen_m.add(r.series_id)
        macro_strip.append(
            {"series_id": r.series_id, "name": r.name, "value": r.value, "as_of": r.as_of}
        )

    return {
        "instrument": InstrumentOut.model_validate(inst),
        "quote": {
            "price": quote.price,
            "change_pct": quote.change_pct,
            "source": quote.source,
            "data_quality": quote.data_quality,
            "as_of": quote.as_of,
            "fundamentals": quote.fundamentals,
        },
        "interval": iv,
        "lookback": lb,
        "bars": [
            PriceBarOut(
                ts=b.ts,
                open=b.open,
                high=b.high,
                low=b.low,
                close=b.close,
                volume=b.volume,
                source=b.source,
                data_quality=b.data_quality,
                as_of=b.ts,
            )
            for b in bars
        ],
        "positions": own,
        "filings": filings,
        "headlines": headlines,
        "macro": macro_strip,
    }


@router.get("/macro", response_model=list[MacroPointOut])
async def macro(
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from app.models import MacroSnapshot

    rows = (
        await db.execute(select(MacroSnapshot).order_by(MacroSnapshot.as_of.desc()).limit(20))
    ).scalars().all()
    # unique by series
    seen = set()
    out = []
    for r in rows:
        if r.series_id in seen:
            continue
        seen.add(r.series_id)
        out.append(MacroPointOut.model_validate(r))
    return out


@router.get("/alerts", response_model=list[AlertOut])
async def list_alerts(
    user: AuthUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    rows = (
        await db.execute(
            select(Alert).where(Alert.user_id == user.id).order_by(Alert.created_at.desc()).limit(50)
        )
    ).scalars().all()
    return [AlertOut.model_validate(r) for r in rows]


@router.post("/alerts/read-all")
async def mark_all_alerts_read(
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    rows = (
        await db.execute(select(Alert).where(Alert.user_id == user.id, Alert.is_read.is_(False)))
    ).scalars().all()
    for row in rows:
        row.is_read = True
    await db.commit()
    return {"ok": True, "count": len(rows)}


@router.post("/alerts/{alert_id}/read")
async def mark_alert_read(
    alert_id: int,
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    row = (
        await db.execute(select(Alert).where(Alert.id == alert_id, Alert.user_id == user.id))
    ).scalar_one_or_none()
    if not row:
        raise HTTPException(404, "Alert nenalezen")
    row.is_read = True
    await db.commit()
    return {"ok": True}


def _oil_payload(bars, *, iv: str, lb: str, source: str, symbol: str, label: str, note: str):
    last = bars[-1]
    prev = bars[-2] if len(bars) > 1 else last
    change_pct = ((last.close - prev.close) / prev.close * 100.0) if prev.close else None
    change_pct_window = None
    if len(bars) >= 2 and bars[0].close:
        change_pct_window = (bars[-1].close - bars[0].close) / bars[0].close * 100.0
    return {
        "symbol": symbol,
        "label": label,
        "note": note,
        "interval": iv,
        "lookback": lb,
        "bars_count": len(bars),
        "as_of": last.ts.isoformat(),
        "price": last.close,
        "change_pct": change_pct,
        "change_pct_window": change_pct_window,
        "source": source,
        "bars": [
            {
                "ts": b.ts.isoformat(),
                "open": b.open,
                "high": b.high,
                "low": b.low,
                "close": b.close,
                "volume": b.volume,
            }
            for b in bars
        ],
    }


_DESK_LB = {"15m", "1h", "4h", "1d", "5d", "7d", "1mo", "3mo", "6mo", "1y", "2y", "5y"}
_DESK_IV = {"1s", "1m", "5m", "15m", "30m", "1h", "4h", "1d", "1wk"}


def _desk_live_payload(bars, *, symbol: str, iv: str, source: str) -> dict:
    last = bars[-1]
    prev = bars[-2] if len(bars) > 1 else last
    change_pct = ((last.close - prev.close) / prev.close * 100.0) if prev.close else None
    return {
        "symbol": symbol,
        "interval": iv,
        "price": last.close,
        "change_pct": change_pct,
        "as_of": last.ts.isoformat(),
        "source": source,
        "bar": {
            "ts": last.ts.isoformat(),
            "open": last.open,
            "high": last.high,
            "low": last.low,
            "close": last.close,
            "volume": last.volume,
        },
    }


def _require_desk(desk_id: str):
    from app.services.oil_bybit import get_desk

    desk = get_desk(desk_id)
    if desk is None:
        raise HTTPException(status_code=404, detail="Neznámý desk")
    return desk


async def _desk_chart_impl(desk_id: str, lookback: str, interval: str, db: AsyncSession):
    from app.services.market_data import clamp_lookback, normalize_interval
    from app.services.oil_bybit import fetch_linear_klines
    from app.services.oil_footprint import ENGINES
    from app.services.oil_store import get_oil_bars

    desk = _require_desk(desk_id)
    iv = normalize_interval(interval)
    if iv not in _DESK_IV:
        iv = "1m"
    lb_raw = lookback if lookback in _DESK_LB else "1d"
    lb = clamp_lookback(iv, lb_raw)
    engine = ENGINES.get(desk.id)

    klines = []
    if iv != "1s":
        klines = await fetch_linear_klines(desk, iv, lookback=lb)
    bars = klines
    source = desk.source
    note = desk.note
    if engine is not None:
        merged, source = await engine.chart_ohlcv(iv, lb, klines)
        if merged:
            bars = merged
            if ":ticks" in source:
                if "+kline" in source:
                    note = (
                        f"{desk.note} Graf z Bybit public ticků (1s); "
                        "úseky bez tickové historie doplněné Bybit klines."
                    )
                else:
                    note = f"{desk.note} Graf složený z Bybit public ticků (1s → {iv})."
    if bars:
        return _oil_payload(
            bars,
            iv=iv,
            lb=lb,
            source=source,
            symbol=desk.display,
            label=desk.label,
            note=note,
        )
    if desk.yahoo_fallback:
        bars = await get_oil_bars(db, interval=iv, lookback=lb)
        if bars:
            return _oil_payload(
                bars,
                iv=iv,
                lb=lb,
                source=bars[-1].source or "yahoo:CL=F",
                symbol="CL=F",
                label="WTI Crude (NYMEX)",
                note="Yahoo CL=F — zpožděný NYMEX. Live Bybit momentálně nedostupný.",
            )
    raise HTTPException(status_code=502, detail=f"Nepodařilo se načíst {desk.display}")


@router.get("/desk")
async def desk_list(user: AuthUser = Depends(get_current_user)):
    from app.services.oil_bybit import DESKS

    return {
        "desks": [
            {
                "id": d.id,
                "title": d.title,
                "display": d.display,
                "symbol": d.symbol,
                "tick": d.tick,
                "tick_decimals": d.tick_decimals,
                "label": d.label,
            }
            for d in DESKS.values()
        ]
    }


@router.get("/desk/{desk_id}/chart")
async def desk_chart(
    desk_id: str,
    lookback: str = "1d",
    interval: str = "1m",
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await _desk_chart_impl(desk_id, lookback, interval, db)


@router.get("/desk/{desk_id}/orderbook")
async def desk_orderbook(
    desk_id: str,
    limit: int = 200,
    user: AuthUser = Depends(get_current_user),
):
    from app.services.oil_bybit import fetch_linear_orderbook

    desk = _require_desk(desk_id)
    try:
        return await fetch_linear_orderbook(desk, limit=limit)
    except Exception as exc:
        raise HTTPException(
            status_code=502, detail=f"Nepodařilo se načíst {desk.display} L2: {exc}"
        ) from exc


@router.get("/desk/{desk_id}/trades")
async def desk_trades(
    desk_id: str,
    limit: int = 80,
    user: AuthUser = Depends(get_current_user),
):
    from app.services.oil_bybit import fetch_linear_trades

    desk = _require_desk(desk_id)
    try:
        return await fetch_linear_trades(desk, limit=limit)
    except Exception as exc:
        raise HTTPException(
            status_code=502, detail=f"Nepodařilo se načíst {desk.display} trady: {exc}"
        ) from exc


@router.get("/desk/{desk_id}/footprint")
async def desk_footprint(
    desk_id: str,
    interval: str = "1m",
    lookback: str = "1d",
    user: AuthUser = Depends(get_current_user),
):
    from app.services.oil_footprint import snapshot_desk_footprint

    _require_desk(desk_id)
    try:
        return await snapshot_desk_footprint(desk_id, interval, lookback)
    except KeyError:
        raise HTTPException(status_code=404, detail="Neznámý desk") from None


@router.get("/desk/{desk_id}/live")
async def desk_live(
    desk_id: str,
    interval: str = "1m",
    user: AuthUser = Depends(get_current_user),
):
    from app.services.market_data import normalize_interval
    from app.services.oil_bybit import fetch_linear_tail
    from app.services.oil_footprint import ENGINES

    desk = _require_desk(desk_id)
    iv = normalize_interval(interval)
    if iv not in _DESK_IV:
        iv = "1m"
    engine = ENGINES.get(desk.id)
    bars = []
    source = desk.source
    if engine is not None:
        bars = await engine.tail_ohlcv(iv, n=4)
        if bars:
            source = bars[-1].source or f"{desk.source}:ticks"
    if not bars and iv != "1s":
        bars = await fetch_linear_tail(desk, iv, n=4)
        source = desk.source
    if not bars:
        raise HTTPException(status_code=502, detail=f"Nepodařilo se načíst {desk.display} live")
    return _desk_live_payload(bars, symbol=desk.display, iv=iv, source=source)


async def _run_desk_kline_ws(websocket: WebSocket, desk, interval: str) -> None:
    from app.services.market_data import normalize_interval
    from app.services.oil_bybit import iter_linear_klines
    from app.services.oil_footprint import ENGINES

    iv = normalize_interval(interval)
    if iv not in _DESK_IV:
        iv = "1m"
    engine = ENGINES.get(desk.id)
    source = f"{desk.source}:ticks" if engine is not None else f"{desk.source}:ws"
    await websocket.send_json(
        {
            "type": "hello",
            "symbol": desk.symbol,
            "interval": iv,
            "source": source,
        }
    )
    try:
        while True:
            try:
                if engine is not None:
                    last = None
                    while True:
                        bar = engine.current_ohlcv_bar(iv)
                        if bar is not None:
                            key = (bar.ts, bar.open, bar.high, bar.low, bar.close, bar.volume)
                            if key != last:
                                last = key
                                await websocket.send_json(
                                    {
                                        "type": "kline",
                                        "symbol": desk.symbol,
                                        "interval": iv,
                                        "ts": bar.ts.isoformat(),
                                        "open": bar.open,
                                        "high": bar.high,
                                        "low": bar.low,
                                        "close": bar.close,
                                        "volume": bar.volume,
                                        "source": f"{desk.source}:ticks",
                                    }
                                )
                        await asyncio.sleep(0.1)
                else:
                    async for bar in iter_linear_klines(desk, iv):
                        await websocket.send_json(bar)
            except WebSocketDisconnect:
                raise
            except Exception as exc:
                try:
                    await websocket.send_json({"type": "error", "detail": str(exc)[:200]})
                except Exception:
                    break
                await asyncio.sleep(1.5)
    except WebSocketDisconnect:
        return


@router.websocket("/desk/{desk_id}/ws/ohlcv")
async def desk_ws_ohlcv(websocket: WebSocket, desk_id: str, interval: str = "1m"):
    from app.services.oil_bybit import get_desk

    desk = get_desk(desk_id)
    await websocket.accept()
    if desk is None:
        await websocket.send_json({"type": "error", "detail": "Neznámý desk"})
        await websocket.close(code=1008)
        return
    await _run_desk_kline_ws(websocket, desk, interval)


@router.get("/oil/chart")
async def oil_chart(
    lookback: str = "6mo",
    interval: str = "1d",
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await _desk_chart_impl("oil", lookback, interval, db)


@router.get("/oil/orderbook")
async def oil_orderbook(limit: int = 200, user: AuthUser = Depends(get_current_user)):
    return await desk_orderbook("oil", limit, user)


@router.get("/oil/trades")
async def oil_trades(limit: int = 80, user: AuthUser = Depends(get_current_user)):
    return await desk_trades("oil", limit, user)


@router.get("/oil/footprint")
async def oil_footprint(
    interval: str = "1m",
    lookback: str = "1d",
    user: AuthUser = Depends(get_current_user),
):
    return await desk_footprint("oil", interval, lookback, user)


@router.get("/oil/live")
async def oil_live(interval: str = "1m", user: AuthUser = Depends(get_current_user)):
    return await desk_live("oil", interval, user)


@router.websocket("/oil/ws/ohlcv")
async def oil_ws_ohlcv(websocket: WebSocket, interval: str = "1m"):
    from app.services.oil_bybit import OIL_DESK

    await websocket.accept()
    await _run_desk_kline_ws(websocket, OIL_DESK, interval)


@router.get("/btc/chart")
async def btc_chart(
    lookback: str = "1d",
    interval: str = "1m",
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await _desk_chart_impl("btc", lookback, interval, db)


@router.get("/btc/orderbook")
async def btc_orderbook(limit: int = 200, user: AuthUser = Depends(get_current_user)):
    return await desk_orderbook("btc", limit, user)


@router.get("/btc/trades")
async def btc_trades(limit: int = 80, user: AuthUser = Depends(get_current_user)):
    return await desk_trades("btc", limit, user)


@router.get("/btc/footprint")
async def btc_footprint(
    interval: str = "1m",
    lookback: str = "1d",
    user: AuthUser = Depends(get_current_user),
):
    return await desk_footprint("btc", interval, lookback, user)


@router.get("/btc/live")
async def btc_live(interval: str = "1m", user: AuthUser = Depends(get_current_user)):
    return await desk_live("btc", interval, user)


@router.websocket("/btc/ws/ohlcv")
async def btc_ws_ohlcv(websocket: WebSocket, interval: str = "1m"):
    from app.services.oil_bybit import BTC_DESK

    await websocket.accept()
    await _run_desk_kline_ws(websocket, BTC_DESK, interval)


@router.get("/gold/chart")
async def gold_chart(
    lookback: str = "1d",
    interval: str = "1m",
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await _desk_chart_impl("gold", lookback, interval, db)


@router.get("/gold/orderbook")
async def gold_orderbook(limit: int = 200, user: AuthUser = Depends(get_current_user)):
    return await desk_orderbook("gold", limit, user)


@router.get("/gold/trades")
async def gold_trades(limit: int = 80, user: AuthUser = Depends(get_current_user)):
    return await desk_trades("gold", limit, user)


@router.get("/gold/footprint")
async def gold_footprint(
    interval: str = "1m",
    lookback: str = "1d",
    user: AuthUser = Depends(get_current_user),
):
    return await desk_footprint("gold", interval, lookback, user)


@router.get("/gold/live")
async def gold_live(interval: str = "1m", user: AuthUser = Depends(get_current_user)):
    return await desk_live("gold", interval, user)


@router.websocket("/gold/ws/ohlcv")
async def gold_ws_ohlcv(websocket: WebSocket, interval: str = "1m"):
    from app.services.oil_bybit import GOLD_DESK

    await websocket.accept()
    await _run_desk_kline_ws(websocket, GOLD_DESK, interval)
