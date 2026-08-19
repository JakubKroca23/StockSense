/** Canvas palette pulled from the same CSS custom properties the rest of the desk uses. */

export type OrderflowTheme = {
  text: string;
  muted: string;
  line: string;
  sense: string;
  up: string;
  down: string;
  candleUp: string;
  candleDown: string;
  fontBuy: string;
  fontSell: string;
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
    candleUp: g("--chart-up", "#5dde8a"),
    candleDown: g("--chart-down", "#e05a8a"),
    fontBuy: g("--chart-up", "#5dde8a"),
    fontSell: g("--chart-down", "#e05a8a"),
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
  fontBuyColor?: string;
  fontSellColor?: string;
  candleUpColor?: string;
  candleDownColor?: string;
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
    candleUp: pickColor(settings.candleUpColor, base.candleUp),
    candleDown: pickColor(settings.candleDownColor, base.candleDown),
    fontBuy: pickColor(settings.fontBuyColor, pickColor(settings.upColor, base.up)),
    fontSell: pickColor(settings.fontSellColor, pickColor(settings.downColor, base.down)),
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

function parseRgb(color: string): [number, number, number] | null {
  const hex = color.replace("#", "").trim();
  if (hex.length === 3 && /^[0-9a-f]+$/i.test(hex)) {
    return [parseInt(hex[0] + hex[0], 16), parseInt(hex[1] + hex[1], 16), parseInt(hex[2] + hex[2], 16)];
  }
  if (hex.length === 6 && /^[0-9a-f]+$/i.test(hex)) {
    return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
  }
  const m = color.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function relativeLuminance(r: number, g: number, b: number) {
  const lin = (c: number) => {
    const s = Math.max(0, Math.min(255, c)) / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrastRatio(a: number, b: number) {
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  return (hi + 0.05) / (lo + 0.05);
}

const TEXT_ON_LIGHT = "#121820";
const TEXT_ON_DARK = "#f4f7ff";

/** If `preferred` would wash out on the pixel under (x, y), swap to a high-contrast ink. */
export function contrastOnCanvas(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  preferred: string
): string {
  const fg = parseRgb(preferred);
  if (!fg) return preferred;
  const t = ctx.getTransform();
  const px = Math.round(x * t.a + t.e);
  const py = Math.round(y * t.d + t.f);
  if (px < 0 || py < 0 || px >= ctx.canvas.width || py >= ctx.canvas.height) return preferred;
  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(px, py, 1, 1).data;
  } catch {
    return preferred;
  }
  const bgLum = relativeLuminance(data[0], data[1], data[2]);
  const fgLum = relativeLuminance(fg[0], fg[1], fg[2]);
  if (contrastRatio(fgLum, bgLum) >= 3) return preferred;
  return bgLum > 0.42 ? TEXT_ON_LIGHT : TEXT_ON_DARK;
}
