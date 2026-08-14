import type { Time, UTCTimestamp } from "lightweight-charts";
import type { LinePoint, OhlcvBar } from "./types";

export function asUnix(ts: string | number | Date): UTCTimestamp {
  const ms = typeof ts === "number" ? (ts < 1e12 ? ts * 1000 : ts) : new Date(ts).getTime();
  return Math.floor(ms / 1000) as UTCTimestamp;
}

export function toLine(bars: OhlcvBar[]): LinePoint[] {
  return bars.map((b) => ({ time: b.time, value: b.close }));
}

export function sma(bars: OhlcvBar[], params: { period?: number } = {}): LinePoint[] {
  const period = Math.max(1, Math.round(params.period ?? 20));
  const out: LinePoint[] = [];
  let sum = 0;
  for (let i = 0; i < bars.length; i++) {
    sum += bars[i].close;
    if (i >= period) sum -= bars[i - period].close;
    if (i >= period - 1) out.push({ time: bars[i].time, value: sum / period });
  }
  return out;
}

export function ema(bars: OhlcvBar[], params: { period?: number } = {}): LinePoint[] {
  const period = Math.max(1, Math.round(params.period ?? 20));
  if (!bars.length) return [];
  const k = 2 / (period + 1);
  const out: LinePoint[] = [];
  let prev = bars[0].close;
  for (let i = 0; i < bars.length; i++) {
    prev = i === 0 ? bars[0].close : bars[i].close * k + prev * (1 - k);
    if (i >= period - 1) out.push({ time: bars[i].time, value: prev });
  }
  return out;
}

/** Wilder RSI. */
export function rsi(bars: OhlcvBar[], params: { period?: number } = {}): LinePoint[] {
  const period = Math.max(2, Math.round(params.period ?? 14));
  if (bars.length < period + 1) return [];
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = bars[i].close - bars[i - 1].close;
    if (d >= 0) gain += d;
    else loss -= d;
  }
  gain /= period;
  loss /= period;
  const out: LinePoint[] = [];
  const push = (time: Time, g: number, l: number) => {
    const rs = l <= 1e-12 ? 100 : 100 - 100 / (1 + g / l);
    out.push({ time, value: rs });
  };
  push(bars[period].time, gain, loss);
  for (let i = period + 1; i < bars.length; i++) {
    const d = bars[i].close - bars[i - 1].close;
    gain = (gain * (period - 1) + Math.max(d, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-d, 0)) / period;
    push(bars[i].time, gain, loss);
  }
  return out;
}

const REGISTRY = { sma, ema, rsi } as const;
export type IndicatorName = keyof typeof REGISTRY;

export function applyIndicator(
  bars: OhlcvBar[],
  name: IndicatorName,
  params?: { period?: number }
): LinePoint[] {
  return REGISTRY[name](bars, params);
}

export function injectLine<T extends { setData: (d: LinePoint[]) => void }>(
  series: T | null,
  points: LinePoint[]
) {
  series?.setData(points);
}
