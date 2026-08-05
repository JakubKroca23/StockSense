from datetime import datetime, timezone
import asyncio

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.auth import AuthUser, get_current_user, mint_access_token, verify_password
from app.core.config import get_settings
from app.core.database import get_db
from app.models import (
    Alert,
    ChatMessage,
    ChatSession,
    ChatSessionStatus,
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
    AuthLogin,
    AuthTokenOut,
    ChatMessageOut,
    ChatRequest,
    ChatSessionCreate,
    ChatSessionOut,
    ChatSessionUpdate,
    ChatTurnOut,
    HomeOut,
    InstrumentOut,
    MacroPointOut,
    PortfolioPositionCreate,
    PortfolioPositionOut,
    PortfolioPositionUpdate,
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
from app.services.llm import LLMTask, generate_chat_title, llm_complete
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


@router.post("/auth/login", response_model=AuthTokenOut)
async def auth_login(payload: AuthLogin):
    """Single-user password login → locally signed JWT."""
    settings = get_settings()
    if not settings.auth_password:
        raise HTTPException(
            status_code=500,
            detail="AUTH_PASSWORD není nastaveno na serveru",
        )
    if not verify_password(settings, payload.password):
        raise HTTPException(status_code=401, detail="Neplatné heslo")
    token = mint_access_token(settings)
    return AuthTokenOut(
        access_token=token,
        expires_in=settings.auth_token_ttl_sec,
        user={
            "id": settings.auth_user_id,
            "email": settings.auth_email or None,
            "name": settings.auth_display_name,
        },
    )


@router.post("/auth/refresh", response_model=AuthTokenOut)
async def auth_refresh(user: AuthUser = Depends(get_current_user)):
    """Mint a fresh JWT for an already-authenticated user."""
    settings = get_settings()
    token = mint_access_token(settings)
    return AuthTokenOut(
        access_token=token,
        expires_in=settings.auth_token_ttl_sec,
        user={"id": user.id, "email": user.email, "name": user.name},
    )


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
    if "preferences" in data and isinstance(data["preferences"], dict):
        row.preferences = {**(row.preferences or {}), **data["preferences"]}
        data.pop("preferences")
    for k, v in data.items():
        setattr(row, k, v)
    await db.commit()
    await db.refresh(row)
    return UserSettingsOut.model_validate(row)


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
    from app.models import AssetClass, Instrument
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

    positions = await _portfolio_with_marks(db, user.id)
    own = [p for p in positions if p.instrument.id == inst.id]

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


@router.post("/chat", response_model=ChatTurnOut)
async def chat(
    payload: ChatRequest,
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    session = await _resolve_chat_session(db, user.id, payload.session_id, payload.symbol)
    if payload.symbol:
        session.symbol = payload.symbol.upper()

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

    user_msg = ChatMessage(
        user_id=user.id, session_id=session.id, role="user", content=payload.message
    )
    db.add(user_msg)
    await db.flush()

    needs_title = session.message_count == 0 or session.title in {
        "Nový chat",
        "Starší konverzace",
    }

    answer_coro = llm_complete(
        (
            f"{payload.message}\n\n"
            "Odpověz ve strukturovaném markdownu se sekcemi ## Shrnutí, ## Analýza, "
            "## Pre-závěr a ## Rizika. Buď stručný a přehledný."
        ),
        task=LLMTask.heavy if payload.symbol or "tip" in payload.message.lower() else LLMTask.light,
        context="\n".join(context_parts),
    )
    if needs_title:
        answer, title = await asyncio.gather(
            answer_coro,
            generate_chat_title(payload.message, session.symbol or payload.symbol),
        )
        session.title = title
    else:
        answer = await answer_coro

    assistant = ChatMessage(
        user_id=user.id, session_id=session.id, role="assistant", content=answer
    )
    db.add(assistant)

    session.message_count = int(session.message_count or 0) + 2
    session.preview = (answer or payload.message)[:280]
    if session.status == ChatSessionStatus.closed:
        session.status = ChatSessionStatus.open
    session.updated_at = datetime.now(timezone.utc)

    await db.commit()
    await db.refresh(user_msg)
    await db.refresh(assistant)
    await db.refresh(session)
    return ChatTurnOut(
        session=ChatSessionOut.model_validate(session),
        user_message=ChatMessageOut.model_validate(user_msg),
        assistant_message=ChatMessageOut.model_validate(assistant),
    )


@router.get("/chat/sessions", response_model=list[ChatSessionOut])
async def list_chat_sessions(
    include_closed: bool = False,
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _migrate_orphan_messages(db, user.id)
    q = select(ChatSession).where(ChatSession.user_id == user.id)
    if not include_closed:
        q = q.where(ChatSession.status != ChatSessionStatus.closed)
    rows = (await db.execute(q.order_by(ChatSession.updated_at.desc()).limit(100))).scalars().all()
    return [ChatSessionOut.model_validate(r) for r in rows]


@router.post("/chat/sessions", response_model=ChatSessionOut)
async def create_chat_session(
    payload: ChatSessionCreate,
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    session = ChatSession(
        user_id=user.id,
        title=(payload.title or "Nový chat").strip()[:255] or "Nový chat",
        symbol=payload.symbol.upper() if payload.symbol else None,
        status=ChatSessionStatus.open,
    )
    db.add(session)
    await db.commit()
    await db.refresh(session)
    return ChatSessionOut.model_validate(session)


@router.get("/chat/sessions/{session_id}", response_model=ChatSessionOut)
async def get_chat_session(
    session_id: int,
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    session = await _get_owned_session(db, user.id, session_id)
    return ChatSessionOut.model_validate(session)


@router.patch("/chat/sessions/{session_id}", response_model=ChatSessionOut)
async def update_chat_session(
    session_id: int,
    payload: ChatSessionUpdate,
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    session = await _get_owned_session(db, user.id, session_id)
    if payload.title is not None:
        title = payload.title.strip()[:255]
        if title:
            session.title = title
    if payload.symbol is not None:
        session.symbol = payload.symbol.upper() if payload.symbol.strip() else None
    if payload.status is not None:
        session.status = payload.status
    session.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(session)
    return ChatSessionOut.model_validate(session)


@router.delete("/chat/sessions/{session_id}", status_code=204)
async def delete_chat_session(
    session_id: int,
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    session = await _get_owned_session(db, user.id, session_id)
    await db.delete(session)
    await db.commit()


@router.get("/chat/history", response_model=list[ChatMessageOut])
async def chat_history(
    session_id: int | None = None,
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _migrate_orphan_messages(db, user.id)
    q = select(ChatMessage).where(ChatMessage.user_id == user.id)
    if session_id is not None:
        await _get_owned_session(db, user.id, session_id)
        q = q.where(ChatMessage.session_id == session_id)
    else:
        # Bez session_id vrať aktivní (open) session, jinak prázdno — UI si vybere
        active = (
            await db.execute(
                select(ChatSession)
                .where(ChatSession.user_id == user.id, ChatSession.status == ChatSessionStatus.open)
                .order_by(ChatSession.updated_at.desc())
                .limit(1)
            )
        ).scalar_one_or_none()
        if not active:
            return []
        q = q.where(ChatMessage.session_id == active.id)
    rows = (await db.execute(q.order_by(ChatMessage.created_at.asc()).limit(200))).scalars().all()
    return [ChatMessageOut.model_validate(r) for r in rows]


def _title_from_message(message: str, symbol: str | None = None) -> str:
    cleaned = " ".join(message.split())
    if len(cleaned) > 64:
        cleaned = cleaned[:61].rstrip() + "…"
    if symbol and symbol.upper() not in cleaned.upper():
        return f"{symbol.upper()}: {cleaned}"[:255]
    return cleaned[:255] or "Nový chat"


async def _get_owned_session(db: AsyncSession, user_id: str, session_id: int) -> ChatSession:
    session = (
        await db.execute(
            select(ChatSession).where(ChatSession.id == session_id, ChatSession.user_id == user_id)
        )
    ).scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Chat session not found")
    return session


async def _resolve_chat_session(
    db: AsyncSession,
    user_id: str,
    session_id: int | None,
    symbol: str | None,
) -> ChatSession:
    if session_id is not None:
        return await _get_owned_session(db, user_id, session_id)
    session = ChatSession(
        user_id=user_id,
        title="Nový chat",
        symbol=symbol.upper() if symbol else None,
        status=ChatSessionStatus.open,
    )
    db.add(session)
    await db.flush()
    return session


async def _migrate_orphan_messages(db: AsyncSession, user_id: str) -> None:
    orphans = (
        await db.execute(
            select(ChatMessage)
            .where(ChatMessage.user_id == user_id, ChatMessage.session_id.is_(None))
            .order_by(ChatMessage.created_at.asc())
        )
    ).scalars().all()
    if not orphans:
        return
    first = orphans[0].content if orphans else "Starší konverzace"
    session = ChatSession(
        user_id=user_id,
        title=_title_from_message(first) if first else "Starší konverzace",
        status=ChatSessionStatus.saved,
        preview=(orphans[-1].content[:280] if orphans else None),
        message_count=len(orphans),
    )
    db.add(session)
    await db.flush()
    for msg in orphans:
        msg.session_id = session.id
    await db.commit()


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
