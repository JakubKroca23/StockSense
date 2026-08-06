from datetime import datetime, timezone
import asyncio

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.auth import AuthUser, get_current_user
from app.core.config import get_settings
from app.core.database import get_db
from app.models import (
    Alert,
    ChatMessage,
    ChatSession,
    ChatSessionStatus,
    CloseReason,
    FeedbackResult,
    PortfolioPosition,
    PortfolioSnapshot,
    PriceAlertRule,
    PriceBar,
    Report,
    RiskProfile,
    Tip,
    TipFeedback,
    TipStatus,
    UserSettings,
    Watchlist,
    WatchlistItem,
)
from app.schemas import (
    AlertOut,
    ChatMessageOut,
    ChatRequest,
    ChatSessionCreate,
    ChatSessionOut,
    ChatSessionUpdate,
    ChatTurnOut,
    EquityPointOut,
    HomeOut,
    InstrumentOut,
    MacroPointOut,
    PaperPositionOut,
    PaperPositionPreview,
    PortfolioPositionCreate,
    PortfolioPositionOut,
    PortfolioPositionUpdate,
    PriceAlertRuleCreate,
    PriceAlertRuleOut,
    PriceBarOut,
    ReportOut,
    TipFeedbackCreate,
    TipFeedbackOut,
    TipHistoryOut,
    TipJournalUpdate,
    TipLifecycleUpdate,
    TipOut,
    UserSettingsOut,
    UserSettingsUpdate,
    WatchlistAddItem,
    WatchlistCreate,
    WatchlistDigestItem,
    WatchlistDigestOut,
    WatchlistOut,
)
from app.services.feedback import feedback_adj_for_asset_class, feedback_stats
from app.services.tip_lifecycle import infer_close_reason
from app.services.fundament_macro import (
    fetch_edgar_recent_filings,
    fetch_yahoo_headlines,
    macro_bias_from_snapshots,
)
from app.services.instruments import get_or_create_instrument
from app.services.llm import LLMTask, generate_chat_title, llm_complete
from app.services.market_data import market_data
from app.services.scoring import score_instrument
from app.workers.jobs import generate_daily_report, run_scoring_for_user, snapshot_portfolio

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


def _tip_load_options():
    return (selectinload(Tip.instrument), selectinload(Tip.feedback))


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


@router.get("/home", response_model=HomeOut)
async def home(user: AuthUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    settings = await _ensure_settings(db, user)
    portfolio = await _portfolio_with_marks(db, user.id)
    tips = (
        await db.execute(
            select(Tip)
            .where(Tip.user_id == user.id, Tip.is_active.is_(True))
            .options(*_tip_load_options())
            .order_by(Tip.score.desc())
            .limit(20)
        )
    ).scalars().all()
    unread = (
        await db.execute(
            select(func.count()).select_from(Alert).where(Alert.user_id == user.id, Alert.is_read.is_(False))
        )
    ).scalar_one()
    latest_report = (
        await db.execute(
            select(Report)
            .where(Report.user_id == user.id, Report.kind == "daily")
            .order_by(Report.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    briefing_cs = None
    briefing_title = None
    briefing_at = None
    if latest_report:
        briefing_title = latest_report.title
        briefing_at = latest_report.created_at
        meta = latest_report.meta or {}
        briefing_cs = meta.get("briefing_cs") or (latest_report.content_md or "")[:700]

    stats = await feedback_stats(db, user.id)
    equity_rows = (
        await db.execute(
            select(PortfolioSnapshot)
            .where(PortfolioSnapshot.user_id == user.id)
            .order_by(PortfolioSnapshot.as_of.asc())
            .limit(120)
        )
    ).scalars().all()
    equity = [
        {
            "as_of": str(r.as_of),
            "total_value": r.total_value,
            "total_cost": r.total_cost,
            "pnl": r.pnl,
            "pnl_pct": r.pnl_pct,
        }
        for r in equity_rows
    ]

    return HomeOut(
        portfolio=portfolio,
        tips=[TipOut.model_validate(t) for t in tips],
        alerts_unread=int(unread or 0),
        risk_profile=settings.risk_profile,
        briefing_cs=briefing_cs,
        briefing_title=briefing_title,
        briefing_at=briefing_at,
        tip_stats=stats,
        equity=equity,
    )


@router.get("/markets/overview")
async def markets_overview_endpoint(user: AuthUser = Depends(get_current_user)):
    """Sector cards for homepage — crypto / stocks / commodities (fast, no LLM)."""
    from app.services.markets_overview import markets_overview

    return await markets_overview()


@router.get("/markets/overview/ai")
async def markets_overview_ai_endpoint(user: AuthUser = Depends(get_current_user)):
    """Gemini AI summaries for homepage sector cards (slower; call after overview)."""
    from app.services.markets_overview import markets_overview_ai

    return await markets_overview_ai()


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
    """Sense digest: movers + tipy u sledovaných symbolů."""
    await _ensure_default_watchlist(db, user.id)
    lists = (
        await db.execute(
            select(Watchlist)
            .where(Watchlist.user_id == user.id)
            .options(selectinload(Watchlist.items).selectinload(WatchlistItem.instrument))
        )
    ).scalars().all()

    tips = (
        await db.execute(
            select(Tip)
            .where(Tip.user_id == user.id, Tip.is_active.is_(True))
            .options(*_tip_load_options())
        )
    ).scalars().all()
    tip_by_inst = {t.instrument_id: t for t in tips}

    movers: list[WatchlistDigestItem] = []
    for wl in lists:
        for item in wl.items:
            inst = item.instrument
            quote = await market_data.fetch_quote(inst.symbol, inst.asset_class)
            tip = tip_by_inst.get(inst.id)
            flags: list[str] = []
            ch = quote.change_pct
            if ch is not None:
                if ch >= 2:
                    flags.append("rally")
                elif ch <= -2:
                    flags.append("selloff")
                elif abs(ch) >= 1:
                    flags.append("mover")
            if tip:
                flags.append(f"tip_{tip.action.value}")
                if tip.stop and quote.price:
                    dist = abs(quote.price - tip.stop) / max(abs(tip.stop), 1e-9)
                    if dist <= 0.02:
                        flags.append("near_stop")
                if tip.target_1 and quote.price:
                    dist = abs(quote.price - tip.target_1) / max(abs(tip.target_1), 1e-9)
                    if dist <= 0.02:
                        flags.append("near_target")
            movers.append(
                WatchlistDigestItem(
                    item_id=item.id,
                    watchlist_id=wl.id,
                    symbol=inst.symbol,
                    name=inst.name or "",
                    asset_class=inst.asset_class,
                    price=quote.price,
                    change_pct=ch,
                    tip=TipOut.model_validate(tip) if tip else None,
                    flags=flags,
                )
            )

    movers.sort(key=lambda m: abs(m.change_pct or 0), reverse=True)

    lines: list[str] = []
    hot = [m for m in movers if m.change_pct is not None and abs(m.change_pct) >= 1][:5]
    if hot:
        parts = [
            f"{m.symbol} {m.change_pct:+.1f}%"
            + (f" ({m.tip.action.value} {m.tip.score:.0f})" if m.tip else "")
            for m in hot
        ]
        lines.append("Dnes se hýbe: " + ", ".join(parts) + ".")
    tipped = [m for m in movers if m.tip][:4]
    if tipped:
        lines.append(
            "Aktivní tipy: "
            + ", ".join(f"{m.symbol} {m.tip.action.value}/{m.tip.score:.0f}" for m in tipped if m.tip)
            + "."
        )
    near = [m for m in movers if "near_stop" in m.flags or "near_target" in m.flags]
    if near:
        lines.append(
            "Blízko levelů: "
            + ", ".join(
                f"{m.symbol} ({'stop' if 'near_stop' in m.flags else 'target'})" for m in near[:4]
            )
            + "."
        )
    if not lines:
        lines.append(
            "Watchlist je klidný — žádný výrazný pohyb (±1 %) ani aktivní tip u sledovaných."
        )

    return WatchlistDigestOut(
        digest_cs=" ".join(lines),
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


@router.get("/tips", response_model=list[TipOut])
async def list_tips(
    include_inactive: bool = False,
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    q = select(Tip).where(Tip.user_id == user.id).options(*_tip_load_options())
    if not include_inactive:
        q = q.where(Tip.is_active.is_(True)).order_by(Tip.score.desc())
    else:
        q = q.order_by(Tip.created_at.desc())
    tips = (await db.execute(q.limit(100))).scalars().all()
    return [TipOut.model_validate(t) for t in tips]


@router.get("/tips/history", response_model=TipHistoryOut)
async def tips_history(
    result: FeedbackResult | None = None,
    close_reason: CloseReason | None = None,
    level: str | None = None,
    limit: int = 100,
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Closed tips with feedback + aggregate TP/SL stats.

    `level=tp` → target_1/target_2; `level=sl` → stop.
    """
    limit = max(1, min(limit, 300))
    stats = await feedback_stats(db, user.id)

    q = (
        select(Tip)
        .join(TipFeedback, TipFeedback.tip_id == Tip.id)
        .where(Tip.user_id == user.id)
        .options(*_tip_load_options())
        .order_by(TipFeedback.created_at.desc())
    )
    if result is not None:
        q = q.where(TipFeedback.result == result)

    level_key = (level or "").strip().lower()
    if level_key == "tp":
        q = q.where(
            TipFeedback.close_reason.in_(
                [CloseReason.target_1.value, CloseReason.target_2.value]
            )
        )
    elif level_key == "sl":
        q = q.where(TipFeedback.close_reason == CloseReason.stop.value)
    elif close_reason is not None:
        q = q.where(TipFeedback.close_reason == close_reason.value)

    tips = (await db.execute(q.limit(limit))).scalars().unique().all()

    out: list[TipOut] = []
    for tip in tips:
        item = TipOut.model_validate(tip)
        if item.feedback and not item.feedback.close_reason:
            item.feedback.close_reason = infer_close_reason(item.feedback.notes)
        out.append(item)

    return TipHistoryOut(stats=stats, tips=out)


@router.get("/tips/stats")
async def tips_stats(user: AuthUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await feedback_stats(db, user.id)


@router.delete("/tips/clear")
async def clear_tips(
    scope: str = "all",
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Smaž tipy uživatele. scope=active|history|all (feedback jde CASCADE)."""
    scope = (scope or "all").strip().lower()
    if scope not in {"active", "history", "all"}:
        raise HTTPException(400, "Neplatný scope — použij active, history nebo all")

    base = select(Tip.id).where(Tip.user_id == user.id)
    if scope == "active":
        ids_q = base.where(Tip.is_active.is_(True))
    elif scope == "history":
        ids_q = (
            select(Tip.id)
            .join(TipFeedback, TipFeedback.tip_id == Tip.id)
            .where(Tip.user_id == user.id)
        )
    else:
        ids_q = base

    tip_ids = list((await db.execute(ids_q)).scalars().all())
    deleted = 0
    if tip_ids:
        # Feedback má ON DELETE CASCADE; smažeme tipy přímo.
        res = await db.execute(delete(Tip).where(Tip.id.in_(tip_ids), Tip.user_id == user.id))
        deleted = res.rowcount or len(tip_ids)

    alerts_deleted = 0
    if scope in {"active", "all"}:
        # Tip-related alerty (payload.tip_id nebo kind s tip)
        alert_res = await db.execute(
            delete(Alert).where(
                Alert.user_id == user.id,
                Alert.kind.in_(
                    (
                        "new_tip",
                        "tip_invalidated",
                        "price_stop",
                        "price_target_1",
                        "price_target_2",
                    )
                ),
            )
        )
        alerts_deleted = alert_res.rowcount or 0

    await db.commit()
    return {"ok": True, "scope": scope, "deleted_tips": deleted, "deleted_alerts": alerts_deleted}


@router.post("/tips/run", response_model=list[TipOut])
async def run_tips(user: AuthUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if not get_settings().enable_tip_scoring:
        raise HTTPException(
            status_code=503,
            detail="Generování tipů je vypnuté — pipeline se předělává.",
        )
    tips = await run_scoring_for_user(db, user.id)
    ids = [t.id for t in tips]
    if not ids:
        return []
    rows = (
        await db.execute(select(Tip).where(Tip.id.in_(ids)).options(*_tip_load_options()))
    ).scalars().all()
    return [TipOut.model_validate(t) for t in rows]


@router.post("/tips/{tip_id}/lifecycle", response_model=TipOut)
async def tip_lifecycle(
    tip_id: int,
    payload: TipLifecycleUpdate,
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    tip = (
        await db.execute(
            select(Tip).where(Tip.id == tip_id, Tip.user_id == user.id).options(*_tip_load_options())
        )
    ).scalar_one_or_none()
    if not tip:
        raise HTTPException(404, "Tip nenalezen")

    status = payload.status
    tip.status = status.value if hasattr(status, "value") else str(status)

    if status == TipStatus.rejected:
        tip.is_active = False
        if payload.notes and payload.notes.strip():
            tip.entry_notes = f"[odmítnuto] {payload.notes.strip()}"
    elif status == TipStatus.accepted:
        tip.is_active = True
        if payload.notes and payload.notes.strip():
            tip.entry_notes = payload.notes.strip()
    elif status == TipStatus.closed:
        tip.is_active = False
        tip.closed_at = tip.closed_at or datetime.now(timezone.utc)
        reason = (
            payload.close_reason.value
            if payload.close_reason is not None
            else CloseReason.manual.value
        )
        if payload.result:
            existing = (
                await db.execute(select(TipFeedback).where(TipFeedback.tip_id == tip_id))
            ).scalar_one_or_none()
            if existing:
                existing.result = payload.result
                existing.close_reason = reason
                if payload.notes is not None:
                    existing.notes = payload.notes
            else:
                db.add(
                    TipFeedback(
                        tip_id=tip_id,
                        user_id=user.id,
                        result=payload.result,
                        close_reason=reason,
                        notes=payload.notes,
                    )
                )
        elif not tip.feedback:
            raise HTTPException(400, "Uzavření tipu vyžaduje výsledek (hit/miss/partial)")
        elif tip.feedback and not tip.feedback.close_reason:
            tip.feedback.close_reason = reason

    await db.commit()
    tip = (
        await db.execute(
            select(Tip).where(Tip.id == tip_id).options(*_tip_load_options())
        )
    ).scalar_one()
    return TipOut.model_validate(tip)


@router.patch("/tips/{tip_id}/journal", response_model=TipOut)
async def tip_journal(
    tip_id: int,
    payload: TipJournalUpdate,
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update entry/exit journal notes without changing lifecycle status."""
    tip = (
        await db.execute(
            select(Tip).where(Tip.id == tip_id, Tip.user_id == user.id).options(*_tip_load_options())
        )
    ).scalar_one_or_none()
    if not tip:
        raise HTTPException(404, "Tip nenalezen")
    data = payload.model_dump(exclude_unset=True)
    if "entry_notes" in data:
        tip.entry_notes = data["entry_notes"]
    if "exit_notes" in data or "result" in data or "close_reason" in data:
        existing = (
            await db.execute(select(TipFeedback).where(TipFeedback.tip_id == tip_id))
        ).scalar_one_or_none()
        exit_notes = data.get("exit_notes")
        result = data.get("result")
        reason = data.get("close_reason")
        reason_val = reason.value if reason is not None and hasattr(reason, "value") else reason
        if existing:
            if exit_notes is not None:
                existing.notes = exit_notes
            if result is not None:
                existing.result = result
            if reason_val is not None:
                existing.close_reason = reason_val
            elif result is not None and not existing.close_reason:
                existing.close_reason = CloseReason.manual.value
        elif result is not None:
            db.add(
                TipFeedback(
                    tip_id=tip_id,
                    user_id=user.id,
                    result=result,
                    close_reason=reason_val or CloseReason.manual.value,
                    notes=exit_notes,
                )
            )
            tip.closed_at = tip.closed_at or datetime.now(timezone.utc)
            tip.status = TipStatus.closed.value
            tip.is_active = False
        elif exit_notes:
            raise HTTPException(400, "Exit poznámka vyžaduje výsledek (hit/miss/partial) u tipu bez feedbacku")
    await db.commit()
    tip = (
        await db.execute(select(Tip).where(Tip.id == tip_id).options(*_tip_load_options()))
    ).scalar_one()
    return TipOut.model_validate(tip)


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


@router.get("/export/tips.csv")
async def export_tips_csv(
    include_inactive: bool = True,
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from fastapi.responses import PlainTextResponse

    q = select(Tip).where(Tip.user_id == user.id).options(*_tip_load_options())
    if not include_inactive:
        q = q.where(Tip.is_active.is_(True))
    tips = (await db.execute(q.order_by(Tip.created_at.desc()).limit(500))).scalars().all()
    lines = [
        "id,symbol,action,horizon,status,score,confidence,entry_low,entry_high,stop,target_1,"
        "suggested_size_pct,data_quality,is_active,as_of,closed_at,entry_notes,"
        "feedback_result,close_reason,feedback_notes,narrative"
    ]
    for t in tips:
        fb = t.feedback
        reason = (fb.close_reason if fb and fb.close_reason else None) or (
            infer_close_reason(fb.notes) if fb else None
        )
        lines.append(
            ",".join(
                [
                    str(t.id),
                    _csv(t.instrument.symbol),
                    _csv(t.action.value),
                    _csv(t.horizon.value),
                    _csv(t.status or ""),
                    f"{t.score:.2f}",
                    f"{t.confidence:.4f}",
                    "" if t.entry_low is None else f"{t.entry_low:.6f}",
                    "" if t.entry_high is None else f"{t.entry_high:.6f}",
                    "" if t.stop is None else f"{t.stop:.6f}",
                    "" if t.target_1 is None else f"{t.target_1:.6f}",
                    "" if t.suggested_size_pct is None else f"{t.suggested_size_pct:.2f}",
                    _csv(t.data_quality.value),
                    "1" if t.is_active else "0",
                    _csv(t.as_of.isoformat() if t.as_of else ""),
                    _csv(t.closed_at.isoformat() if t.closed_at else ""),
                    _csv(t.entry_notes or ""),
                    _csv(fb.result.value if fb else ""),
                    _csv(reason or ""),
                    _csv(fb.notes if fb and fb.notes else ""),
                    _csv((t.narrative_cs or "")[:500]),
                ]
            )
        )
    body = "\ufeff" + "\n".join(lines) + "\n"
    return PlainTextResponse(
        body,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="stocksense-tips.csv"'},
    )


def _csv(value: object) -> str:
    s = "" if value is None else str(value)
    if any(c in s for c in ',"\n\r'):
        return '"' + s.replace('"', '""') + '"'
    return s


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
    reason = (
        payload.close_reason.value
        if payload.close_reason is not None
        else CloseReason.manual.value
    )
    existing = (
        await db.execute(select(TipFeedback).where(TipFeedback.tip_id == tip_id))
    ).scalar_one_or_none()
    if existing:
        existing.result = payload.result
        existing.notes = payload.notes
        existing.close_reason = reason
        fb = existing
    else:
        fb = TipFeedback(
            tip_id=tip_id,
            user_id=user.id,
            result=payload.result,
            close_reason=reason,
            notes=payload.notes,
        )
        db.add(fb)
    tip.status = TipStatus.closed.value
    tip.is_active = False
    tip.closed_at = tip.closed_at or datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(fb)
    return TipFeedbackOut.model_validate(fb)


def _default_size_pct(risk: RiskProfile, tip_pct: float | None, max_pct: float) -> float:
    base = {
        RiskProfile.conservative: 2.0,
        RiskProfile.balanced: 4.0,
        RiskProfile.aggressive: 7.0,
    }.get(risk, 4.0)
    pct = float(tip_pct) if tip_pct and tip_pct > 0 else base
    return max(0.1, min(pct, max_pct, 25.0))


async def _paper_preview_for_tip(
    db: AsyncSession, user: AuthUser, tip: Tip
) -> PaperPositionPreview:
    settings = await _ensure_settings(db, user)
    portfolio = await _portfolio_with_marks(db, user.id)
    equity = sum(float(p.market_value or 0) for p in portfolio)
    if equity <= 0:
        equity = 10_000.0  # paper default book

    quote = await market_data.fetch_quote(tip.instrument.symbol, tip.instrument.asset_class)
    entry_mid = None
    if tip.entry_low and tip.entry_high:
        entry_mid = (float(tip.entry_low) + float(tip.entry_high)) / 2
    avg_cost = float(entry_mid or quote.price or tip.entry_low or tip.entry_high or 0)
    if avg_cost <= 0:
        raise HTTPException(400, "Nelze spočítat cenu vstupu pro paper pozici")

    size_pct = _default_size_pct(settings.risk_profile, tip.suggested_size_pct, settings.max_position_pct)
    notional = equity * (size_pct / 100.0)
    quantity = notional / avg_cost
    # crypto/small prices keep more decimals; stocks round to 4
    quantity = round(quantity, 6 if avg_cost < 5 else 4)

    notes = (
        f"Paper z tipu #{tip.id} ({tip.action.value}, score {tip.score:.0f}, "
        f"horizon {tip.horizon.value}, size {size_pct:.1f}% equity)"
    )
    return PaperPositionPreview(
        tip_id=tip.id,
        symbol=tip.instrument.symbol,
        quantity=quantity,
        avg_cost=round(avg_cost, 6),
        size_pct=size_pct,
        notional=round(notional, 2),
        portfolio_equity=round(equity, 2),
        is_paper=True,
        notes=notes,
    )


@router.get("/tips/{tip_id}/paper-preview", response_model=PaperPositionPreview)
async def tip_paper_preview(
    tip_id: int,
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    tip = (
        await db.execute(
            select(Tip).where(Tip.id == tip_id, Tip.user_id == user.id).options(*_tip_load_options())
        )
    ).scalar_one_or_none()
    if not tip:
        raise HTTPException(404, "Tip nenalezen")
    return await _paper_preview_for_tip(db, user, tip)


@router.post("/tips/{tip_id}/paper-position", response_model=PaperPositionOut)
async def tip_paper_position(
    tip_id: int,
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from decimal import Decimal

    from app.services.fx import guess_currency

    tip = (
        await db.execute(
            select(Tip).where(Tip.id == tip_id, Tip.user_id == user.id).options(*_tip_load_options())
        )
    ).scalar_one_or_none()
    if not tip:
        raise HTTPException(404, "Tip nenalezen")

    preview = await _paper_preview_for_tip(db, user, tip)
    ccy = tip.instrument.currency or guess_currency(tip.instrument.symbol)
    if not tip.instrument.currency:
        tip.instrument.currency = ccy

    pos = PortfolioPosition(
        user_id=user.id,
        instrument_id=tip.instrument_id,
        quantity=Decimal(str(preview.quantity)),
        avg_cost=Decimal(str(preview.avg_cost)),
        opened_at=datetime.now(timezone.utc).date(),
        is_paper=True,
        notes=preview.notes,
    )
    db.add(pos)
    # Accept tip when opening paper
    if (tip.status or "proposed") == TipStatus.proposed.value:
        tip.status = TipStatus.accepted.value
        tip.is_active = True
    await db.commit()
    positions = await _portfolio_with_marks(db, user.id)
    created = next(p for p in positions if p.id == pos.id)
    return PaperPositionOut(preview=preview, position=created)


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
    bars_1d = bars if iv == "1d" else await market_data.fetch_ohlcv(
        inst.symbol, inst.asset_class, interval="1d", lookback="6mo"
    )
    bars_4h = await market_data.fetch_ohlcv(
        inst.symbol, inst.asset_class, interval="4h", lookback="3mo"
    )

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

    tip = (
        await db.execute(
            select(Tip)
            .where(Tip.user_id == user.id, Tip.instrument_id == inst.id, Tip.is_active.is_(True))
            .options(*_tip_load_options())
            .order_by(Tip.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()

    positions = await _portfolio_with_marks(db, user.id)
    own = [p for p in positions if p.instrument.id == inst.id]

    settings = await _ensure_settings(db, user)
    macro_rows = (
        await db.execute(select(MacroSnapshot).order_by(MacroSnapshot.as_of.desc()).limit(50))
    ).scalars().all()
    macro_bias = macro_bias_from_snapshots(list(macro_rows))
    seen_m: set[str] = set()
    macro_strip = []
    for r in macro_rows:
        if r.series_id in seen_m:
            continue
        seen_m.add(r.series_id)
        macro_strip.append(
            {"series_id": r.series_id, "name": r.name, "value": r.value, "as_of": r.as_of}
        )

    bench = await market_data.fetch_ohlcv(
        "BTC-USD" if inst.asset_class == AssetClass.crypto else "SPY",
        AssetClass.crypto if inst.asset_class == AssetClass.crypto else AssetClass.etf,
        interval="1d",
        lookback="6mo",
    )
    fb_adj = await feedback_adj_for_asset_class(db, user.id, inst.asset_class.value)
    analysis = None
    scored = score_instrument(
        bars_1d,
        quote,
        inst.asset_class,
        settings.risk_profile,
        float(settings.max_position_pct or 10),
        macro_bias,
        fb_adj,
        benchmark_bars=bench or None,
        bars_short=bars_4h or None,
    )
    if scored:
        analysis = {
            "action": scored.action.value,
            "horizon": scored.horizon.value,
            "score": scored.score,
            "confidence": scored.confidence,
            "components": scored.rationale.get("components"),
            "features": scored.rationale.get("features"),
            "notes": {
                "fundament": scored.rationale.get("fundament"),
                "makro": scored.rationale.get("makro"),
                "money_flow": scored.rationale.get("money_flow"),
                "technicka": scored.rationale.get("technicka"),
                "feedback": scored.rationale.get("feedback"),
            },
            "scenarios": {
                "bull": scored.scenario_bull,
                "base": scored.scenario_base,
                "bear": scored.scenario_bear,
            },
            "levels": {
                "entry_low": scored.entry_low,
                "entry_high": scored.entry_high,
                "stop": scored.stop,
                "target_1": scored.target_1,
                "target_2": scored.target_2,
            },
        }

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
        "analysis": analysis,
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

    bot_mode = (payload.mode or "").lower() == "bot"
    context_parts: list[str] = []
    if payload.screen_context and payload.screen_context.strip():
        context_parts.append(
            "KONTEXT OBRAZOVKY (to, co uživatel právě vidí):\n"
            + payload.screen_context.strip()[:4000]
        )

    # Sense bot: keep it fast — screen context is enough. Full chat still pulls market data.
    if payload.symbol and not bot_mode:
        from app.models import AssetClass, Instrument, MacroSnapshot

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
                    f"status={tip.status}, horizon={tip.horizon}, "
                    f"entry={tip.entry_low}-{tip.entry_high}, stop={tip.stop}, "
                    f"target1={tip.target_1}, size_pct={tip.suggested_size_pct}, "
                    f"rationale={tip.rationale}, narrative={(tip.narrative_cs or '')[:400]}"
                )
            own_pos = (
                await db.execute(
                    select(PortfolioPosition)
                    .where(
                        PortfolioPosition.user_id == user.id,
                        PortfolioPosition.instrument_id == inst.id,
                    )
                    .options(selectinload(PortfolioPosition.instrument))
                )
            ).scalars().all()
            if own_pos:
                context_parts.append(
                    "Pozice: "
                    + "; ".join(
                        f"qty={p.quantity} avg={p.avg_cost}"
                        + (" paper" if p.is_paper else "")
                        for p in own_pos
                    )
                )
            bars = await market_data.fetch_ohlcv(inst.symbol, inst.asset_class, interval="1d", lookback="1mo")
            if bars:
                last = bars[-8:]
                context_parts.append(
                    "Poslední OHLCV (1d): "
                    + "; ".join(
                        f"{b.ts.date()}: o={b.open:.4f} h={b.high:.4f} l={b.low:.4f} c={b.close:.4f}"
                        for b in last
                    )
                )

            # Live analysis features for chat precision
            try:
                settings = await _ensure_settings(db, user)
                macro_rows = (
                    await db.execute(
                        select(MacroSnapshot).order_by(MacroSnapshot.as_of.desc()).limit(40)
                    )
                ).scalars().all()
                macro_bias = macro_bias_from_snapshots(list(macro_rows))
                seen = set()
                macro_lines = []
                for r in macro_rows:
                    if r.series_id in seen:
                        continue
                    seen.add(r.series_id)
                    macro_lines.append(f"{r.series_id}={r.value}")
                if macro_lines:
                    context_parts.append(f"Makro (FRED): {', '.join(macro_lines)}; bias={macro_bias:+.2f}")

                bench = await market_data.fetch_ohlcv(
                    "BTC-USD" if inst.asset_class == AssetClass.crypto else "SPY",
                    AssetClass.crypto if inst.asset_class == AssetClass.crypto else AssetClass.etf,
                    interval="1d",
                    lookback="6mo",
                )
                bars_4h = await market_data.fetch_ohlcv(
                    inst.symbol, inst.asset_class, interval="4h", lookback="3mo"
                )
                fb_adj = await feedback_adj_for_asset_class(db, user.id, inst.asset_class.value)
                scored = score_instrument(
                    bars or [],
                    quote,
                    inst.asset_class,
                    settings.risk_profile,
                    float(settings.max_position_pct or 10),
                    macro_bias,
                    fb_adj,
                    benchmark_bars=bench or None,
                    bars_short=bars_4h or None,
                )
                if scored:
                    feats = scored.rationale.get("features") or {}
                    comps = scored.rationale.get("components") or {}
                    context_parts.append(
                        f"Live score: {scored.score} action={scored.action.value} "
                        f"components={comps} features={feats}"
                    )
            except Exception:
                pass

            if inst.asset_class in (AssetClass.stock, AssetClass.etf):
                try:
                    filings = await fetch_edgar_recent_filings(inst.symbol, count=5)
                    if filings:
                        context_parts.append(
                            "SEC filings: "
                            + "; ".join(
                                f"{f.get('form')}@{f.get('filing_date')}"
                                + (f" url={f.get('url')}" if f.get("url") else "")
                                for f in filings
                            )
                        )
                except Exception:
                    pass
                try:
                    headlines = await fetch_yahoo_headlines(inst.symbol, limit=6)
                    if headlines:
                        context_parts.append(
                            "Headlines: "
                            + " | ".join(
                                f"{h.get('title')}"
                                + (f" ({h.get('published')})" if h.get("published") else "")
                                for h in headlines
                            )
                        )
                except Exception:
                    pass
            elif inst.asset_class == AssetClass.crypto:
                try:
                    headlines = await fetch_yahoo_headlines(
                        inst.symbol.replace("/", "-"), limit=5
                    )
                    if headlines:
                        context_parts.append(
                            "Headlines: " + " | ".join(h.get("title", "") for h in headlines)
                        )
                except Exception:
                    pass

    if not bot_mode:
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
    # Keep Sense bot session titled
    if bot_mode and (needs_title or "sense bot" not in (session.title or "").lower()):
        session.title = "Sense bot"
        needs_title = False

    if bot_mode:
        user_prompt = (
            f"{payload.message}\n\n"
            "Jsi Sense bot — stručný rádce v UI StockSense. "
            "Odpovídej česky, 2–8 vět nebo krátké odrážky. "
            "Reaguj na kontext obrazovky, pokud je k dispozici. "
            "Nevymýšlej čísla. Bez dlouhých markdown sekcí."
        )
        task = LLMTask.light
    else:
        user_prompt = (
            f"{payload.message}\n\n"
            "Odpověz ve strukturovaném markdownu se sekcemi ## Shrnutí, ## Analýza, "
            "## Pre-závěr a ## Rizika. Buď stručný a přehledný."
        )
        task = LLMTask.heavy if payload.symbol or "tip" in payload.message.lower() else LLMTask.light

    answer_coro = llm_complete(
        user_prompt,
        task=task,
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

    if not (answer or "").strip():
        answer = "Teď nedokážu odpovědět (Gemini). Zkus to znovu za chvíli."

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


# —— CryptoSense ——


@router.get("/crypto/health")
async def crypto_health(user: AuthUser = Depends(get_current_user)):
    from app.services.crypto_market import get_crypto_market

    return get_crypto_market().health()


@router.get("/crypto/overview")
async def crypto_overview(
    symbols: str | None = None,
    user: AuthUser = Depends(get_current_user),
):
    """Live multi-exchange quotes for CryptoSense board."""
    from app.services.crypto_market import get_crypto_market

    parsed = [s.strip() for s in (symbols or "").split(",") if s.strip()] or None
    return await get_crypto_market().overview(parsed)


@router.get("/crypto/quote")
async def crypto_quote(
    symbol: str,
    user: AuthUser = Depends(get_current_user),
):
    from app.services.crypto_market import get_crypto_market

    if not symbol.strip():
        raise HTTPException(400, "Chybí symbol")
    agg = await get_crypto_market().fetch_aggregated_quote(symbol)
    return get_crypto_market()._agg_to_dict(agg)


@router.get("/crypto/orderbook")
async def crypto_orderbook(
    symbol: str = "BTC/USDT",
    limit: int = 200,
    user: AuthUser = Depends(get_current_user),
):
    """Aggregated L2 order book (Binance + Bybit) for depth + heatmap."""
    from app.services.crypto_market import get_crypto_market

    if not symbol.strip():
        raise HTTPException(400, "Chybí symbol")
    return await get_crypto_market().fetch_aggregated_order_book(symbol, limit=limit)


@router.get("/crypto/ohlcv")
async def crypto_ohlcv(
    symbol: str = "BTC/USDT",
    interval: str = "1h",
    limit: int = 200,
    persist: bool = True,
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Aggregated OHLCV (Binance + Bybit); optionally upsert into price_bars."""
    from app.services.crypto_market import get_crypto_market, persist_crypto_ohlcv

    allowed = {"1s", "1m", "5m", "15m", "30m", "1h", "4h", "1d", "1wk"}
    iv = interval if interval in allowed else "1h"
    lim = max(20, min(limit, 1000 if iv == "1s" else 500))
    # Ultra-short TFs: don't flood price_bars
    do_persist = persist and iv not in {"1s", "1m", "5m", "30m"}
    if do_persist:
        return await persist_crypto_ohlcv(db, symbol=symbol, interval=iv, limit=lim)

    market = get_crypto_market()
    bars = await market.fetch_ohlcv(symbol, interval=iv)
    if lim and len(bars) > lim:
        bars = bars[-lim:]
    return {
        "symbol": symbol.upper().replace("-", "/"),
        "interval": iv,
        "primary_exchange": market.primary,
        "execution_exchange": market.execution,
        "chart_mode": "aggregated",
        "bars": len(bars),
        "inserted": 0,
        "updated": 0,
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


@router.websocket("/crypto/ws/ohlcv")
async def crypto_ws_ohlcv(websocket: WebSocket, symbol: str = "BTC/USDT", interval: str = "1m"):
    """Realtime aggregated candles (Binance + Bybit public kline streams)."""
    from app.services.crypto_stream import SUPPORTED_INTERVALS, iter_aggregated_klines

    await websocket.accept()
    iv = interval if interval in SUPPORTED_INTERVALS else "1m"
    sym = (symbol or "BTC/USDT").strip()
    await websocket.send_json(
        {
            "type": "hello",
            "symbol": sym,
            "interval": iv,
            "source": "agg:binance+bybit:ws",
            "execution_exchange": "bybit",
            "chart_mode": "aggregated",
        }
    )
    try:
        while True:
            try:
                async for bar in iter_aggregated_klines(sym, iv):
                    if bar.get("type") == "heartbeat":
                        continue
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


