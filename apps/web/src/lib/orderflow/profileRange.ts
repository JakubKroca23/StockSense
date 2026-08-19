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
  startMs: number;
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
    const last = bars[i - 1];
    out.push({
      startMs: start,
      endMs: last.timeMs,
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
