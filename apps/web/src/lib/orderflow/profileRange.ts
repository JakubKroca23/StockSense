import type { ProfileRange } from "./types";

export const PROFILE_RANGES: { id: ProfileRange; label: string }[] = [
  { id: "visible", label: "Viditelné" },
  { id: "all", label: "Celé období" },
  { id: "day", label: "Den" },
  { id: "hour", label: "Hodina" },
  { id: "custom", label: "Vlastní" },
];

export const PROFILE_SESSION_MINUTES = [5, 15, 30, 60, 120, 240, 480, 720, 1440] as const;

export type ProfileSessionSlice = {
  /** Calendar/bucket start (UTC midnight for a day profile). */
  startMs: number;
  /** Exclusive calendar/bucket end — not the last bar. */
  endMs: number;
  from: number;
  to: number;
};

export function isPeriodicProfile(range: ProfileRange | undefined): boolean {
  return range === "day" || range === "hour" || range === "custom";
}

export function profileUsesRightColumn(range: ProfileRange | undefined): boolean {
  return !isPeriodicProfile(range);
}

export function clampProfileSessionMinutes(n: number): number {
  if (!Number.isFinite(n)) return 60;
  return Math.min(10_080, Math.max(1, Math.round(n)));
}

export function sessionStartMs(ms: number, range: ProfileRange, customMinutes: number): number {
  const t = Number.isFinite(ms) ? ms : 0;
  if (range === "day") {
    const d = new Date(t);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  }
  if (range === "hour") {
    const d = new Date(t);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours());
  }
  const bucket = clampProfileSessionMinutes(customMinutes) * 60_000;
  return Math.floor(t / bucket) * bucket;
}

export function sessionEndMs(startMs: number, range: ProfileRange, customMinutes: number): number {
  if (range === "day") return startMs + 86_400_000;
  if (range === "hour") return startMs + 3_600_000;
  return startMs + clampProfileSessionMinutes(customMinutes) * 60_000;
}

/** UTC midnight of the current calendar day — the DOM session window. */
export function currentSessionStartMs(now = Date.now()): number {
  return sessionStartMs(now, "day", 1440);
}

function barTimeMs(ts: string): number {
  const s = ts.trim();
  const hasTz = /[zZ]|[+-]\d{2}:?\d{2}$/.test(s);
  const t = new Date(hasTz ? s : `${s}Z`).getTime();
  return Number.isFinite(t) ? t : NaN;
}

/** Buy/sell volume at price for the current UTC day, from footprint bars. */
export function sessionVolumeAtPrice(
  bars: { ts: string; levels: { price: number; buy: number; sell: number }[] }[] | undefined,
  step: number,
  now = Date.now()
): Map<number, { buy: number; sell: number }> {
  const cutoff = currentSessionStartMs(now);
  const map = new Map<number, { buy: number; sell: number }>();
  const bucket = Math.max(1e-9, step);
  for (const bar of bars ?? []) {
    const t = barTimeMs(bar.ts);
    if (!Number.isFinite(t) || t < cutoff) continue;
    for (const level of bar.levels) {
      if (!Number.isFinite(level.price)) continue;
      const key = Math.round(level.price / bucket);
      const cur = map.get(key);
      if (cur) {
        cur.buy += level.buy;
        cur.sell += level.sell;
      } else {
        map.set(key, { buy: level.buy, sell: level.sell });
      }
    }
  }
  return map;
}

export function splitProfileSessions(
  bars: { timeMs: number }[],
  range: ProfileRange,
  customMinutes: number
): ProfileSessionSlice[] {
  if (!isPeriodicProfile(range) || !bars.length) return [];
  const out: ProfileSessionSlice[] = [];
  let from = 0;
  let start = sessionStartMs(bars[0].timeMs, range, customMinutes);
  for (let i = 1; i <= bars.length; i += 1) {
    const t = i < bars.length ? bars[i].timeMs : null;
    const nextStart = t != null ? sessionStartMs(t, range, customMinutes) : null;
    if (nextStart === start) continue;
    out.push({
      startMs: start,
      endMs: sessionEndMs(start, range, customMinutes),
      from,
      to: i - 1,
    });
    if (t != null && nextStart != null) {
      from = i;
      start = nextStart;
    }
  }
  return out;
}

export function formatSessionLabel(startMs: number, range: ProfileRange): string {
  const d = new Date(startMs);
  const pad = (n: number) => String(n).padStart(2, "0");
  if (range === "day") return `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}`;
  if (range === "hour") return `${pad(d.getUTCHours())}:00`;
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}
