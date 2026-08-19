import { computeValueArea } from "./footprint";

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

export function tpoLetter(index: number): string {
  if (index < 0) return "?";
  if (index < LETTERS.length) return LETTERS[index];
  const hi = Math.floor(index / LETTERS.length) - 1;
  return `${tpoLetter(hi)}${LETTERS[index % LETTERS.length]}`;
}

export type TpoBarInput = {
  ts: string;
  high: number;
  low: number;
  volume?: number;
  levels?: { price: number; buy: number; sell: number }[];
};

export type TpoPeriod = {
  letter: string;
  index: number;
  startMs: number;
  endMs: number;
  keys: number[];
  high: number;
  low: number;
  volume: number;
};

export type TpoProfile = {
  periods: TpoPeriod[];
  byKey: Map<number, string[]>;
  counts: Map<number, number>;
  pocKey: number | null;
  vahKey: number | null;
  valKey: number | null;
  maxTpo: number;
  step: number;
};

function barMs(ts: string) {
  const n = Date.parse(ts);
  return Number.isFinite(n) ? n : 0;
}

function keysForBar(bar: TpoBarInput, step: number): { keys: Set<number>; volume: number } {
  const keys = new Set<number>();
  let volume = 0;
  if (bar.levels?.length) {
    for (const level of bar.levels) {
      if (!Number.isFinite(level.price)) continue;
      keys.add(Math.round(level.price / step));
      volume += (level.buy ?? 0) + (level.sell ?? 0);
    }
  }
  if (!keys.size && Number.isFinite(bar.high) && Number.isFinite(bar.low)) {
    const lo = Math.round(Math.min(bar.low, bar.high) / step);
    const hi = Math.round(Math.max(bar.low, bar.high) / step);
    for (let k = lo; k <= hi; k += 1) keys.add(k);
    volume += bar.volume ?? 0;
  }
  if (!volume) volume = bar.volume ?? keys.size;
  return { keys, volume };
}

/** Group bars into TPO letters and a composite profile with POC / value area. */
export function buildTpoProfile(bars: TpoBarInput[], step: number, blockMinutes: number): TpoProfile {
  const blockMs = Math.max(1, blockMinutes) * 60_000;
  const periods: TpoPeriod[] = [];
  const byKey = new Map<number, string[]>();
  const counts = new Map<number, number>();

  if (!(step > 0) || !bars.length) {
    return { periods, byKey, counts, pocKey: null, vahKey: null, valKey: null, maxTpo: 0, step };
  }

  let current: {
    startMs: number;
    endMs: number;
    keys: Set<number>;
    high: number;
    low: number;
    volume: number;
  } | null = null;

  const flush = () => {
    if (!current || !current.keys.size) {
      current = null;
      return;
    }
    const index = periods.length;
    const letter = tpoLetter(index);
    const keys = [...current.keys].sort((a, b) => a - b);
    periods.push({
      letter,
      index,
      startMs: current.startMs,
      endMs: current.endMs,
      keys,
      high: current.high,
      low: current.low,
      volume: current.volume,
    });
    for (const key of keys) {
      const letters = byKey.get(key) ?? [];
      letters.push(letter);
      byKey.set(key, letters);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    current = null;
  };

  for (const bar of bars) {
    const t = barMs(bar.ts);
    if (!t) continue;
    const { keys, volume } = keysForBar(bar, step);
    if (!keys.size) continue;
    let high = bar.high;
    let low = bar.low;
    if (!Number.isFinite(high) || !Number.isFinite(low)) {
      const arr = [...keys];
      low = arr[0] * step;
      high = arr[arr.length - 1] * step;
    }
    if (!current) {
      current = { startMs: t, endMs: t, keys, high, low, volume };
      continue;
    }
    if (t - current.startMs >= blockMs) {
      flush();
      current = { startMs: t, endMs: t, keys, high, low, volume };
      continue;
    }
    current.endMs = t;
    current.volume += volume;
    current.high = Math.max(current.high, high);
    current.low = Math.min(current.low, low);
    for (const key of keys) current.keys.add(key);
  }
  flush();

  let maxTpo = 0;
  let pocKey: number | null = null;
  const rows: { price: number; volume: number }[] = [];
  for (const [key, count] of counts) {
    if (count > maxTpo) {
      maxTpo = count;
      pocKey = key;
    }
    rows.push({ price: key * step, volume: count });
  }
  rows.sort((a, b) => a.price - b.price);
  const va = computeValueArea(rows, 70);
  const vahKey = va.vah != null ? Math.round(va.vah / step) : null;
  const valKey = va.val != null ? Math.round(va.val / step) : null;

  return { periods, byKey, counts, pocKey, vahKey, valKey, maxTpo, step };
}
