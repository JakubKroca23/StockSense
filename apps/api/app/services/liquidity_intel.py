"""24/7 liquidity + price intelligence: ingest → features → hypothesis eval → LLM memory."""

from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timedelta, timezone
from statistics import mean
from typing import Any

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models import HypothesisTrial, LiqAnalysis, LiqFeatureBar, LiqSnapshot, TradingHypothesis
from app.services.crypto_market import DEFAULT_CRYPTO_SYMBOLS, get_crypto_market
from app.services.llm import LLMTask, llm_complete

logger = logging.getLogger(__name__)

NEAR_BAND_PCT = 0.35  # % of mid for "near" book volume
WALL_BAND_PCT = 1.2


def _intel_symbols() -> list[str]:
    settings = get_settings()
    raw = (settings.liq_intel_symbols or "").strip()
    if raw:
        return [s.strip().upper().replace("-", "/") for s in raw.split(",") if s.strip()]
    return list(DEFAULT_CRYPTO_SYMBOLS)


def _features_from_book(book: dict, quote_change_pct: float | None = None) -> dict[str, Any] | None:
    mid = book.get("mid")
    if mid is None or mid <= 0:
        bb, ba = book.get("best_bid"), book.get("best_ask")
        if bb and ba:
            mid = (bb + ba) / 2.0
    if not mid or mid <= 0:
        return None

    near = mid * (NEAR_BAND_PCT / 100.0)
    wall_band = mid * (WALL_BAND_PCT / 100.0)

    bid_vol = 0.0
    ask_vol = 0.0
    wall_bid_price = None
    wall_bid_size = 0.0
    wall_ask_price = None
    wall_ask_size = 0.0

    for lvl in book.get("bids") or []:
        price = float(lvl["price"])
        amount = float(lvl["amount"])
        if mid - price <= near:
            bid_vol += amount
        if mid - price <= wall_band and amount >= wall_bid_size:
            wall_bid_size = amount
            wall_bid_price = price

    for lvl in book.get("asks") or []:
        price = float(lvl["price"])
        amount = float(lvl["amount"])
        if price - mid <= near:
            ask_vol += amount
        if price - mid <= wall_band and amount >= wall_ask_size:
            wall_ask_size = amount
            wall_ask_price = price

    denom = bid_vol + ask_vol
    imbalance = ((bid_vol - ask_vol) / denom) if denom > 0 else 0.0
    spread_pct = book.get("spread_pct")
    spread_bps = float(spread_pct) * 100.0 if spread_pct is not None else None

    wall_bid_dist = ((mid - wall_bid_price) / mid * 10_000) if wall_bid_price else None
    wall_ask_dist = ((wall_ask_price - mid) / mid * 10_000) if wall_ask_price else None

    return {
        "mid": float(mid),
        "best_bid": book.get("best_bid"),
        "best_ask": book.get("best_ask"),
        "spread_bps": spread_bps,
        "bid_vol_near": bid_vol,
        "ask_vol_near": ask_vol,
        "imbalance": imbalance,
        "wall_bid_price": wall_bid_price,
        "wall_bid_size": wall_bid_size,
        "wall_ask_price": wall_ask_price,
        "wall_ask_size": wall_ask_size,
        "wall_bid_dist_bps": wall_bid_dist,
        "wall_ask_dist_bps": wall_ask_dist,
        "quote_change_pct": quote_change_pct,
    }


async def sample_symbol(db: AsyncSession, symbol: str) -> LiqSnapshot | None:
    market = get_crypto_market()
    try:
        book, quote = await asyncio_gather_safe(symbol, market)
    except Exception as exc:
        logger.warning("liq sample %s failed: %s", symbol, exc)
        return None

    change = None
    if quote is not None:
        change = getattr(quote, "change_pct", None)

    feats = _features_from_book(book, change)
    if not feats:
        return None

    snap = LiqSnapshot(
        symbol=symbol,
        ts=datetime.now(timezone.utc),
        mid=feats["mid"],
        best_bid=feats["best_bid"],
        best_ask=feats["best_ask"],
        spread_bps=feats["spread_bps"],
        bid_vol_near=feats["bid_vol_near"],
        ask_vol_near=feats["ask_vol_near"],
        imbalance=feats["imbalance"],
        wall_bid_price=feats["wall_bid_price"],
        wall_bid_size=feats["wall_bid_size"],
        wall_ask_price=feats["wall_ask_price"],
        wall_ask_size=feats["wall_ask_size"],
        wall_bid_dist_bps=feats["wall_bid_dist_bps"],
        wall_ask_dist_bps=feats["wall_ask_dist_bps"],
        quote_change_pct=feats["quote_change_pct"],
        meta={"exchanges": book.get("exchanges") or []},
    )
    db.add(snap)
    return snap


async def asyncio_gather_safe(symbol: str, market) -> tuple[dict, Any]:
    import asyncio

    book_coro = market.fetch_aggregated_order_book(symbol, limit=120)
    quote_coro = market.fetch_aggregated_quote(symbol)
    book, quote = await asyncio.gather(book_coro, quote_coro, return_exceptions=True)
    if isinstance(book, Exception):
        raise book
    if isinstance(quote, Exception):
        quote = None
    return book, quote


async def run_ingest_cycle(db: AsyncSession) -> dict[str, Any]:
    symbols = _intel_symbols()
    ok = 0
    errors: list[str] = []
    for sym in symbols:
        try:
            snap = await sample_symbol(db, sym)
            if snap:
                ok += 1
        except Exception as exc:
            errors.append(f"{sym}: {exc}")
            logger.warning("ingest %s: %s", sym, exc)
    await db.commit()
    return {"ok": ok, "symbols": len(symbols), "errors": errors[:8]}


def _floor_minute(ts: datetime) -> datetime:
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    return ts.replace(second=0, microsecond=0)


async def roll_feature_bars(db: AsyncSession, lookback_minutes: int = 5) -> int:
    """Aggregate recent snapshots into 1m feature bars."""
    since = datetime.now(timezone.utc) - timedelta(minutes=lookback_minutes + 1)
    rows = (
        await db.execute(
            select(LiqSnapshot)
            .where(LiqSnapshot.ts >= since)
            .order_by(LiqSnapshot.symbol, LiqSnapshot.ts)
        )
    ).scalars().all()
    if not rows:
        return 0

    buckets: dict[tuple[str, datetime], list[LiqSnapshot]] = {}
    for snap in rows:
        key = (snap.symbol, _floor_minute(snap.ts))
        buckets.setdefault(key, []).append(snap)

    written = 0
    for (symbol, ts), snaps in buckets.items():
        mids = [s.mid for s in snaps if s.mid]
        if not mids:
            continue
        spreads = [s.spread_bps for s in snaps if s.spread_bps is not None]
        imbs = [s.imbalance for s in snaps]
        existing = (
            await db.execute(
                select(LiqFeatureBar).where(LiqFeatureBar.symbol == symbol, LiqFeatureBar.ts == ts)
            )
        ).scalar_one_or_none()
        mid_open, mid_close = mids[0], mids[-1]
        ret = ((mid_close - mid_open) / mid_open * 100.0) if mid_open else 0.0
        payload = dict(
            mid_open=mid_open,
            mid_high=max(mids),
            mid_low=min(mids),
            mid_close=mid_close,
            mid_ret_pct=ret,
            spread_bps_avg=mean(spreads) if spreads else None,
            imbalance_avg=mean(imbs) if imbs else 0.0,
            imbalance_max=max(imbs, key=abs) if imbs else 0.0,
            bid_vol_avg=mean([s.bid_vol_near for s in snaps]),
            ask_vol_avg=mean([s.ask_vol_near for s in snaps]),
            wall_bid_size_max=max(s.wall_bid_size for s in snaps),
            wall_ask_size_max=max(s.wall_ask_size for s in snaps),
            samples=len(snaps),
        )
        if existing:
            for k, v in payload.items():
                setattr(existing, k, v)
        else:
            db.add(LiqFeatureBar(symbol=symbol, ts=ts, **payload))
            written += 1
    await db.commit()
    return written


def _conditions_match(bar: LiqFeatureBar, conditions: dict) -> bool:
    if not conditions:
        return False
    checks: list[tuple[str, Any, Any]] = [
        ("imbalance_gt", bar.imbalance_avg, "gt"),
        ("imbalance_lt", bar.imbalance_avg, "lt"),
        ("imbalance_abs_gt", abs(bar.imbalance_avg), "gt"),
        ("spread_bps_lt", bar.spread_bps_avg, "lt"),
        ("spread_bps_gt", bar.spread_bps_avg, "gt"),
        ("wall_bid_size_gt", bar.wall_bid_size_max, "gt"),
        ("wall_ask_size_gt", bar.wall_ask_size_max, "gt"),
        ("bid_ask_vol_ratio_gt", None, "ratio_gt"),
        ("mid_ret_pct_gt", bar.mid_ret_pct, "gt"),
        ("mid_ret_pct_lt", bar.mid_ret_pct, "lt"),
    ]
    matched_any = False
    for key, left, op in checks:
        if key not in conditions:
            continue
        thr = conditions[key]
        matched_any = True
        if key == "bid_ask_vol_ratio_gt":
            denom = bar.ask_vol_avg or 1e-9
            left = bar.bid_vol_avg / denom
            if not (left > float(thr)):
                return False
            continue
        if left is None:
            return False
        if op == "gt" and not (left > float(thr)):
            return False
        if op == "lt" and not (left < float(thr)):
            return False
    return matched_any


async def open_hypothesis_trials(db: AsyncSession) -> int:
    """Scan latest feature bars and open paper trials when conditions fire."""
    hyps = (
        await db.execute(
            select(TradingHypothesis).where(TradingHypothesis.status.in_(("active", "candidate")))
        )
    ).scalars().all()
    if not hyps:
        return 0

    now = datetime.now(timezone.utc)
    since = now - timedelta(minutes=3)
    bars = (
        await db.execute(select(LiqFeatureBar).where(LiqFeatureBar.ts >= since))
    ).scalars().all()
    opened = 0

    for hyp in hyps:
        relevant = [b for b in bars if hyp.symbol in ("*", b.symbol)]
        for bar in relevant:
            if not _conditions_match(bar, hyp.conditions or {}):
                continue
            # avoid duplicate open trials for same minute
            exists = (
                await db.execute(
                    select(HypothesisTrial).where(
                        HypothesisTrial.hypothesis_id == hyp.id,
                        HypothesisTrial.triggered_at == bar.ts,
                    )
                )
            ).scalar_one_or_none()
            if exists:
                continue
            open_count = (
                await db.execute(
                    select(func.count())
                    .select_from(HypothesisTrial)
                    .where(
                        HypothesisTrial.hypothesis_id == hyp.id,
                        HypothesisTrial.status == "open",
                    )
                )
            ).scalar_one()
            if int(open_count or 0) >= 8:
                break
            horizon = max(5, min(int(hyp.horizon_minutes or 15), 240))
            db.add(
                HypothesisTrial(
                    hypothesis_id=hyp.id,
                    symbol=bar.symbol,
                    triggered_at=bar.ts,
                    resolve_at=bar.ts + timedelta(minutes=horizon),
                    entry_mid=bar.mid_close,
                    status="open",
                    meta={"conditions": hyp.conditions},
                )
            )
            hyp.last_triggered_at = now
            opened += 1
    await db.commit()
    return opened


async def resolve_hypothesis_trials(db: AsyncSession) -> int:
    now = datetime.now(timezone.utc)
    open_trials = (
        await db.execute(
            select(HypothesisTrial).where(
                HypothesisTrial.status == "open",
                HypothesisTrial.resolve_at <= now,
            )
        )
    ).scalars().all()
    if not open_trials:
        return 0

    resolved = 0
    for trial in open_trials:
        hyp = (
            await db.execute(
                select(TradingHypothesis).where(TradingHypothesis.id == trial.hypothesis_id)
            )
        ).scalar_one_or_none()
        bar = (
            await db.execute(
                select(LiqFeatureBar)
                .where(
                    LiqFeatureBar.symbol == trial.symbol,
                    LiqFeatureBar.ts >= trial.resolve_at - timedelta(minutes=1),
                )
                .order_by(LiqFeatureBar.ts.asc())
                .limit(1)
            )
        ).scalar_one_or_none()
        if not bar:
            # fallback: latest bar after trigger
            bar = (
                await db.execute(
                    select(LiqFeatureBar)
                    .where(
                        LiqFeatureBar.symbol == trial.symbol,
                        LiqFeatureBar.ts >= trial.triggered_at,
                    )
                    .order_by(LiqFeatureBar.ts.desc())
                    .limit(1)
                )
            ).scalar_one_or_none()
        if not bar or not trial.entry_mid:
            if trial.resolve_at < now - timedelta(hours=6):
                trial.status = "expired"
            continue

        exit_mid = bar.mid_close
        move = (exit_mid - trial.entry_mid) / trial.entry_mid * 100.0
        direction = (hyp.direction if hyp else "long") or "long"
        if direction == "short":
            won = move <= -abs(float(hyp.expected_move_pct if hyp else 0.05))
        elif direction == "long":
            won = move >= abs(float(hyp.expected_move_pct if hyp else 0.05))
        else:
            won = abs(move) >= abs(float(hyp.expected_move_pct if hyp else 0.05))

        trial.exit_mid = exit_mid
        trial.move_pct = move
        trial.won = won
        trial.status = "resolved"
        if hyp:
            hyp.trials = int(hyp.trials or 0) + 1
            if won:
                hyp.wins = int(hyp.wins or 0) + 1
            # running avg of absolute moves toward expected direction
            n = hyp.trials
            hyp.avg_move_pct = ((hyp.avg_move_pct or 0.0) * (n - 1) + move) / n
            hyp.last_eval_at = now
            # auto promote / retire
            if hyp.trials >= 12:
                wr = hyp.wins / hyp.trials
                if wr >= 0.55 and hyp.status == "candidate":
                    hyp.status = "active"
                elif wr < 0.38 and hyp.status in ("candidate", "active"):
                    hyp.status = "retired"
                    hyp.notes = (hyp.notes or "") + f"\n[auto-retired wr={wr:.2f}]"
        resolved += 1
    await db.commit()
    return resolved


def _slugify(text: str) -> str:
    s = re.sub(r"[^a-zA-Z0-9]+", "-", (text or "").lower()).strip("-")
    return (s or "hyp")[:72]


def _extract_json(text: str) -> dict | list | None:
    if not text:
        return None
    text = text.strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
    if fence:
        try:
            return json.loads(fence.group(1).strip())
        except json.JSONDecodeError:
            pass
    for pat in (r"\{[\s\S]*\}", r"\[[\s\S]*\]"):
        m = re.search(pat, text)
        if m:
            try:
                return json.loads(m.group(0))
            except json.JSONDecodeError:
                continue
    return None


async def _build_llm_context(db: AsyncSession, window_minutes: int) -> tuple[str, list[str]]:
    since = datetime.now(timezone.utc) - timedelta(minutes=window_minutes)
    symbols = _intel_symbols()
    parts: list[str] = [f"Okno: posledních {window_minutes} min. Symboly: {', '.join(symbols)}"]

    for sym in symbols:
        bars = (
            await db.execute(
                select(LiqFeatureBar)
                .where(LiqFeatureBar.symbol == sym, LiqFeatureBar.ts >= since)
                .order_by(LiqFeatureBar.ts.asc())
            )
        ).scalars().all()
        if not bars:
            parts.append(f"\n## {sym}\n(žádné 1m bary)")
            continue
        rets = [b.mid_ret_pct for b in bars]
        imbs = [b.imbalance_avg for b in bars]
        spreads = [b.spread_bps_avg for b in bars if b.spread_bps_avg is not None]
        parts.append(
            f"\n## {sym}\n"
            f"- bary: {len(bars)}\n"
            f"- mid {bars[0].mid_open:.4f} → {bars[-1].mid_close:.4f} "
            f"(sum ret {sum(rets):.3f}%)\n"
            f"- imbalance avg {mean(imbs):.3f}, max|imb| {max(abs(x) for x in imbs):.3f}\n"
            f"- spread_bps avg {mean(spreads) if spreads else 0:.2f}\n"
            f"- max wall bid/ask {max(b.wall_bid_size_max for b in bars):.2f} / "
            f"{max(b.wall_ask_size_max for b in bars):.2f}\n"
            f"- last bar imb={bars[-1].imbalance_avg:.3f} ret={bars[-1].mid_ret_pct:.3f}%"
        )

    hyps = (
        await db.execute(
            select(TradingHypothesis)
            .where(TradingHypothesis.status != "retired")
            .order_by(TradingHypothesis.updated_at.desc())
            .limit(40)
        )
    ).scalars().all()
    parts.append("\n## Existující hypotézy (paměť)")
    if not hyps:
        parts.append("(zatím žádné)")
    for h in hyps:
        wr = (h.wins / h.trials) if h.trials else None
        parts.append(
            f"- [{h.status}] {h.slug} | {h.symbol} {h.direction} {h.horizon_minutes}m | "
            f"trials={h.trials} wins={h.wins} wr={wr if wr is not None else 'n/a'} "
            f"avg_move={h.avg_move_pct:.3f}% | cond={json.dumps(h.conditions, ensure_ascii=False)} | "
            f"{h.title}"
        )

    recent = (
        await db.execute(select(LiqAnalysis).order_by(LiqAnalysis.ts.desc()).limit(3))
    ).scalars().all()
    if recent:
        parts.append("\n## Poslední LLM analýzy")
        for a in recent:
            parts.append(f"- {a.ts.isoformat()}: {(a.summary or '')[:400]}")

    return "\n".join(parts), symbols


async def upsert_hypotheses_from_llm(db: AsyncSession, payload: dict | list) -> int:
    items: list[dict]
    if isinstance(payload, list):
        items = [x for x in payload if isinstance(x, dict)]
    elif isinstance(payload, dict):
        raw = payload.get("hypotheses") or payload.get("items") or []
        items = [x for x in raw if isinstance(x, dict)]
        if not items and payload.get("slug"):
            items = [payload]
    else:
        return 0

    touched = 0
    for item in items[:12]:
        title = str(item.get("title") or item.get("name") or "").strip()[:255]
        if not title:
            continue
        slug = str(item.get("slug") or _slugify(title))[:80]
        direction = str(item.get("direction") or "long").lower()
        if direction not in ("long", "short", "neutral"):
            direction = "long"
        symbol = str(item.get("symbol") or "*").upper().replace("-", "/")
        horizon = int(item.get("horizon_minutes") or 15)
        horizon = max(5, min(horizon, 240))
        conditions = item.get("conditions") if isinstance(item.get("conditions"), dict) else {}
        expected = float(item.get("expected_move_pct") or 0.1)
        status = str(item.get("status") or "candidate").lower()
        if status not in ("candidate", "active", "retired"):
            status = "candidate"
        notes = str(item.get("notes") or item.get("rationale") or "")[:2000] or None
        action = str(item.get("action") or "upsert").lower()

        existing = (
            await db.execute(select(TradingHypothesis).where(TradingHypothesis.slug == slug))
        ).scalar_one_or_none()

        if action == "retire" and existing:
            existing.status = "retired"
            existing.notes = ((existing.notes or "") + f"\n[llm retire] {notes or ''}").strip()
            touched += 1
            continue

        if existing:
            existing.title = title
            existing.direction = direction
            existing.symbol = symbol
            existing.horizon_minutes = horizon
            if conditions:
                existing.conditions = conditions
            existing.expected_move_pct = expected
            if status != "retired":
                # don't override active→candidate downward unless asked
                if not (existing.status == "active" and status == "candidate"):
                    existing.status = status
            if notes:
                existing.notes = notes
            existing.updated_at = datetime.now(timezone.utc)
        else:
            db.add(
                TradingHypothesis(
                    slug=slug,
                    title=title,
                    symbol=symbol,
                    direction=direction,
                    horizon_minutes=horizon,
                    conditions=conditions or {"imbalance_abs_gt": 0.35},
                    expected_move_pct=expected,
                    status=status,
                    notes=notes,
                    origin="llm",
                )
            )
        touched += 1
    await db.commit()
    return touched


async def run_llm_review(db: AsyncSession, window_minutes: int | None = None) -> dict[str, Any]:
    settings = get_settings()
    window = window_minutes or int(settings.liq_intel_llm_window_minutes)
    context, symbols = await _build_llm_context(db, window)

    prompt = (
        "Jsi výzkumný microstructure analytik pro crypto spot (Binance+Bybit agg).\n"
        "Na základě DAT hledej využitelné souvislosti likvidity a ceny pro paper-trading hypotézy.\n"
        "NEVYMYŠLEJ čísla mimo data. Nevyzývej k real tradingu.\n\n"
        "Vrať VÝHRADNĚ JSON objekt:\n"
        "{\n"
        '  "summary": "2-5 vět česky",\n'
        '  "insights": ["..."],\n'
        '  "hypotheses": [\n'
        "    {\n"
        '      "slug": "btc-imb-bid-wall",\n'
        '      "title": "krátký název",\n'
        '      "symbol": "BTC/USDT" | "*",\n'
        '      "direction": "long"|"short"|"neutral",\n'
        '      "horizon_minutes": 15,\n'
        '      "expected_move_pct": 0.12,\n'
        '      "status": "candidate",\n'
        '      "action": "upsert"|"retire",\n'
        '      "conditions": {\n'
        '         "imbalance_gt": 0.4,\n'
        '         "spread_bps_lt": 8,\n'
        '         "wall_bid_size_gt": 12,\n'
        '         "imbalance_abs_gt": 0.35,\n'
        '         "bid_ask_vol_ratio_gt": 1.4\n'
        "      },\n"
        '      "notes": "proč"\n'
        "    }\n"
        "  ],\n"
        '  "lessons": ["co se nepotvrdilo / upravit"]\n'
        "}\n"
        "Používej jen klíče conditions z nabídky výše. "
        "Uprav/retire hypotézy se špatným winrate. Max 6 hypotheses."
    )

    raw = await llm_complete(prompt, task=LLMTask.heavy, context=context)
    parsed = _extract_json(raw) or {}
    if not isinstance(parsed, dict):
        parsed = {"hypotheses": parsed if isinstance(parsed, list) else [], "summary": str(raw)[:1500]}

    touched = await upsert_hypotheses_from_llm(db, parsed)
    summary = str(parsed.get("summary") or "")[:4000]
    if not summary and raw:
        summary = raw[:1500]

    analysis = LiqAnalysis(
        ts=datetime.now(timezone.utc),
        window_minutes=window,
        symbols=symbols,
        summary=summary,
        findings={
            "insights": parsed.get("insights") or [],
            "lessons": parsed.get("lessons") or [],
            "raw_preview": (raw or "")[:2500],
        },
        hypotheses_touched=touched,
        model="gemini",
        meta={"window": window},
    )
    db.add(analysis)
    await db.commit()
    return {
        "summary": summary,
        "hypotheses_touched": touched,
        "insights": parsed.get("insights") or [],
        "analysis_id": analysis.id,
    }


async def purge_old_snapshots(db: AsyncSession) -> int:
    days = max(1, int(get_settings().liq_intel_retain_days))
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    res = await db.execute(delete(LiqSnapshot).where(LiqSnapshot.ts < cutoff))
    await db.commit()
    return int(res.rowcount or 0)


async def ensure_seed_hypotheses(db: AsyncSession) -> int:
    """Bootstrap a few measurable hypotheses so the eval loop has work before first LLM."""
    existing = (
        await db.execute(select(func.count()).select_from(TradingHypothesis))
    ).scalar_one()
    if int(existing or 0) > 0:
        return 0
    seeds = [
        {
            "slug": "imb-long-tight-spread",
            "title": "Silný bid imbalance + úzký spread → long",
            "symbol": "*",
            "direction": "long",
            "horizon_minutes": 15,
            "expected_move_pct": 0.08,
            "conditions": {"imbalance_gt": 0.35, "spread_bps_lt": 10},
            "notes": "seed",
        },
        {
            "slug": "imb-short-tight-spread",
            "title": "Silný ask imbalance + úzký spread → short",
            "symbol": "*",
            "direction": "short",
            "horizon_minutes": 15,
            "expected_move_pct": 0.08,
            "conditions": {"imbalance_lt": -0.35, "spread_bps_lt": 10},
            "notes": "seed",
        },
        {
            "slug": "bid-wall-support",
            "title": "Velká bid wall blízko mid → long bounce",
            "symbol": "*",
            "direction": "long",
            "horizon_minutes": 20,
            "expected_move_pct": 0.1,
            "conditions": {"wall_bid_size_gt": 5, "imbalance_gt": 0.15},
            "notes": "seed",
        },
    ]
    for s in seeds:
        db.add(
            TradingHypothesis(
                slug=s["slug"],
                title=s["title"],
                symbol=s["symbol"],
                direction=s["direction"],
                horizon_minutes=s["horizon_minutes"],
                expected_move_pct=s["expected_move_pct"],
                conditions=s["conditions"],
                status="candidate",
                notes=s["notes"],
                origin="seed",
            )
        )
    await db.commit()
    return len(seeds)


async def get_status(db: AsyncSession) -> dict[str, Any]:
    await ensure_seed_hypotheses(db)
    settings = get_settings()
    now = datetime.now(timezone.utc)
    snap_count = (
        await db.execute(select(func.count()).select_from(LiqSnapshot))
    ).scalar_one()
    feat_count = (
        await db.execute(select(func.count()).select_from(LiqFeatureBar))
    ).scalar_one()
    hyp_active = (
        await db.execute(
            select(func.count())
            .select_from(TradingHypothesis)
            .where(TradingHypothesis.status.in_(("active", "candidate")))
        )
    ).scalar_one()
    last_snap = (
        await db.execute(select(LiqSnapshot).order_by(LiqSnapshot.ts.desc()).limit(1))
    ).scalar_one_or_none()
    last_analysis = (
        await db.execute(select(LiqAnalysis).order_by(LiqAnalysis.ts.desc()).limit(1))
    ).scalar_one_or_none()
    recent_analyses = (
        await db.execute(select(LiqAnalysis).order_by(LiqAnalysis.ts.desc()).limit(5))
    ).scalars().all()
    top_hyps = (
        await db.execute(
            select(TradingHypothesis)
            .where(TradingHypothesis.status.in_(("active", "candidate", "retired")))
            .order_by(TradingHypothesis.trials.desc())
            .limit(12)
        )
    ).scalars().all()

    open_trials = (
        await db.execute(
            select(func.count())
            .select_from(HypothesisTrial)
            .where(HypothesisTrial.status == "open")
        )
    ).scalar_one()

    return {
        "enabled": bool(settings.enable_liq_intel),
        "symbols": _intel_symbols(),
        "sample_seconds": settings.liq_intel_sample_seconds,
        "llm_minutes": settings.liq_intel_llm_minutes,
        "snapshots": int(snap_count or 0),
        "feature_bars": int(feat_count or 0),
        "hypotheses_alive": int(hyp_active or 0),
        "open_trials": int(open_trials or 0),
        "last_snapshot_at": last_snap.ts.isoformat() if last_snap else None,
        "last_analysis_at": last_analysis.ts.isoformat() if last_analysis else None,
        "last_summary": (last_analysis.summary if last_analysis else None),
        "age_seconds": (now - last_snap.ts).total_seconds() if last_snap else None,
        "recent_analyses": [
            {
                "ts": a.ts.isoformat() if a.ts else None,
                "summary": a.summary,
                "insights": (a.findings or {}).get("insights") or [],
                "lessons": (a.findings or {}).get("lessons") or [],
                "hypotheses_touched": a.hypotheses_touched,
            }
            for a in recent_analyses
        ],
        "hypotheses": [
            {
                "slug": h.slug,
                "title": h.title,
                "symbol": h.symbol,
                "direction": h.direction,
                "status": h.status,
                "trials": h.trials,
                "wins": h.wins,
                "winrate": (h.wins / h.trials) if h.trials else None,
                "avg_move_pct": h.avg_move_pct,
                "horizon_minutes": h.horizon_minutes,
                "conditions": h.conditions,
                "notes": (h.notes or "")[:240],
            }
            for h in top_hyps
        ],
    }


def format_bot_brief(status: dict[str, Any], *, max_chars: int = 3500) -> str:
    """Compact Czech brief for Sense bot / chat context."""
    lines: list[str] = [
        "LIQUIDITY INTEL (24/7 smyčka — sledování likvidity + ceny, LLM hypotézy, paper eval):",
        f"- stav: {'ZAPNUTO' if status.get('enabled') else 'vypnuto'}",
        f"- symboly: {', '.join(status.get('symbols') or [])}",
        f"- sample každých {status.get('sample_seconds')}s · LLM review každých {status.get('llm_minutes')} min",
        f"- snapshots: {status.get('snapshots')} · 1m bary: {status.get('feature_bars')} · "
        f"živé hyp: {status.get('hypotheses_alive')} · otevřené trialy: {status.get('open_trials')}",
    ]
    age = status.get("age_seconds")
    if age is not None:
        lines.append(f"- stáří posledního snapshotu: {int(age)}s")
    if status.get("last_snapshot_at"):
        lines.append(f"- last snapshot: {status['last_snapshot_at']}")
    if status.get("last_analysis_at"):
        lines.append(f"- last LLM analýza: {status['last_analysis_at']}")
    if status.get("last_summary"):
        lines.append(f"- poslední shrnutí: {str(status['last_summary'])[:500]}")

    hyps = status.get("hypotheses") or []
    if hyps:
        lines.append("- hypotézy (trials/wins/wr):")
        for h in hyps[:10]:
            wr = h.get("winrate")
            wr_s = f"{wr:.0%}" if isinstance(wr, (int, float)) else "n/a"
            lines.append(
                f"  · [{h.get('status')}] {h.get('slug')} {h.get('symbol')} {h.get('direction')} "
                f"{h.get('horizon_minutes')}m | {h.get('wins')}/{h.get('trials')} wr={wr_s} "
                f"avg_move={h.get('avg_move_pct')}% | {h.get('title')}"
            )
            if h.get("notes"):
                lines.append(f"    pozn: {h['notes'][:160]}")

    analyses = status.get("recent_analyses") or []
    if analyses:
        lines.append("- poslední LLM analýzy:")
        for a in analyses[:4]:
            lines.append(f"  · {a.get('ts')}: {(a.get('summary') or '')[:280]}")
            insights = a.get("insights") or []
            if insights:
                lines.append("    insights: " + "; ".join(str(x)[:120] for x in insights[:4]))
            lessons = a.get("lessons") or []
            if lessons:
                lines.append("    lessons: " + "; ".join(str(x)[:120] for x in lessons[:3]))

    text = "\n".join(lines)
    return text if len(text) <= max_chars else text[: max_chars - 1] + "…"


async def build_external_briefing(db: AsyncSession, *, hours: int = 48) -> dict[str, Any]:
    """Full briefing package for pasting into an external LLM."""
    hours = max(6, min(int(hours), 168))
    status = await get_status(db)
    since = datetime.now(timezone.utc) - timedelta(hours=hours)

    feature_lines: list[str] = []
    for sym in status.get("symbols") or []:
        bars = (
            await db.execute(
                select(LiqFeatureBar)
                .where(LiqFeatureBar.symbol == sym, LiqFeatureBar.ts >= since)
                .order_by(LiqFeatureBar.ts.asc())
            )
        ).scalars().all()
        if not bars:
            feature_lines.append(f"## {sym}\n(žádné 1m bary za {hours}h)")
            continue
        rets = [b.mid_ret_pct for b in bars]
        imbs = [b.imbalance_avg for b in bars]
        spreads = [b.spread_bps_avg for b in bars if b.spread_bps_avg is not None]
        feature_lines.append(
            f"## {sym}\n"
            f"- bars={len(bars)}\n"
            f"- mid {bars[0].mid_open:.6g} → {bars[-1].mid_close:.6g} "
            f"(sum_ret={sum(rets):.3f}%)\n"
            f"- imbalance avg={mean(imbs):.3f} max_abs={max(abs(x) for x in imbs):.3f}\n"
            f"- spread_bps avg={mean(spreads) if spreads else 0:.2f}\n"
            f"- max wall bid/ask "
            f"{max(b.wall_bid_size_max for b in bars):.4g} / "
            f"{max(b.wall_ask_size_max for b in bars):.4g}\n"
            f"- last: imb={bars[-1].imbalance_avg:.3f} ret={bars[-1].mid_ret_pct:.3f}% "
            f"spread={bars[-1].spread_bps_avg}"
        )

    resolved = (
        await db.execute(
            select(HypothesisTrial)
            .where(
                HypothesisTrial.status == "resolved",
                HypothesisTrial.triggered_at >= since,
            )
            .order_by(HypothesisTrial.triggered_at.desc())
            .limit(40)
        )
    ).scalars().all()
    trial_lines: list[str] = []
    for t in resolved:
        trial_lines.append(
            f"- hyp_id={t.hypothesis_id} {t.symbol} @ {t.triggered_at.isoformat()} "
            f"→ move={t.move_pct}% won={t.won} entry={t.entry_mid} exit={t.exit_mid}"
        )

    hyps = (
        await db.execute(
            select(TradingHypothesis).order_by(TradingHypothesis.updated_at.desc()).limit(40)
        )
    ).scalars().all()
    hyp_block = []
    for h in hyps:
        wr = (h.wins / h.trials) if h.trials else None
        hyp_block.append(
            {
                "slug": h.slug,
                "title": h.title,
                "symbol": h.symbol,
                "direction": h.direction,
                "horizon_minutes": h.horizon_minutes,
                "expected_move_pct": h.expected_move_pct,
                "conditions": h.conditions,
                "status": h.status,
                "trials": h.trials,
                "wins": h.wins,
                "winrate": wr,
                "avg_move_pct": h.avg_move_pct,
                "notes": h.notes,
            }
        )

    analyses = (
        await db.execute(select(LiqAnalysis).order_by(LiqAnalysis.ts.desc()).limit(8))
    ).scalars().all()

    prompt = (
        "Jsi research analytik pro crypto microstructure (spot Binance+Bybit).\n"
        "Dostaneš data ze StockSense Liquidity Intel (paper hypotézy + 1m features).\n"
        "Úkol:\n"
        "1) Shrň stav za poslední okno.\n"
        "2) Které hypotézy HOLD / RETIRE / UPRAVIT (s důvodem z dat).\n"
        "3) Navrhni max 5 nových testovatelných hypotéz "
        "(conditions jen: imbalance_gt/lt, imbalance_abs_gt, spread_bps_lt/gt, "
        "wall_bid_size_gt, wall_ask_size_gt, bid_ask_vol_ratio_gt, mid_ret_pct_gt/lt).\n"
        "4) Rizika / overfitting.\n"
        "Nevymýšlej čísla mimo DATA. Odpověz česky, strukturovaně.\n"
    )

    data_md = "\n".join(
        [
            f"# StockSense Liquidity Intel briefing",
            f"generated_at: {datetime.now(timezone.utc).isoformat()}",
            f"window_hours: {hours}",
            "",
            "## Runtime status",
            format_bot_brief(status, max_chars=6000),
            "",
            f"## Feature bars ({hours}h)",
            "\n".join(feature_lines) if feature_lines else "(žádná data)",
            "",
            "## Hypotheses (JSON)",
            json.dumps(hyp_block, ensure_ascii=False, indent=2),
            "",
            f"## Recent resolved trials ({hours}h)",
            "\n".join(trial_lines) if trial_lines else "(žádné)",
            "",
            "## Recent internal analyses",
            "\n".join(
                f"- {a.ts.isoformat()}: {(a.summary or '')[:500]}\n"
                f"  insights={(a.findings or {}).get('insights')}\n"
                f"  lessons={(a.findings or {}).get('lessons')}"
                for a in analyses
            )
            or "(žádné)",
        ]
    )

    text = f"{prompt}\n---\nDATA:\n{data_md}\n"
    return {
        "hours": hours,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "chars": len(text),
        "text": text,
        "prompt": prompt,
        "status": status,
    }
