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


def _atr(df: pd.DataFrame, period: int = 14) -> float | None:
    """Wilder ATR (SMA of true range as practical proxy)."""
    if len(df) < period + 1:
        return None
    high, low, close = df["high"], df["low"], df["close"]
    prev_close = close.shift(1)
    tr = pd.concat(
        [(high - low), (high - prev_close).abs(), (low - prev_close).abs()],
        axis=1,
    ).max(axis=1)
    val = tr.rolling(period).mean().iloc[-1]
    return float(val) if pd.notna(val) else None


def _macd_hist(series: pd.Series) -> float | None:
    if len(series) < 35:
        return None
    ema12 = series.ewm(span=12, adjust=False).mean()
    ema26 = series.ewm(span=26, adjust=False).mean()
    macd = ema12 - ema26
    signal = macd.ewm(span=9, adjust=False).mean()
    hist = macd - signal
    val = hist.iloc[-1]
    return float(val) if pd.notna(val) else None


def _rel_strength(asset_closes: pd.Series, bench_closes: pd.Series, lookback: int = 63) -> float | None:
    """Return excess return vs benchmark over ~3 months (daily bars)."""
    if len(asset_closes) < lookback + 1 or len(bench_closes) < lookback + 1:
        lookback = min(len(asset_closes), len(bench_closes)) - 1
    if lookback < 10:
        return None
    a0, a1 = float(asset_closes.iloc[-lookback - 1]), float(asset_closes.iloc[-1])
    b0, b1 = float(bench_closes.iloc[-lookback - 1]), float(bench_closes.iloc[-1])
    if a0 <= 0 or b0 <= 0:
        return None
    return (a1 / a0) - (b1 / b0)


def size_for_risk(risk: RiskProfile, confidence: float, max_pct: float) -> float:
    base = {
        RiskProfile.conservative: 0.35,
        RiskProfile.balanced: 0.65,
        RiskProfile.aggressive: 1.0,
    }[risk]
    return round(min(max_pct, max_pct * base * max(0.2, confidence)), 2)


def _scenarios(
    action: TipAction,
    score: float,
    ta_notes: list[str],
    flow_notes: list[str],
    fund_notes: list[str],
    features: dict,
) -> tuple[str, str, str]:
    rsi = features.get("rsi")
    rs = features.get("rs_vs_bench")
    sma20 = features.get("sma20")
    price = features.get("price")
    atr = features.get("atr")
    struct = "nad SMA20" if sma20 and price and price >= sma20 else "pod SMA20"
    rsi_s = f"RSI {rsi:.0f}" if isinstance(rsi, (int, float)) else "RSI n/a"
    rs_s = f"RS {rs:+.1%}" if isinstance(rs, (int, float)) else "RS n/a"
    key_ta = ta_notes[0] if ta_notes else "TA bez silného signálu"
    key_flow = flow_notes[0] if flow_notes else "flow neutrální"
    key_fund = fund_notes[0] if fund_notes else "fund omezený"

    if action == TipAction.buy or score > 15:
        bull = f"Continuation: {key_ta}; {rs_s}; cena drží {struct}; cíle násobky ATR ({atr:.2f})." if atr else f"Continuation: {key_ta}; {rs_s}."
        base = f"Konsolidace kolem vstupu; čekat potvrzení volume. {rsi_s}. {key_flow}."
        bear = f"Invalidace pod stopem / ztráta {struct}; zhoršení {key_fund} nebo RS."
    elif action == TipAction.sell or score < -15:
        bull = f"Squeeze proti shortu: odraz nad SMA a RS flip; {rsi_s}."
        base = f"Drift níž při slabém flow. {key_ta}; {key_flow}."
        bear = f"Continuation down: breakdown struktury; {rs_s}; {key_fund}."
    else:
        bull = f"Breakout nad range + volume: {key_ta}; {rs_s}."
        base = f"Range / čekání na katalyzátor. {rsi_s}. {key_fund}."
        bear = f"Breakdown range a slabší RS; {key_flow}."
    return bull[:280], base[:280], bear[:280]


def score_instrument(
    bars: list[OhlcvBar],
    quote: QuoteSnapshot,
    asset_class: AssetClass,
    risk: RiskProfile,
    max_position_pct: float,
    macro_bias: float = 0.0,
    feedback_adj: float = 0.0,
    benchmark_bars: list[OhlcvBar] | None = None,
    bars_short: list[OhlcvBar] | None = None,
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
    atr = _atr(df) or (price * 0.02)
    macd_h = _macd_hist(close)
    vol = df["volume"]
    vol_sma = _sma(vol, 20)
    vol_ratio = float(vol.iloc[-1] / vol_sma) if vol_sma and vol_sma > 0 else 1.0

    rs = None
    if benchmark_bars:
        bdf = _bars_to_df(benchmark_bars)
        if not bdf.empty:
            rs = _rel_strength(close, bdf["close"])

    # 52w distance from bars or fundamentals
    f = quote.fundamentals or {}
    high_52 = f.get("fifty_two_week_high")
    low_52 = f.get("fifty_two_week_low")
    if not isinstance(high_52, (int, float)) and len(close) >= 200:
        high_52 = float(close.tail(252).max()) if len(close) >= 252 else float(close.max())
    if not isinstance(low_52, (int, float)) and len(close) >= 200:
        low_52 = float(close.tail(252).min()) if len(close) >= 252 else float(close.min())
    pct_from_high = (
        (price - float(high_52)) / float(high_52) if isinstance(high_52, (int, float)) and high_52 else None
    )

    # Multi-TF: short TF trend vs daily
    mtf_align = None
    if bars_short and len(bars_short) >= 30:
        sdf = _bars_to_df(bars_short)
        s20 = _sma(sdf["close"], 20)
        s50 = _sma(sdf["close"], 50)
        if s20 and s50:
            mtf_align = 1.0 if s20 > s50 else -1.0

    # Technical component (-1..1)
    ta = 0.0
    ta_notes: list[str] = []
    if sma20 and sma50:
        if sma20 > sma50:
            ta += 0.22
            ta_notes.append("SMA20 nad SMA50 (krátkodobý uptrend)")
        else:
            ta -= 0.22
            ta_notes.append("SMA20 pod SMA50 (krátkodobý downtrend)")
    if sma50 and sma200:
        if sma50 > sma200:
            ta += 0.28
            ta_notes.append("SMA50 nad SMA200 (bullish struktura)")
        else:
            ta -= 0.28
            ta_notes.append("SMA50 pod SMA200 (bearish struktura)")
    if rsi is not None:
        if rsi < 30:
            ta += 0.22
            ta_notes.append(f"RSI přeprodané ({rsi:.1f})")
        elif rsi > 70:
            ta -= 0.22
            ta_notes.append(f"RSI překoupené ({rsi:.1f})")
        else:
            ta_notes.append(f"RSI neutrální ({rsi:.1f})")
    if macd_h is not None:
        if macd_h > 0:
            ta += 0.1
            ta_notes.append(f"MACD hist +{macd_h:.3f}")
        else:
            ta -= 0.1
            ta_notes.append(f"MACD hist {macd_h:.3f}")
    if mtf_align is not None:
        ta += 0.08 * mtf_align
        ta_notes.append("Multi-TF aligned (4h↑)" if mtf_align > 0 else "Multi-TF aligned (4h↓)")
    if vol_ratio > 1.5 and ta > 0:
        ta += 0.08
        ta_notes.append(f"Zvýšený objem ({vol_ratio:.1f}×)")
    elif vol_ratio > 1.5 and ta < 0:
        ta -= 0.08
        ta_notes.append(f"Objem při slabosti ({vol_ratio:.1f}×)")

    # Fundamental component (-1..1)
    fund = 0.0
    fund_notes: list[str] = []
    pe = f.get("pe")
    fpe = f.get("forward_pe")
    peg = f.get("peg")
    if isinstance(pe, (int, float)) and pe > 0:
        # Sector-relative proxy: compare trailing vs forward PE / PEG
        if isinstance(fpe, (int, float)) and fpe > 0:
            if pe < fpe * 0.9:
                fund += 0.2
                fund_notes.append(f"P/E {pe:.1f} pod forward {fpe:.1f} (rel. levnější)")
            elif pe > fpe * 1.25:
                fund -= 0.15
                fund_notes.append(f"P/E {pe:.1f} nad forward {fpe:.1f}")
            else:
                fund_notes.append(f"P/E {pe:.1f} / fwd {fpe:.1f}")
        elif pe < 15:
            fund += 0.22
            fund_notes.append(f"Atraktivní P/E ({pe:.1f})")
        elif pe > 35:
            fund -= 0.18
            fund_notes.append(f"Vysoké P/E ({pe:.1f})")
        else:
            fund_notes.append(f"P/E okolo průměru ({pe:.1f})")
    if isinstance(peg, (int, float)) and peg > 0:
        if peg < 1:
            fund += 0.12
            fund_notes.append(f"PEG {peg:.2f}")
        elif peg > 2.5:
            fund -= 0.1
            fund_notes.append(f"Vysoké PEG {peg:.2f}")
    rg = f.get("revenue_growth")
    if isinstance(rg, (int, float)):
        if rg > 0.15:
            fund += 0.22
            fund_notes.append(f"Silný růst tržeb ({rg:.0%})")
        elif rg < 0:
            fund -= 0.18
            fund_notes.append(f"Klesající tržby ({rg:.0%})")
    eg = f.get("earnings_growth") or f.get("eps_surprise_pct")
    if isinstance(eg, (int, float)):
        if eg > 0.1:
            fund += 0.1
            fund_notes.append(f"Earnings growth {eg:.0%}")
        elif eg < -0.1:
            fund -= 0.1
            fund_notes.append(f"Slabé earnings {eg:.0%}")
    roe = f.get("roe")
    if isinstance(roe, (int, float)):
        if roe > 0.15:
            fund += 0.15
            fund_notes.append(f"ROE {roe:.0%}")
        elif roe < 0:
            fund -= 0.12
            fund_notes.append(f"Záporné ROE ({roe:.0%})")
    if f.get("earnings_date"):
        fund_notes.append(f"Earnings: {f.get('earnings_date')}")
    if f.get("sector"):
        fund_notes.append(f"Sektor: {f.get('sector')}")
    funding = f.get("funding_rate")
    if not fund_notes and asset_class != AssetClass.crypto:
        fund_notes.append("Fundamentální data omezená (free zdroje)")

    # Money-flow + RS
    flow = 0.0
    flow_notes: list[str] = []
    if sma20:
        rel = (price - sma20) / sma20
        flow += max(-0.35, min(0.35, rel * 2))
        flow_notes.append(f"Cena vs SMA20: {rel:.1%}")
    if isinstance(rs, (int, float)):
        # RS excess return clipped into flow
        flow += max(-0.25, min(0.25, rs * 1.5))
        bench = "BTC" if asset_class == AssetClass.crypto else "SPY"
        flow_notes.append(f"RS vs {bench} (~3M): {rs:+.1%}")
    if vol_ratio > 1.2:
        flow += 0.12 if ta >= 0 else -0.12
        flow_notes.append("Volume proxy money-flow")
    else:
        flow_notes.append("Volume bez výrazného toku")

    if asset_class in (AssetClass.etf, AssetClass.stock, AssetClass.index) and len(vol) >= 40 and vol_sma:
        prev_vol_sma = float(vol.iloc[-40:-20].mean())
        if prev_vol_sma > 0:
            accel = float(vol.iloc[-1]) / prev_vol_sma
            if accel > 1.8:
                flow += 0.1 if ta >= 0 else -0.06
                flow_notes.append(f"Volume accel {accel:.1f}×")
            elif accel < 0.6:
                flow -= 0.05
                flow_notes.append(f"Slábnoucí volume {accel:.1f}×")

    if isinstance(funding, (int, float)):
        if funding < 0:
            flow += 0.18
            flow_notes.append(f"Záporný funding ({funding:.4f})")
        elif funding > 0.0005:
            flow -= 0.12
            flow_notes.append(f"Vysoký funding ({funding:.4f})")
        else:
            flow_notes.append(f"Funding neutrální ({funding:.4f})")

    if isinstance(pct_from_high, (int, float)):
        if pct_from_high < -0.25:
            flow += 0.05
            flow_notes.append(f"Od 52w high {pct_from_high:.0%}")
        elif pct_from_high > -0.05:
            flow_notes.append(f"Blízko 52w high ({pct_from_high:.0%})")

    macro = max(-0.5, min(0.5, macro_bias))
    macro_notes = [f"Makro bias {macro:+.2f}"]

    learn = max(-0.15, min(0.15, feedback_adj))
    learn_notes = [f"Feedback adj {learn:+.3f}"] if abs(learn) > 0.001 else ["Bez feedback korekce"]

    raw = 0.32 * fund + 0.22 * macro + 0.28 * flow + 0.13 * ta + 0.05 * learn
    score = round(max(-100.0, min(100.0, raw * 100)), 1)

    if score >= 35:
        action = TipAction.buy
    elif score <= -35:
        action = TipAction.sell
    elif abs(score) >= 15:
        action = TipAction.trade
    else:
        action = TipAction.hold

    if abs(score) > 50 and sma200 and ((price > sma200 and score > 0) or (price < sma200 and score < 0)):
        horizon = TipHorizon.position
    elif abs(score) > 25:
        horizon = TipHorizon.swing
    else:
        horizon = TipHorizon.long_term if abs(score) < 10 else TipHorizon.swing

    # Levels from Wilder ATR
    if action == TipAction.buy:
        entry_low, entry_high = price * 0.99, price * 1.01
        stop = price - 1.5 * atr
        t1 = price + 2 * atr
        t2 = price + 3.5 * atr
    elif action == TipAction.sell:
        entry_low, entry_high = price * 0.99, price * 1.01
        stop = price + 1.5 * atr
        t1 = price - 2 * atr
        t2 = price - 3.5 * atr
    else:
        entry_low = entry_high = price
        stop = price - atr if score >= 0 else price + atr
        t1 = price + atr if score >= 0 else price - atr
        t2 = price + 2 * atr if score >= 0 else price - 2 * atr

    confidence = round(
        min(
            0.95,
            0.35
            + abs(raw) * 0.5
            + (0.08 if f.get("pe") or f.get("sector") else 0)
            + (0.05 if rs is not None else 0),
        ),
        2,
    )
    if risk == RiskProfile.conservative and confidence < 0.55 and action in (TipAction.buy, TipAction.sell):
        action = TipAction.hold

    features = {
        "price": round(price, 4),
        "rsi": round(rsi, 2) if rsi is not None else None,
        "sma20": round(sma20, 4) if sma20 is not None else None,
        "sma50": round(sma50, 4) if sma50 is not None else None,
        "sma200": round(sma200, 4) if sma200 is not None else None,
        "atr": round(atr, 4),
        "macd_hist": round(macd_h, 5) if macd_h is not None else None,
        "vol_ratio": round(vol_ratio, 3),
        "rs_vs_bench": round(rs, 4) if rs is not None else None,
        "pct_from_52w_high": round(pct_from_high, 4) if pct_from_high is not None else None,
        "mtf_align": mtf_align,
        "earnings_date": f.get("earnings_date"),
        "sector": f.get("sector"),
        "industry": f.get("industry"),
    }

    bull, base, bear = _scenarios(action, score, ta_notes, flow_notes, fund_notes, features)

    dq = quote.data_quality
    if bars:
        order = [
            DataQuality.high,
            DataQuality.medium,
            DataQuality.low,
            DataQuality.proxy,
            DataQuality.unavailable,
        ]
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
        scenario_bull=bull,
        scenario_base=base,
        scenario_bear=bear,
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
            "features": features,
            "last_price": price,
        },
        risks="Free data mohou být zpožděná; tip není investiční doporučení. Vždy ověř invalidaci a sizing.",
        data_quality=dq,
        suggested_size_pct=size_for_risk(risk, confidence, max_position_pct),
    )
