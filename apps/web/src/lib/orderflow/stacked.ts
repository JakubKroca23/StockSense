import type { OrderflowBar, StackedZone } from "./footprint";

export function resolveStackedDash(style: "solid" | "dashed" | "dotted"): number[] {
  if (style === "dotted") return [2, 3];
  if (style === "solid") return [];
  return [5, 4];
}

/**
 * Extend a stacked zone only until price first trades back through it.
 * Returns the first intersecting future bar index, or `bars.length` if untouched.
 */
export function findStackedZoneEndIndex(
  bars: OrderflowBar[],
  zone: StackedZone,
  startIndex: number
): number {
  for (let i = Math.max(startIndex + 1, zone.barIndex + 1); i < bars.length; i += 1) {
    const bar = bars[i];
    if (bar.high >= zone.from && bar.low <= zone.to) {
      return i;
    }
  }
  return bars.length;
}

/** Extend a horizontal level until price first trades through it. */
export function findLevelTouchEndIndex(
  bars: OrderflowBar[],
  price: number,
  startIndex: number
): number {
  for (let i = Math.max(startIndex + 1, 0); i < bars.length; i += 1) {
    const bar = bars[i];
    if (bar.high >= price && bar.low <= price) return i;
  }
  return bars.length;
}
