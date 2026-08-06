"use client";

/** Shared slot math helpers — entertainment only, not real gambling. */

export type Payline = number[]; // row index per reel (0 top …)

export const CLASSIC_10_LINES: Payline[] = [
  [1, 1, 1, 1, 1],
  [0, 0, 0, 0, 0],
  [2, 2, 2, 2, 2],
  [0, 1, 2, 1, 0],
  [2, 1, 0, 1, 2],
  [0, 0, 1, 0, 0],
  [2, 2, 1, 2, 2],
  [1, 0, 0, 0, 1],
  [1, 2, 2, 2, 1],
  [0, 1, 1, 1, 0],
];

export function weightedPick<T extends string>(weights: Record<T, number>): T {
  const entries = Object.entries(weights) as [T, number][];
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  for (const [sym, w] of entries) {
    r -= w;
    if (r <= 0) return sym;
  }
  return entries[entries.length - 1][0];
}

export function buildReelStrip(symbols: string[], len = 28): string[] {
  const strip: string[] = [];
  for (let i = 0; i < len; i++) {
    strip.push(symbols[i % symbols.length]);
  }
  // shuffle lightly
  for (let i = strip.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [strip[i], strip[j]] = [strip[j], strip[i]];
  }
  return strip;
}

export function evalLine(
  grid: string[][],
  line: Payline,
  wild: string,
  paytable: Record<string, number[]>
): { symbol: string; count: number; winMult: number } | null {
  const cells = line.map((row, reel) => grid[reel][row]);
  let symbol = cells.find((c) => c !== wild) || wild;
  let count = 0;
  for (const c of cells) {
    if (c === symbol || c === wild) count += 1;
    else break;
  }
  if (count < 3) return null;
  const pays = paytable[symbol];
  if (!pays) return null;
  const winMult = pays[count - 1] || 0;
  if (winMult <= 0) return null;
  return { symbol, count, winMult };
}

export function countScatters(grid: string[][], scatter: string): number {
  let n = 0;
  for (const col of grid) for (const cell of col) if (cell === scatter) n += 1;
  return n;
}

export function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
