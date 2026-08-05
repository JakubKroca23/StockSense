from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.auth import AuthUser, get_current_user
from app.core.database import get_db
from app.models import (
    Alert,
    ChatMessage,
    PortfolioPosition,
    PriceBar,
    Report,
    RiskProfile,
    Tip,
    TipFeedback,
    UserSettings,
    Watchlist,
    WatchlistItem,
)
from app.schemas import (
    AlertOut,
    ChatMessageOut,
    ChatRequest,
    HomeOut,
    InstrumentOut,
    MacroPointOut,
    PortfolioPositionCreate,
    PortfolioPositionOut,
    PriceBarOut,
    ReportOut,
    TipFeedbackCreate,
    TipFeedbackOut,
    TipOut,
    UserSettingsOut,
    UserSettingsUpdate,
    WatchlistAddItem,
    WatchlistCreate,
    WatchlistOut,
)
from app.services.fundament_macro import fetch_edgar_recent_filings
from app.services.instruments import get_or_create_instrument
from app.services.llm import LLMTask, llm_complete
from app.services.market_data import market_data
from app.workers.jobs import generate_daily_report, run_scoring_for_user

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
    out: list[PortfolioPositionOut] = []
    for p in rows:
        last = (
            await db.execute(
                select(PriceBar)
                .where(PriceBar.instrument_id == p.instrument_id, PriceBar.interval == "1d")
                .order_by(PriceBar.ts.desc())
                .limit(1)
            )
        ).scalar_one_or_none()
        last_price = float(last.close) if last else None
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


@router.get("/me")
async def me(user: AuthUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    settings = await _ensure_settings(db, user)
    return {
        "id": user.id,
        "email": user.email,
        "name": user.name,
        "settings": UserSettingsOut.model_validate(settings),
    }


@router.get("/home", response_model=HomeOut)
async def home(user: AuthUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    settings = await _ensure_settings(db, user)
    portfolio = await _portfolio_with_marks(db, user.id)
    tips = (
        await db.execute(
            select(Tip)
            .where(Tip.user_id == user.id, Tip.is_active.is_(True))
            .options(selectinload(Tip.instrument))
            .order_by(Tip.score.desc())
            .limit(20)
        )
    ).scalars().all()
    unread = (
        await db.execute(
            select(func.count()).select_from(Alert).where(Alert.user_id == user.id, Alert.is_read.is_(False))
        )
    ).scalar_one()
    return HomeOut(
        portfolio=portfolio,
        tips=[TipOut.model_validate(t) for t in tips],
        alerts_unread=int(unread or 0),
        risk_profile=settings.risk_profile,
    )


@router.get("/settings", response_model=UserSettingsOut)
async def get_settings_endpoint(
    user: AuthUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    return UserSettingsOut.model_validate(await _ensure_settings(db, user))


@router.patch("/settings", response_model=UserSettingsOut)
async def update_settings(
    payload: UserSettingsUpdate,
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    row = await _ensure_settings(db, user)
    data = payload.model_dump(exclude_unset=True)
    for k, v in data.items():
        setattr(row, k, v)
    await db.commit()
    await db.refresh(row)
    return UserSettingsOut.model_validate(row)


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
    inst = await get_or_create_instrument(
        db, symbol=payload.symbol, name=payload.name, asset_class=payload.asset_class
    )
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


@router.get("/tips", response_model=list[TipOut])
async def list_tips(user: AuthUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    tips = (
        await db.execute(
            select(Tip)
            .where(Tip.user_id == user.id, Tip.is_active.is_(True))
            .options(selectinload(Tip.instrument))
            .order_by(Tip.score.desc())
        )
    ).scalars().all()
    return [TipOut.model_validate(t) for t in tips]


@router.post("/tips/run", response_model=list[TipOut])
async def run_tips(user: AuthUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    tips = await run_scoring_for_user(db, user.id)
    # reload with instruments
    ids = [t.id for t in tips]
    if not ids:
        return []
    rows = (
        await db.execute(select(Tip).where(Tip.id.in_(ids)).options(selectinload(Tip.instrument)))
    ).scalars().all()
    return [TipOut.model_validate(t) for t in rows]


@router.post("/tips/{tip_id}/feedback", response_model=TipFeedbackOut)
async def tip_feedback(
    tip_id: int,
    payload: TipFeedbackCreate,
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    tip = (
        await db.execute(select(Tip).where(Tip.id == tip_id, Tip.user_id == user.id))
    ).scalar_one_or_none()
    if not tip:
        raise HTTPException(404, "Tip nenalezen")
    existing = (
        await db.execute(select(TipFeedback).where(TipFeedback.tip_id == tip_id))
    ).scalar_one_or_none()
    if existing:
        existing.result = payload.result
        existing.notes = payload.notes
        fb = existing
    else:
        fb = TipFeedback(tip_id=tip_id, user_id=user.id, result=payload.result, notes=payload.notes)
        db.add(fb)
    await db.commit()
    await db.refresh(fb)
    return TipFeedbackOut.model_validate(fb)


@router.get("/instruments/{symbol}")
async def instrument_detail(
    symbol: str,
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from app.models import AssetClass, Instrument

    inst = (
        await db.execute(select(Instrument).where(Instrument.symbol == symbol.upper()))
    ).scalar_one_or_none()
    if not inst:
        inst = await get_or_create_instrument(db, symbol=symbol)
        await db.commit()
        await db.refresh(inst)

    quote = await market_data.fetch_quote(inst.symbol, inst.asset_class)
    bars = await market_data.fetch_ohlcv(inst.symbol, inst.asset_class, lookback="6mo")
    filings = []
    if inst.asset_class in (AssetClass.stock, AssetClass.etf):
        try:
            filings = await fetch_edgar_recent_filings(inst.symbol)
        except Exception:
            filings = []

    tip = (
        await db.execute(
            select(Tip)
            .where(Tip.user_id == user.id, Tip.instrument_id == inst.id, Tip.is_active.is_(True))
            .options(selectinload(Tip.instrument))
            .order_by(Tip.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()

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
        "filings": filings,
        "tip": TipOut.model_validate(tip) if tip else None,
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


@router.post("/chat", response_model=ChatMessageOut)
async def chat(
    payload: ChatRequest,
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    context_parts: list[str] = []
    if payload.symbol:
        from app.models import Instrument

        inst = (
            await db.execute(select(Instrument).where(Instrument.symbol == payload.symbol.upper()))
        ).scalar_one_or_none()
        if inst:
            quote = await market_data.fetch_quote(inst.symbol, inst.asset_class)
            tip = (
                await db.execute(
                    select(Tip).where(
                        Tip.user_id == user.id, Tip.instrument_id == inst.id, Tip.is_active.is_(True)
                    )
                )
            ).scalar_one_or_none()
            context_parts.append(
                f"Symbol {inst.symbol}: price={quote.price}, change={quote.change_pct}, "
                f"fundamentals={quote.fundamentals}, data_quality={quote.data_quality}"
            )
            if tip:
                context_parts.append(
                    f"Aktivní tip: action={tip.action}, score={tip.score}, confidence={tip.confidence}, "
                    f"rationale={tip.rationale}"
                )

    tips = (
        await db.execute(
            select(Tip)
            .where(Tip.user_id == user.id, Tip.is_active.is_(True))
            .options(selectinload(Tip.instrument))
            .order_by(Tip.score.desc())
            .limit(5)
        )
    ).scalars().all()
    if tips:
        context_parts.append(
            "Top tipy: "
            + "; ".join(f"{t.instrument.symbol}:{t.action.value}:{t.score}" for t in tips)
        )

    user_msg = ChatMessage(user_id=user.id, role="user", content=payload.message)
    db.add(user_msg)
    await db.flush()

    answer = await llm_complete(
        payload.message,
        task=LLMTask.heavy if payload.symbol or "tip" in payload.message.lower() else LLMTask.light,
        context="\n".join(context_parts),
    )
    assistant = ChatMessage(user_id=user.id, role="assistant", content=answer)
    db.add(assistant)
    await db.commit()
    await db.refresh(assistant)
    return ChatMessageOut.model_validate(assistant)


@router.get("/chat/history", response_model=list[ChatMessageOut])
async def chat_history(
    user: AuthUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    rows = (
        await db.execute(
            select(ChatMessage)
            .where(ChatMessage.user_id == user.id)
            .order_by(ChatMessage.created_at.desc())
            .limit(50)
        )
    ).scalars().all()
    return [ChatMessageOut.model_validate(r) for r in reversed(rows)]


@router.get("/reports", response_model=list[ReportOut])
async def list_reports(
    user: AuthUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    rows = (
        await db.execute(
            select(Report).where(Report.user_id == user.id).order_by(Report.created_at.desc()).limit(30)
        )
    ).scalars().all()
    return [ReportOut.model_validate(r) for r in rows]


@router.post("/reports/daily", response_model=ReportOut)
async def create_daily_report(
    user: AuthUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    report = await generate_daily_report(db, user.id)
    return ReportOut.model_validate(report)


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
