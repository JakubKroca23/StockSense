/** Canvas palette pulled from the same CSS custom properties the rest of the desk uses. */

export type OrderflowTheme = {
  text: string;
  muted: string;
  line: string;
  sense: string;
  up: string;
  down: string;
  imbalanceBuy: string;
  imbalanceSell: string;
  grid: string;
  bg: string;
  bgSoft: string;
  bgElevated: string;
  font: string;
};

export function readOrderflowTheme(): OrderflowTheme {
  const s = getComputedStyle(document.documentElement);
  const g = (name: string, fallback: string) => s.getPropertyValue(name).trim() || fallback;
  return {
    text: g("--text", "#e8eefc"),
    muted: g("--muted", "#93a0b8"),
    line: g("--line", "#243049"),
    sense: g("--sense", "#5dde8a"),
    up: g("--chart-up", "#5dde8a"),
    down: g("--chart-down", "#e05a8a"),
    imbalanceBuy: g("--chart-up", "#5dde8a"),
    imbalanceSell: g("--chart-down", "#e05a8a"),
    grid: g("--chart-grid", "rgba(158,182,255,0.08)"),
    bg: g("--chart-bg", "#060a12"),
    bgSoft: g("--bg-soft", "#182238"),
    bgElevated: g("--bg-elevated", "#121a2b"),
    font: g("--font-body", '"IBM Plex Sans", sans-serif'),
  };
}

export type OrderflowColorSettings = {
  upColor?: string;
  downColor?: string;
  senseColor?: string;
  textColor?: string;
  imbalanceBuyColor?: string;
  imbalanceSellColor?: string;
};

function pickColor(custom: string | undefined, fallback: string): string {
  const v = custom?.trim();
  return v ? v : fallback;
}

export function resolveOrderflowTheme(settings?: OrderflowColorSettings): OrderflowTheme {
  const base = readOrderflowTheme();
  if (!settings) return base;
  return {
    ...base,
    up: pickColor(settings.upColor, base.up),
    down: pickColor(settings.downColor, base.down),
    imbalanceBuy: pickColor(settings.imbalanceBuyColor, base.up),
    imbalanceSell: pickColor(settings.imbalanceSellColor, base.down),
    sense: pickColor(settings.senseColor, base.sense),
    text: pickColor(settings.textColor, base.text),
  };
}

/** `#rrggbb` + alpha → `rgba()`; non-hex values pass through untouched. */
export function alpha(color: string, a: number): string {
  const raw = color.replace("#", "").trim();
  const clamped = Math.min(1, Math.max(0, a));
  if (raw.length === 3) {
    const r = parseInt(raw[0] + raw[0], 16);
    const g = parseInt(raw[1] + raw[1], 16);
    const b = parseInt(raw[2] + raw[2], 16);
    return `rgba(${r},${g},${b},${clamped})`;
  }
  if (raw.length !== 6 || /[^0-9a-f]/i.test(raw)) return color;
  const r = parseInt(raw.slice(0, 2), 16);
  const g = parseInt(raw.slice(2, 4), 16);
  const b = parseInt(raw.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${clamped})`;
}
