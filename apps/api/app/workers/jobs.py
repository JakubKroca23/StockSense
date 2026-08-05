from __future__ import annotations

import logging
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models import (
    Alert,
    AssetClass,
    FeedbackResult,
    Instrument,
    MacroSnapshot,
    PortfolioPosition,
    PortfolioSnapshot,
    PriceAlertRule,
    PriceBar,
    Report,
    RiskProfile,
    Tip,
    TipStatus,
    UserSettings,
    Watchlist,
)
from app.services.alerts import create_alert
from app.services.feedback import feedback_adj_for_asset_class
from app.services.fundament_macro import fetch_fred_latest, macro_bias_from_snapshots
from app.services.instruments import ensure_discovery_universe
from app.services.llm import LLMTask, llm_complete, narrate_tip
from app.services.market_data import market_data
from app.services.scoring import score_instrument
from app.services.tip_lifecycle import close_tip, invalidate_expired_tips, score_flip

logger = logging.getLogger(__name__)


def _briefing_excerpt(markdown: str, *, max_chars: int = 900) -> str:
    """Plain Czech snippet for Home — no second LLM round-trip."""
    lines: list[str] = []
    for raw in (markdown or "").splitlines():
        line = raw.strip()
        if not line:
            continue
        if line.startswith("#"):
            continue
        if line.startswith("```"):
            continue
        line = line.lstrip("-*• ").replace("**", "").replace("__", "")
        if line:
            lines.append(line)
    text = " ".join(lines)
    # Prefer first ~5 sentence-ish chunks
    parts = [p.strip() for p in text.replace("!", ".").replace("?", ".").split(".") if p.strip()]
    excerpt = ". ".join(parts[:6])
    if excerpt and not excerpt.endswith("."):
        excerpt += "."
    return (excerpt or text)[:max_chars]


async def sync_prices_for_instruments(db: AsyncSession, instruments: list[Instrument]) -> int:
    count = 0
    for inst in instruments:
        try:
            bars = await market_data.fetch_ohlcv(inst.symbol, inst.asset_class, interval="1d", lookback="6mo")
            for bar in bars[-60:]:
                existing = await db.execute(
                    select(PriceBar).where(
                        PriceBar.instrument_id == inst.id,
                        PriceBar.interval == "1d",
                        PriceBar.ts == bar.ts,
                    )
                )
                if existing.scalar_one_or_none():
                    continue
                db.add(
                    PriceBar(
                        instrument_id=inst.id,
                        interval="1d",
                        ts=bar.ts,
                        open=bar.open,
                        high=bar.high,
                        low=bar.low,
                        close=bar.close,
                        volume=bar.volume,
                        source=bar.source,
                        data_quality=bar.data_quality,
                        as_of=datetime.now(timezone.utc),
                    )
                )
                count += 1
            await db.commit()
        except Exception as exc:
            logger.warning("Price sync failed for %s: %s", inst.symbol, exc)
            await db.rollback()
    return count


async def sync_macro(db: AsyncSession) -> int:
    rows = await fetch_fred_latest()
    n = 0
    for row in rows:
        existing = await db.execute(
            select(MacroSnapshot).where(
                MacroSnapshot.series_id == row["series_id"],
                MacroSnapshot.ts == row["ts"],
            )
        )
        if existing.scalar_one_or_none():
            continue
        db.add(
            MacroSnapshot(
                series_id=row["series_id"],
                name=row["name"],
                value=row["value"],
                ts=row["ts"],
                source=row["source"],
            )
        )
        n += 1
    await db.commit()
    return n


def _macro_bias_from_snapshots(snaps: list[MacroSnapshot]) -> float:
    return macro_bias_from_snapshots(snaps)


async def _instruments_for_user(db: AsyncSession, user_id: str) -> list[Instrument]:
    from app.models import WatchlistItem

    ids: set[int] = set()
    wl = await db.execute(
        select(Watchlist)
        .where(Watchlist.user_id == user_id)
        .options(selectinload(Watchlist.items).selectinload(WatchlistItem.instrument))
    )
    for watchlist in wl.scalars().all():
        for item in watchlist.items:
            ids.add(item.instrument_id)

    pos = await db.execute(select(PortfolioPosition).where(PortfolioPosition.user_id == user_id))
    for p in pos.scalars().all():
        ids.add(p.instrument_id)

    disc = await db.execute(select(Instrument).where(Instrument.is_discovery.is_(True)))
    for inst in disc.scalars().all():
        ids.add(inst.id)

    if not ids:
        return []
    result = await db.execute(select(Instrument).where(Instrument.id.in_(ids)))
    return list(result.scalars().all())


async def run_scoring_for_user(db: AsyncSession, user_id: str) -> list[Tip]:
    await ensure_discovery_universe(db)

    settings_row = (
        await db.execute(select(UserSettings).where(UserSettings.user_id == user_id))
    ).scalar_one_or_none()
    risk = settings_row.risk_profile if settings_row else RiskProfile.balanced
    max_pct = settings_row.max_position_pct if settings_row else 5.0
    return await _run_scoring(db, user_id, risk, max_pct)


async def _run_scoring(
    db: AsyncSession, user_id: str, risk: RiskProfile, max_pct: float
) -> list[Tip]:
    macro_result = await db.execute(
        select(MacroSnapshot).order_by(MacroSnapshot.as_of.desc()).limit(50)
    )
    macro_bias = _macro_bias_from_snapshots(list(macro_result.scalars().all()))

    instruments = await _instruments_for_user(db, user_id)
    await sync_prices_for_instruments(db, instruments)

    # Benchmarks for relative strength (once per run)
    spy_bars = await market_data.fetch_ohlcv("SPY", AssetClass.etf, interval="1d", lookback="6mo")
    btc_bars = await market_data.fetch_ohlcv("BTC-USD", AssetClass.crypto, interval="1d", lookback="6mo")
    if not btc_bars:
        btc_bars = await market_data.fetch_ohlcv("BTC/USDT", AssetClass.crypto, interval="1d", lookback="6mo")

    # deactivate old tips (keep accepted ones the user is following)
    old = await db.execute(
        select(Tip)
        .where(Tip.user_id == user_id, Tip.is_active.is_(True))
        .options(selectinload(Tip.instrument))
    )
    accepted_by_inst: dict[int, Tip] = {}
    for tip in old.scalars().all():
        if (tip.status or "proposed") == TipStatus.accepted.value:
            accepted_by_inst[tip.instrument_id] = tip
            continue
        tip.is_active = False

    created: list[Tip] = []
    for inst in instruments:
        try:
            bars = await market_data.fetch_ohlcv(inst.symbol, inst.asset_class)
            quote = await market_data.fetch_quote(inst.symbol, inst.asset_class)
            bars_4h = await market_data.fetch_ohlcv(
                inst.symbol, inst.asset_class, interval="4h", lookback="3mo"
            )
            bench = btc_bars if inst.asset_class == AssetClass.crypto else spy_bars
            fb_adj = await feedback_adj_for_asset_class(
                db, user_id, inst.asset_class.value
            )
            result = score_instrument(
                bars,
                quote,
                inst.asset_class,
                risk,
                max_pct,
                macro_bias,
                fb_adj,
                benchmark_bars=bench or None,
                bars_short=bars_4h or None,
            )
            if not result:
                continue

            accepted = accepted_by_inst.get(inst.id)
            if accepted:
                if score_flip(
                    accepted.score,
                    accepted.action.value,
                    result.score,
                    result.action.value,
                ):
                    await close_tip(
                        db,
                        accepted,
                        result=FeedbackResult.miss,
                        notes=(
                            f"Velká změna scoringu: {accepted.score:.0f}/{accepted.action.value} → "
                            f"{result.score:.0f}/{result.action.value}."
                        ),
                    )
                    # fall through to create a fresh proposed tip
                else:
                    continue

            tip = Tip(
                user_id=user_id,
                instrument_id=inst.id,
                action=result.action,
                horizon=result.horizon,
                entry_low=result.entry_low,
                entry_high=result.entry_high,
                stop=result.stop,
                target_1=result.target_1,
                target_2=result.target_2,
                score=result.score,
                confidence=result.confidence,
                scenario_bull=result.scenario_bull,
                scenario_base=result.scenario_base,
                scenario_bear=result.scenario_bear,
                rationale=result.rationale,
                risks=result.risks,
                data_quality=result.data_quality,
                risk_profile=risk,
                suggested_size_pct=result.suggested_size_pct,
                is_active=True,
                status=TipStatus.proposed.value,
            )
            # narrative for stronger tips
            if abs(result.score) >= 20:
                tip.narrative_cs = await narrate_tip(
                    inst.symbol,
                    {
                        "action": result.action.value,
                        "horizon": result.horizon.value,
                        "score": result.score,
                        "confidence": result.confidence,
                        "entry_low": result.entry_low,
                        "entry_high": result.entry_high,
                        "stop": result.stop,
                        "target_1": result.target_1,
                        "target_2": result.target_2,
                        "rationale": result.rationale,
                        "data_quality": result.data_quality.value,
                    },
                )
            db.add(tip)
            await db.flush()
            tip.instrument = inst  # avoid async lazy-load when alerting
            created.append(tip)
        except Exception as exc:
            logger.warning("Scoring failed for %s: %s", inst.symbol, exc)

    # Alert only for the strongest tips (avoid inbox flood on every scoring run)
    for tip in sorted(created, key=lambda t: abs(t.score), reverse=True)[:5]:
        if abs(tip.score) < 35:
            continue
        symbol = tip.instrument.symbol if tip.instrument else "?"
        await create_alert(
            db,
            user_id=user_id,
            kind="new_tip",
            title=f"Nový tip: {symbol} → {tip.action.value}",
            body=(
                f"Score {tip.score}, confidence {tip.confidence}. "
                f"Horizont {tip.horizon.value}. "
                f"{(tip.narrative_cs or '')[:240]}"
            ),
            payload={"tip_id": tip.id, "symbol": symbol, "action": tip.action.value},
        )

    await db.commit()
    return created


async def generate_daily_report(db: AsyncSession, user_id: str) -> Report:
    tips = (
        await db.execute(
            select(Tip)
            .where(Tip.user_id == user_id, Tip.is_active.is_(True))
            .options(selectinload(Tip.instrument))
            .order_by(Tip.score.desc())
        )
    ).scalars().all()

    positions = (
        await db.execute(
            select(PortfolioPosition)
            .where(PortfolioPosition.user_id == user_id)
            .options(selectinload(PortfolioPosition.instrument))
        )
    ).scalars().all()

    macro_rows = (
        await db.execute(select(MacroSnapshot).order_by(MacroSnapshot.as_of.desc()).limit(20))
    ).scalars().all()
    macro_by = {}
    for m in macro_rows:
        macro_by.setdefault(m.series_id, m)
    macro_lines = [
        f"- {m.name or sid}: {m.value}"
        for sid, m in list(macro_by.items())[:8]
    ]

    tip_lines = [
        f"- **{t.instrument.symbol}**: {t.action.value} | score {t.score} | conf {t.confidence} | {t.horizon.value}"
        for t in tips[:15]
    ]
    top2 = tips[:2]
    focus_lines = [
        f"- {t.instrument.symbol} ({t.action.value}, score {t.score}): {(t.narrative_cs or t.scenario_base or '')[:180]}"
        for t in top2
    ]
    pos_lines = [
        f"- **{p.instrument.symbol}**: qty {p.quantity} @ {p.avg_cost}" + (" (paper)" if p.is_paper else "")
        for p in positions
    ]
    context = (
        "MAKRO:\n"
        + ("\n".join(macro_lines) or "- bez dat")
        + "\n\nTOP TIPY:\n"
        + ("\n".join(tip_lines) or "- žádné")
        + "\n\nFOKUS (1–2 tipy):\n"
        + ("\n".join(focus_lines) or "- žádné")
        + "\n\nPORTFOLIO:\n"
        + ("\n".join(pos_lines) or "- prázdné")
    )
    # One LLM call only — second call + Ollama fallback often times out the web request.
    narrative = await llm_complete(
        (
            "Napiš denní Sense briefing v češtině (markdown). "
            "Struktura: 1) Sense shrnutí (5–8 vět), 2) Makro v 2 větách, "
            "3) Portfolio rizika, 4) 1–2 tipy ke sledování, 5) Rizika. Max 350 slov. "
            "Žádné vymyšlené čísla mimo kontext."
        ),
        task=LLMTask.heavy,
        context=context,
    )
    briefing = _briefing_excerpt(narrative)
    title = f"Denní report {datetime.now(timezone.utc).strftime('%Y-%m-%d')}"

    by_action: dict[str, int] = {}
    for t in tips:
        key = t.action.value
        by_action[key] = by_action.get(key, 0) + 1
    tip_cards = [
        {
            "symbol": t.instrument.symbol,
            "name": t.instrument.name or "",
            "action": t.action.value,
            "horizon": t.horizon.value,
            "score": round(float(t.score), 1),
            "confidence": round(float(t.confidence), 3),
            "stop": t.stop,
            "target_1": t.target_1,
            "entry_low": t.entry_low,
            "entry_high": t.entry_high,
            "narrative": (t.narrative_cs or t.scenario_base or "")[:220],
            "data_quality": t.data_quality.value,
        }
        for t in tips[:8]
    ]
    macro_points = [
        {
            "series_id": sid,
            "name": m.name or sid,
            "value": m.value,
        }
        for sid, m in list(macro_by.items())[:6]
    ]
    portfolio_cards = [
        {
            "symbol": p.instrument.symbol,
            "qty": float(p.quantity),
            "avg_cost": float(p.avg_cost),
            "is_paper": bool(p.is_paper),
            "asset_class": p.instrument.asset_class.value,
        }
        for p in positions[:10]
    ]

    report = Report(
        user_id=user_id,
        kind="daily",
        title=title,
        content_md=narrative,
        meta={
            "tip_count": len(tips),
            "position_count": len(positions),
            "briefing_cs": briefing,
            "focus_symbols": [t.instrument.symbol for t in top2],
            "by_action": by_action,
            "tips": tip_cards,
            "macro": macro_points,
            "portfolio": portfolio_cards,
            "avg_score": round(sum(float(t.score) for t in tips) / len(tips), 1) if tips else 0,
            "avg_confidence": round(
                sum(float(t.confidence) for t in tips) / len(tips), 3
            )
            if tips
            else 0,
            "generated_at": datetime.now(timezone.utc).isoformat(),
        },
    )
    db.add(report)
    await db.flush()
    await create_alert(
        db,
        user_id=user_id,
        kind="daily_report",
        title=title,
        body="Denní Sense briefing je připravený.",
        payload={"report_id": report.id},
    )
    await db.commit()
    await db.refresh(report)
    return report


async def snapshot_portfolio(db: AsyncSession, user_id: str) -> PortfolioSnapshot | None:
    """Persist daily equity mark for curve."""
    positions = (
        await db.execute(
            select(PortfolioPosition)
            .where(PortfolioPosition.user_id == user_id)
            .options(selectinload(PortfolioPosition.instrument))
        )
    ).scalars().all()
    today = datetime.now(timezone.utc).date()
    existing = (
        await db.execute(
            select(PortfolioSnapshot).where(
                PortfolioSnapshot.user_id == user_id,
                PortfolioSnapshot.as_of == today,
            )
        )
    ).scalar_one_or_none()

    total_value = 0.0
    total_cost = 0.0
    breakdown = []
    for p in positions:
        qty = float(p.quantity)
        cost_px = float(p.avg_cost)
        cost = cost_px * qty
        last = (
            await db.execute(
                select(PriceBar)
                .where(PriceBar.instrument_id == p.instrument_id, PriceBar.interval == "1d")
                .order_by(PriceBar.ts.desc())
                .limit(1)
            )
        ).scalar_one_or_none()
        last_px = float(last.close) if last else cost_px
        mv = last_px * qty
        total_value += mv
        total_cost += cost
        breakdown.append(
            {
                "symbol": p.instrument.symbol,
                "mv": round(mv, 4),
                "cost": round(cost, 4),
                "pnl": round(mv - cost, 4),
            }
        )
    pnl = total_value - total_cost
    pnl_pct = (pnl / total_cost * 100) if total_cost else None

    if existing:
        existing.total_value = total_value
        existing.total_cost = total_cost
        existing.pnl = pnl
        existing.pnl_pct = pnl_pct
        existing.breakdown = {"positions": breakdown}
        snap = existing
    else:
        snap = PortfolioSnapshot(
            user_id=user_id,
            as_of=today,
            total_value=total_value,
            total_cost=total_cost,
            pnl=pnl,
            pnl_pct=pnl_pct,
            currency="USD",
            breakdown={"positions": breakdown},
        )
        db.add(snap)
    await db.commit()
    await db.refresh(snap)
    return snap


async def _recent_alert_exists(
    db: AsyncSession, user_id: str, kind: str, symbol: str, hours: int = 18
) -> bool:
    from datetime import timedelta

    since = datetime.now(timezone.utc) - timedelta(hours=hours)
    row = (
        await db.execute(
            select(Alert)
            .where(
                Alert.user_id == user_id,
                Alert.kind == kind,
                Alert.created_at >= since,
            )
            .order_by(Alert.created_at.desc())
            .limit(20)
        )
    ).scalars().all()
    for a in row:
        if (a.payload or {}).get("symbol") == symbol:
            return True
    return False


async def check_price_alerts(db: AsyncSession, user_id: str) -> int:
    n = 0
    # Expiry by tip horizon (intraday/swing/…)
    n += await invalidate_expired_tips(db, user_id)

    # 1) Tip-derived levels
    tips = (
        await db.execute(
            select(Tip)
            .where(Tip.user_id == user_id, Tip.is_active.is_(True))
            .options(selectinload(Tip.instrument))
        )
    ).scalars().all()
    for tip in tips:
        quote = await market_data.fetch_quote(tip.instrument.symbol, tip.instrument.asset_class)
        if quote.price is None:
            continue
        price = quote.price
        # Only stop / target — not entry zone (most tips already sit inside entry → alert flood).
        hit = None
        level_px = None
        if tip.stop and (
            (tip.action.value in ("buy", "trade", "hold") and price <= tip.stop)
            or (tip.action.value == "sell" and price >= tip.stop)
        ):
            hit = "stop"
            level_px = tip.stop
        elif tip.target_1 and (
            (tip.action.value in ("buy", "trade") and price >= tip.target_1)
            or (tip.action.value == "sell" and price <= tip.target_1)
        ):
            hit = "target_1"
            level_px = tip.target_1
        if hit:
            kind = f"price_{hit}"
            if await _recent_alert_exists(db, user_id, kind, tip.instrument.symbol):
                continue
            await create_alert(
                db,
                user_id=user_id,
                kind=kind,
                title=f"{tip.instrument.symbol}: zásah {hit}",
                body=f"Cena {price} zasáhla úroveň {hit} ({level_px}) u tipu #{tip.id}.",
                payload={
                    "tip_id": tip.id,
                    "symbol": tip.instrument.symbol,
                    "price": price,
                    "level": hit,
                    "level_price": level_px,
                },
            )
            # Auto-close: stop = miss, target = hit
            await close_tip(
                db,
                tip,
                result=FeedbackResult.miss if hit == "stop" else FeedbackResult.hit,
                notes=f"Auto-uzavření po zásahu {hit} @ {price:.4f} (level {level_px}).",
                alert=False,  # price_* alert already created
            )
            n += 1

    # 2) User price rules
    rules = (
        await db.execute(
            select(PriceAlertRule)
            .where(PriceAlertRule.user_id == user_id, PriceAlertRule.is_active.is_(True))
            .options(selectinload(PriceAlertRule.instrument))
        )
    ).scalars().all()
    for rule in rules:
        quote = await market_data.fetch_quote(rule.instrument.symbol, rule.instrument.asset_class)
        if quote.price is None:
            continue
        price = quote.price
        level = float(rule.price)
        triggered = False
        if rule.direction == "above" and price >= level:
            triggered = True
        elif rule.direction == "below" and price <= level:
            triggered = True
        elif rule.direction == "cross":
            # within 0.4% band counts as touch
            if abs(price - level) / max(abs(level), 1e-9) <= 0.004:
                triggered = True
        if not triggered:
            continue
        kind = f"rule_{rule.kind}"
        if await _recent_alert_exists(db, user_id, kind, rule.instrument.symbol):
            continue
        rule.last_triggered_at = datetime.now(timezone.utc)
        await create_alert(
            db,
            user_id=user_id,
            kind=kind,
            title=f"{rule.instrument.symbol}: hlídač {rule.kind}",
            body=f"Cena {price:.4f} u úrovně {level:.4f} ({rule.note or rule.kind}).",
            payload={
                "rule_id": rule.id,
                "symbol": rule.instrument.symbol,
                "price": price,
                "level_price": level,
                "kind": rule.kind,
            },
        )
        n += 1

    # Avg-cost / entry / now: only via explicit PriceAlertRule (chart buttons) — no auto spam.

    await db.commit()
    return n
