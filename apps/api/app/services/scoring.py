from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from app.models import AssetClass, DataQuality, RiskProfile, TipAction, TipHorizon
from app.services.market_data import OhlcvBar, QuoteSnapshot


@dataclass
class ScoreResult:
    action: TipAction
    horizon: TipHorizon
    score: float
    confidence: float
    entry_low: float | None
    entry_high: float | None
    stop: float | None
    target_1: float | None
    target_2: float | None
    scenario_bull: str
    scenario_base: str
    scenario_bear: str
    rationale: dict
    risks: str
    data_quality: DataQuality
    suggested_size_pct: float


def _bars_to_df(bars: list[OhlcvBar]) -> pd.DataFrame:
    if not bars:
        return pd.DataFrame()
    df = pd.DataFrame(
        {
            "ts": [b.ts for b in bars],
            "open": [b.open for b in bars],
            "high": [b.high for b in bars],
            "low": [b.low for b in bars],
            "close": [b.close for b in bars],
            "volume": [b.volume for b in bars],
        }
    ).sort_values("ts")
    return df


def _rsi(series: pd.Series, period: int = 14) -> float | None:
    if len(series) < period + 1:
        return None
    delta = series.diff()
    gain = delta.clip(lower=0).rolling(period).mean()
    loss = (-delta.clip(upper=0)).rolling(period).mean()
    rs = gain / loss.replace(0, np.nan)
    rsi = 100 - (100 / (1 + rs))
    val = rsi.iloc[-1]
    return float(val) if pd.notna(val) else None


def _sma(series: pd.Series, period: int) -> float | None:
    if len(series) < period:
        return None
    val = series.rolling(period).mean().iloc[-1]
    return float(val) if pd.notna(val) else None


def size_for_risk(risk: RiskProfile, confidence: float, max_pct: float) -> float:
    base = {
        RiskProfile.conservative: 0.35,
        RiskProfile.balanced: 0.65,
        RiskProfile.aggressive: 1.0,
    }[risk]
    return round(min(max_pct, max_pct * base * max(0.2, confidence)), 2)


def score_instrument(
    bars: list[OhlcvBar],
    quote: QuoteSnapshot,
    asset_class: AssetClass,
    risk: RiskProfile,
    max_position_pct: float,
    macro_bias: float = 0.0,
    feedback_adj: float = 0.0,
) -> ScoreResult | None:
    df = _bars_to_df(bars)
    if df.empty or quote.price is None:
        return None

    close = df["close"]
    price = float(quote.price)
    rsi = _rsi(close)
    sma20 = _sma(close, 20)
    sma50 = _sma(close, 50)
    sma200 = _sma(close, 200)
    vol = df["volume"]
    vol_sma = _sma(vol, 20)
    vol_ratio = float(vol.iloc[-1] / vol_sma) if vol_sma and vol_sma > 0 else 1.0

    # Technical component (-1..1)
    ta = 0.0
    ta_notes: list[str] = []
    if sma20 and sma50:
        if sma20 > sma50:
            ta += 0.25
            ta_notes.append("SMA20 nad SMA50 (krátkodobý uptrend)")
        else:
            ta -= 0.25
            ta_notes.append("SMA20 pod SMA50 (krátkodobý downtrend)")
    if sma50 and sma200:
        if sma50 > sma200:
            ta += 0.3
            ta_notes.append("SMA50 nad SMA200 (bullish struktura)")
        else:
            ta -= 0.3
            ta_notes.append("SMA50 pod SMA200 (bearish struktura)")
    if rsi is not None:
        if rsi < 30:
            ta += 0.25
            ta_notes.append(f"RSI přeprodané ({rsi:.1f})")
        elif rsi > 70:
            ta -= 0.25
            ta_notes.append(f"RSI překoupené ({rsi:.1f})")
        else:
            ta_notes.append(f"RSI neutrální ({rsi:.1f})")
    if vol_ratio > 1.5 and ta > 0:
        ta += 0.1
        ta_notes.append(f"Zvýšený objem ({vol_ratio:.1f}× průměru)")
    elif vol_ratio > 1.5 and ta < 0:
        ta -= 0.1
        ta_notes.append(f"Zvýšený objem při slabosti ({vol_ratio:.1f}×)")

    # Fundamental component (-1..1)
    fund = 0.0
    fund_notes: list[str] = []
    f = quote.fundamentals or {}
    pe = f.get("pe")
    if isinstance(pe, (int, float)) and pe > 0:
        if pe < 15:
            fund += 0.25
            fund_notes.append(f"Atraktivní P/E ({pe:.1f})")
        elif pe > 35:
            fund -= 0.2
            fund_notes.append(f"Vysoké P/E ({pe:.1f})")
        else:
            fund_notes.append(f"P/E okolo průměru ({pe:.1f})")
    rg = f.get("revenue_growth")
    if isinstance(rg, (int, float)):
        if rg > 0.15:
            fund += 0.25
            fund_notes.append(f"Silný růst tržeb ({rg:.0%})")
        elif rg < 0:
            fund -= 0.2
            fund_notes.append(f"Klesající tržby ({rg:.0%})")
    roe = f.get("roe")
    if isinstance(roe, (int, float)):
        if roe > 0.15:
            fund += 0.2
            fund_notes.append(f"ROE {roe:.0%}")
        elif roe < 0:
            fund -= 0.15
            fund_notes.append(f"Záporné ROE ({roe:.0%})")
    funding = f.get("funding_rate")
    # Funding belongs in money-flow, not classic fundament
    if not fund_notes and asset_class != AssetClass.crypto:
        fund_notes.append("Fundamentální data omezená (free zdroje)")

    # Money-flow: volume + price vs SMA + crypto funding + ETF volume acceleration proxy
    flow = 0.0
    flow_notes: list[str] = []
    if sma20:
        rel = (price - sma20) / sma20
        flow += max(-0.4, min(0.4, rel * 2))
        flow_notes.append(f"Cena vs SMA20: {rel:.1%}")
    if vol_ratio > 1.2:
        flow += 0.15 if ta >= 0 else -0.15
        flow_notes.append("Volume proxy money-flow")
    else:
        flow_notes.append("Volume bez výrazného toku")

    # ETF / stock: volume acceleration vs prior 20d avg of volume ratios (proxy for flows)
    if asset_class in (AssetClass.etf, AssetClass.stock, AssetClass.index) and len(vol) >= 40 and vol_sma:
        prev_vol_sma = float(vol.iloc[-40:-20].mean()) if len(vol) >= 40 else None
        if prev_vol_sma and prev_vol_sma > 0:
            accel = float(vol.iloc[-1]) / prev_vol_sma
            if accel > 1.8:
                flow += 0.12 if ta >= 0 else -0.08
                flow_notes.append(f"ETF/stock volume accel {accel:.1f}× (proxy flow)")
            elif accel < 0.6:
                flow -= 0.05
                flow_notes.append(f"Slábnoucí volume accel {accel:.1f}×")

    if isinstance(funding, (int, float)):
        if funding < 0:
            flow += 0.18
            flow_notes.append(f"Záporný funding ({funding:.4f}) — short pressure / squeeze bias")
        elif funding > 0.0005:
            flow -= 0.12
            flow_notes.append(f"Vysoký funding ({funding:.4f}) — crowded longs")
        else:
            flow_notes.append(f"Funding neutrální ({funding:.4f})")

    # Macro bias external (-1..1)
    macro = max(-0.5, min(0.5, macro_bias))
    macro_notes = [f"Makro bias {macro:+.2f}"]

    # Learning nudge from historical tip feedback (small)
    learn = max(-0.15, min(0.15, feedback_adj))
    learn_notes = [f"Feedback adj {learn:+.3f}"] if abs(learn) > 0.001 else ["Bez feedback korekce"]

    # Weighted score (plan priorities: fundament+macro, money flow, TA)
    raw = 0.32 * fund + 0.22 * macro + 0.28 * flow + 0.13 * ta + 0.05 * learn
    score = round(max(-100.0, min(100.0, raw * 100)), 1)

    # Action mapping
    if score >= 35:
        action = TipAction.buy
    elif score <= -35:
        action = TipAction.sell
    elif abs(score) >= 15:
        action = TipAction.trade
    else:
        action = TipAction.hold

    # Horizon heuristic
    if abs(score) > 50 and sma200 and ((price > sma200 and score > 0) or (price < sma200 and score < 0)):
        horizon = TipHorizon.position
    elif abs(score) > 25:
        horizon = TipHorizon.swing
    else:
        horizon = TipHorizon.long_term if abs(score) < 10 else TipHorizon.swing

    atr_proxy = float((df["high"] - df["low"]).tail(14).mean()) if len(df) >= 14 else price * 0.02
    if action == TipAction.buy:
        entry_low, entry_high = price * 0.99, price * 1.01
        stop = price - 1.5 * atr_proxy
        t1 = price + 2 * atr_proxy
        t2 = price + 3.5 * atr_proxy
    elif action == TipAction.sell:
        entry_low, entry_high = price * 0.99, price * 1.01
        stop = price + 1.5 * atr_proxy
        t1 = price - 2 * atr_proxy
        t2 = price - 3.5 * atr_proxy
    else:
        entry_low = entry_high = price
        stop = price - atr_proxy if score >= 0 else price + atr_proxy
        t1 = price + atr_proxy if score >= 0 else price - atr_proxy
        t2 = price + 2 * atr_proxy if score >= 0 else price - 2 * atr_proxy

    confidence = round(min(0.95, 0.35 + abs(raw) * 0.5 + (0.1 if f else 0)), 2)
    if risk == RiskProfile.conservative and confidence < 0.55 and action in (TipAction.buy, TipAction.sell):
        action = TipAction.hold

    dq = quote.data_quality
    if bars:
        # worst of quote and bars
        order = [DataQuality.high, DataQuality.medium, DataQuality.low, DataQuality.proxy, DataQuality.unavailable]
        dq = order[max(order.index(quote.data_quality), order.index(bars[-1].data_quality))]

    return ScoreResult(
        action=action,
        horizon=horizon,
        score=score,
        confidence=confidence,
        entry_low=round(entry_low, 4),
        entry_high=round(entry_high, 4),
        stop=round(stop, 4),
        target_1=round(t1, 4),
        target_2=round(t2, 4),
        scenario_bull="Makro a flow podpoří continuation; cena udrží strukturu nad klíčovými průměry.",
        scenario_base="Range / mírný drift podle score; čekat na potvrzení volume a katalyzátoru.",
        scenario_bear="Breakdown struktury a zhoršení makro/flow invaliduje setup u stopu.",
        rationale={
            "fundament": fund_notes,
            "makro": macro_notes,
            "money_flow": flow_notes,
            "technicka": ta_notes,
            "feedback": learn_notes,
            "components": {
                "fundament": round(fund, 3),
                "makro": round(macro, 3),
                "money_flow": round(flow, 3),
                "technicka": round(ta, 3),
                "feedback": round(learn, 3),
            },
            "last_price": price,
        },
        risks="Free data mohou být zpožděná; tip není investiční doporučení. Vždy ověř invalidaci a sizing.",
        data_quality=dq,
        suggested_size_pct=size_for_risk(risk, confidence, max_position_pct),
    )
