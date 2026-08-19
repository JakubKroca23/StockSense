/**
 * Footprint / orderflow math.
 *
 * Raw `/desk/{id}/footprint` bars carry buy+sell volume per tick. This module folds them
 * into render-ready rows and derives the classic cluster-chart signals: diagonal
 * imbalances, stacked zones, per-bar POC / value area, exhaustion fades, absorption
 * and cumulative delta.
 */

import type { FootprintBar } from "./types";

/**
 * Only the knobs that change the numbers — kept separate from render settings so
 * zooming or recolouring never triggers a full recompute.
 */
export type OrderflowCalcOptions = {
  tickGroup: number;
  imbalance: boolean;
  imbalanceRatio: number;
  imbalanceMinVolume: number;
  stacked: boolean;
  stackedMin: number;
  fade: boolean;
  absorption: boolean;
  absorptionRatio: number;
  valueArea: boolean;
  valueAreaPct: number;
};

export type OrderflowCell = {
  /** Bucketed price (row anchor). */
  price: number;
  /** Integer row key = price / step, keeps float prices comparable. */
  key: number;
  buy: number;
  sell: number;
  volume: number;
  delta: number;
  buyImbalance: boolean;
  sellImbalance: boolean;
  stacked: boolean;
  poc: boolean;
  valueArea: boolean;
  fade: boolean;
};

export type StackedZone = {
  side: "buy" | "sell";
  from: number;
  to: number;
  fromKey: number;
  toKey: number;
  count: number;
  barIndex: number;
};

export type OrderflowBar = {
  ts: string;
  timeMs: number;
  open: number;
  high: number;
  low: number;
  close: number;
  buy: number;
  sell: number;
  volume: number;
  delta: number;
  deltaPct: number;
  cvd: number;
  poc: number | null;
  pocKey: number | null;
  vah: number | null;
  val: number | null;
  maxCell: number;
  minKey: number;
  maxKey: number;
  cells: OrderflowCell[];
  zones: StackedZone[];
  absorption: "buy" | "sell" | null;
};

export type OrderflowSeries = {
  bars: OrderflowBar[];
  step: number;
  digits: number;
  /** Largest single-cell volume across the set — shared heat scale. */
  maxCell: number;
  maxBarVolume: number;
  maxAbsDelta: number;
  cvdMin: number;
  cvdMax: number;
};

export type ProfileRow = { key: number; price: number; buy: number; sell: number; volume: number };

export type ValueArea = { poc: number | null; vah: number | null; val: number | null };

export type ProfileResult = ValueArea & {
  rows: ProfileRow[];
  maxVolume: number;
  total: number;
};

const EMPTY_SERIES: OrderflowSeries = {
  bars: [],
  step: 0,
  digits: 2,
  maxCell: 0,
  maxBarVolume: 0,
  maxAbsDelta: 0,
  cvdMin: 0,
  cvdMax: 0,
};

export function priceDigitsForStep(step: number): number {
  if (!Number.isFinite(step) || step <= 0) return 2;
  const digits = Math.ceil(-Math.log10(step) + 1e-9);
  return Math.min(8, Math.max(0, digits));
}

/**
 * Market Profile value area: start at the POC row, then repeatedly swallow whichever
 * pair of rows (above vs below) holds more volume until `pct` of the total is inside.
 */
export function computeValueArea(rows: { price: number; volume: number }[], pct: number): ValueArea {
  if (!rows.length) return { poc: null, vah: null, val: null };
  let pocIdx = 0;
  for (let i = 1; i < rows.length; i += 1) {
    if (rows[i].volume > rows[pocIdx].volume) pocIdx = i;
  }
  const total = rows.reduce((acc, r) => acc + r.volume, 0);
  const target = total * (Math.min(100, Math.max(1, pct)) / 100);
  let lo = pocIdx;
  let hi = pocIdx;
  let acc = rows[pocIdx].volume;
  while (acc < target) {
    const up: number[] = [];
    if (hi + 1 < rows.length) up.push(hi + 1);
    if (hi + 2 < rows.length) up.push(hi + 2);
    const down: number[] = [];
    if (lo - 1 >= 0) down.push(lo - 1);
    if (lo - 2 >= 0) down.push(lo - 2);
    if (!up.length && !down.length) break;
    const upVol = up.reduce((a, i) => a + rows[i].volume, 0);
    const downVol = down.reduce((a, i) => a + rows[i].volume, 0);
    if (up.length && (!down.length || upVol >= downVol)) {
      acc += upVol;
      hi = up[up.length - 1];
    } else {
      acc += downVol;
      lo = down[down.length - 1];
    }
  }
  return { poc: rows[pocIdx].price, vah: rows[hi].price, val: rows[lo].price };
}

function bucketBar(bar: FootprintBar, step: number, digits: number) {
  const map = new Map<number, { buy: number; sell: number }>();
  let minKey = Number.POSITIVE_INFINITY;
  let maxKey = Number.NEGATIVE_INFINITY;
  for (const level of bar.levels) {
    if (!Number.isFinite(level.price)) continue;
    const key = Math.round(level.price / step);
    const cur = map.get(key);
    if (cur) {
      cur.buy += level.buy;
      cur.sell += level.sell;
    } else {
      map.set(key, { buy: level.buy, sell: level.sell });
    }
    if (key < minKey) minKey = key;
    if (key > maxKey) maxKey = key;
  }
  if (!map.size) return null;
  const cells: OrderflowCell[] = [];
  for (let key = minKey; key <= maxKey; key += 1) {
    const hit = map.get(key);
    const buy = hit?.buy ?? 0;
    const sell = hit?.sell ?? 0;
    cells.push({
      price: Number((key * step).toFixed(digits)),
      key,
      buy,
      sell,
      volume: buy + sell,
      delta: buy - sell,
      buyImbalance: false,
      sellImbalance: false,
      stacked: false,
      poc: false,
      valueArea: false,
      fade: false,
    });
  }
  return { cells, minKey, maxKey };
}

/**
 * Diagonal imbalance: aggressive buys at price P are matched against aggressive sells
 * one tick lower, because market buys lift the ask while market sells hit the bid.
 */
function markImbalances(cells: OrderflowCell[], ratio: number, minVolume: number) {
  const factor = Math.max(100, ratio) / 100;
  for (let i = 0; i < cells.length; i += 1) {
    const cell = cells[i];
    const below = cells[i - 1];
    const above = cells[i + 1];
    if (below && cell.buy >= minVolume && cell.buy > 0) {
      cell.buyImbalance = below.sell === 0 ? cell.buy > 0 : cell.buy >= below.sell * factor;
    }
    if (above && cell.sell >= minVolume && cell.sell > 0) {
      cell.sellImbalance = above.buy === 0 ? cell.sell > 0 : cell.sell >= above.buy * factor;
    }
  }
}

function collectStacked(cells: OrderflowCell[], minRun: number, barIndex: number): StackedZone[] {
  const zones: StackedZone[] = [];
  const scan = (side: "buy" | "sell") => {
    let run = 0;
    for (let i = 0; i <= cells.length; i += 1) {
      const hit =
        i < cells.length && (side === "buy" ? cells[i].buyImbalance : cells[i].sellImbalance);
      if (hit) {
        run += 1;
        continue;
      }
      if (run >= minRun) {
        const start = i - run;
        const end = i - 1;
        for (let j = start; j <= end; j += 1) cells[j].stacked = true;
        zones.push({
          side,
          from: cells[start].price,
          to: cells[end].price,
          fromKey: cells[start].key,
          toKey: cells[end].key,
          count: run,
          barIndex,
        });
      }
      run = 0;
    }
  };
  scan("buy");
  scan("sell");
  return zones;
}

/**
 * Bid/Ask fade: the aggressive side thins out diagonally across the last ticks of a
 * wick, which reads as the initiating side running out of fuel at the extreme.
 */
function markFade(cells: OrderflowCell[]) {
  const n = cells.length;
  if (n < 3) return;
  const topFading =
    cells[n - 1].buy < cells[n - 2].buy && cells[n - 2].buy < cells[n - 3].buy && cells[n - 3].buy > 0;
  if (topFading) cells[n - 1].fade = true;
  const bottomFading =
    cells[0].sell < cells[1].sell && cells[1].sell < cells[2].sell && cells[2].sell > 0;
  if (bottomFading) cells[0].fade = true;
}

/** One-sided aggression that failed to move price = the other side absorbed it passively. */
function detectAbsorption(
  bar: FootprintBar,
  delta: number,
  volume: number,
  ratio: number
): "buy" | "sell" | null {
  if (volume <= 0) return null;
  if (Math.abs(delta) / volume < ratio) return null;
  if (delta > 0 && bar.close <= bar.open) return "buy";
  if (delta < 0 && bar.close >= bar.open) return "sell";
  return null;
}

export function buildOrderflow(
  bars: FootprintBar[],
  tick: number,
  opts: OrderflowCalcOptions
): OrderflowSeries {
  if (!bars.length || !Number.isFinite(tick) || tick <= 0) return EMPTY_SERIES;
  const step = tick * Math.max(1, opts.tickGroup);
  const digits = priceDigitsForStep(step);
  const out: OrderflowBar[] = [];
  let cvd = 0;
  let maxCell = 0;
  let maxBarVolume = 0;
  let maxAbsDelta = 0;
  let cvdMin = 0;
  let cvdMax = 0;

  bars.forEach((bar, index) => {
    const bucketed = bucketBar(bar, step, digits);
    if (!bucketed) return;
    const { cells, minKey, maxKey } = bucketed;

    if (opts.imbalance) {
      markImbalances(cells, opts.imbalanceRatio, opts.imbalanceMinVolume);
    }
    const zones =
      opts.imbalance && opts.stacked ? collectStacked(cells, Math.max(2, opts.stackedMin), index) : [];
    if (opts.fade) markFade(cells);

    let buy = 0;
    let sell = 0;
    let barMaxCell = 0;
    let pocCell: OrderflowCell | null = null;
    for (const cell of cells) {
      buy += cell.buy;
      sell += cell.sell;
      if (cell.volume > barMaxCell) barMaxCell = cell.volume;
      if (!pocCell || cell.volume > pocCell.volume) pocCell = cell;
    }
    if (pocCell && pocCell.volume > 0) pocCell.poc = true;

    const va = opts.valueArea
      ? computeValueArea(cells, opts.valueAreaPct)
      : { poc: null, vah: null, val: null };
    if (va.val != null && va.vah != null) {
      for (const cell of cells) {
        if (cell.price >= va.val && cell.price <= va.vah) cell.valueArea = true;
      }
    }

    const volume = buy + sell;
    const delta = buy - sell;
    cvd += delta;
    if (barMaxCell > maxCell) maxCell = barMaxCell;
    if (volume > maxBarVolume) maxBarVolume = volume;
    if (Math.abs(delta) > maxAbsDelta) maxAbsDelta = Math.abs(delta);
    if (cvd < cvdMin) cvdMin = cvd;
    if (cvd > cvdMax) cvdMax = cvd;

    out.push({
      ts: bar.ts,
      timeMs: Date.parse(bar.ts),
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      buy,
      sell,
      volume,
      delta,
      deltaPct: volume > 0 ? (delta / volume) * 100 : 0,
      cvd,
      poc: pocCell && pocCell.volume > 0 ? pocCell.price : null,
      pocKey: pocCell && pocCell.volume > 0 ? pocCell.key : null,
      vah: va.vah,
      val: va.val,
      maxCell: barMaxCell,
      minKey,
      maxKey,
      cells,
      zones,
      absorption: opts.absorption ? detectAbsorption(bar, delta, volume, opts.absorptionRatio) : null,
    });
  });

  return { bars: out, step, digits, maxCell, maxBarVolume, maxAbsDelta, cvdMin, cvdMax };
}

/** Volume profile across a slice of bars, with POC / VAH / VAL. */
export function aggregateProfile(
  bars: OrderflowBar[],
  from: number,
  to: number,
  step: number,
  digits: number,
  valueAreaPct: number
): ProfileResult {
  const map = new Map<number, { buy: number; sell: number }>();
  for (let i = Math.max(0, from); i <= Math.min(bars.length - 1, to); i += 1) {
    for (const cell of bars[i].cells) {
      if (cell.volume <= 0) continue;
      const cur = map.get(cell.key);
      if (cur) {
        cur.buy += cell.buy;
        cur.sell += cell.sell;
      } else {
        map.set(cell.key, { buy: cell.buy, sell: cell.sell });
      }
    }
  }
  const rows: ProfileRow[] = [...map.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([key, v]) => ({
      key,
      price: Number((key * step).toFixed(digits)),
      buy: v.buy,
      sell: v.sell,
      volume: v.buy + v.sell,
    }));
  const maxVolume = rows.reduce((acc, r) => Math.max(acc, r.volume), 0);
  const total = rows.reduce((acc, r) => acc + r.volume, 0);
  return { rows, maxVolume, total, ...computeValueArea(rows, valueAreaPct) };
}

const COMPACT_UNITS: [number, string][] = [
  [1e9, "B"],
  [1e6, "M"],
  [1e3, "k"],
];

/** Tight numeric labels so footprint cells stay readable at small bar widths. */
export function fmtCompact(n: number, maxDigits = 1): string {
  const abs = Math.abs(n);
  for (const [size, suffix] of COMPACT_UNITS) {
    if (abs >= size) {
      const v = n / size;
      return `${v.toFixed(Math.abs(v) >= 100 ? 0 : maxDigits)}${suffix}`;
    }
  }
  if (abs >= 100) return n.toFixed(0);
  if (abs >= 10) return n.toFixed(Math.min(1, maxDigits));
  if (abs >= 1) return n.toFixed(Math.min(2, maxDigits + 1));
  if (abs === 0) return "0";
  return n.toFixed(Math.min(3, maxDigits + 2));
}

export function fmtSignedCompact(n: number): string {
  if (n === 0) return "0";
  return `${n > 0 ? "+" : "−"}${fmtCompact(Math.abs(n))}`;
}
