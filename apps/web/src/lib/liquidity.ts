export type HeatmapLevel = {
  price: number;
  bid: number;
  ask: number;
};

export type HeatVizSettings = {
  noisePct: number;
  wallPct: number;
  srPct: number;
  profileWidth: number;
  tickGroup: number;
  guides: boolean;
  labels: boolean;
  zones: boolean;
  vacuums: boolean;
  bias: boolean;
  reach: number;
  /** 0 = cut by count of price levels, 1 = cut by resting volume. */
  volumeWeight: number;
  cumulative: boolean;
  gamma: number;
};

export const DEFAULT_HEAT_VIZ: HeatVizSettings = {
  noisePct: 0.18,
  wallPct: 0.78,
  srPct: 0.9,
  profileWidth: 0.32,
  tickGroup: 1,
  guides: false,
  labels: false,
  zones: true,
  vacuums: true,
  bias: true,
  reach: 1,
  volumeWeight: 0.7,
  cumulative: false,
  gamma: 0.7,
};

export type LiqZone = {
  lo: number;
  hi: number;
  poc: number;
  pocSize: number;
  size: number;
  side: "bid" | "ask";
  support: boolean;
  ticks: number;
  magnet: boolean;
  score: number;
};

export type LiqFlag = "iceberg" | "wall" | "spoof" | null;

export type LiqBucket = {
  price: number;
  bid: number;
  ask: number;
  rest: number;
  showBid: number;
  showAsk: number;
  flag: LiqFlag;
  sessionVol: number;
  prevRest: number;
  implied: number;
  score: number;
};

/** Rolling L2 rest per price — ~13s at 650ms poll. */
export type BookMem = Map<number, { rest: number[]; max: number }>;

const BOOK_MEM_CAP = 20;

export function rememberBook(
  mem: BookMem,
  rows: { price: number; rest: number }[],
  cap = BOOK_MEM_CAP
): BookMem {
  const next: BookMem = new Map();
  const seen = new Set<number>();
  for (const r of rows) {
    seen.add(r.price);
    const prev = mem.get(r.price);
    const rest = prev ? prev.rest.concat(r.rest).slice(-cap) : [r.rest];
    next.set(r.price, { rest, max: Math.max(prev?.max || 0, r.rest) });
  }
  for (const [p, h] of mem) {
    if (seen.has(p)) continue;
    const rest = h.rest.concat(0).slice(-cap);
    if (rest.some((x) => x > 0)) next.set(p, { rest, max: h.max });
  }
  return next;
}

export type TapePrint = {
  price: number;
  amount: number;
  side: "buy" | "sell";
  ts_ms?: number;
};

export type FlowAtPrice = { buy: number; sell: number };

type FpBars = { levels?: { price: number; buy?: number; sell?: number }[] }[] | null | undefined;

export function tradedVolFromBars(
  bars: FpBars,
  lastN: number,
  step: number,
  weightRecent = false
): Map<number, number> {
  const flow = tradedFlowFromBars(bars, lastN, step, weightRecent);
  const map = new Map<number, number>();
  for (const [p, f] of flow) map.set(p, f.buy + f.sell);
  return map;
}

export function tradedFlowFromBars(
  bars: FpBars,
  lastN: number,
  step: number,
  weightRecent = false
): Map<number, FlowAtPrice> {
  const map = new Map<number, FlowAtPrice>();
  if (!bars?.length || !(step > 0)) return map;
  const slice = bars.slice(-Math.max(1, lastN));
  const n = slice.length;
  for (let i = 0; i < n; i++) {
    const w = weightRecent ? (i + 1) / n : 1;
    for (const lvl of slice[i].levels || []) {
      if (!(lvl.price > 0)) continue;
      const p = quantizePrice(lvl.price, step);
      const cur = map.get(p) || { buy: 0, sell: 0 };
      cur.buy += (lvl.buy || 0) * w;
      cur.sell += (lvl.sell || 0) * w;
      map.set(p, cur);
    }
  }
  return map;
}

/** Aggressive prints in the last `maxAgeMs` — aligned with L2 memory (~13s). */
export function tradedFlowFromTape(
  prints: TapePrint[] | null | undefined,
  step: number,
  maxAgeMs = 12000,
  nowMs = Date.now()
): Map<number, FlowAtPrice> {
  const map = new Map<number, FlowAtPrice>();
  if (!prints?.length || !(step > 0)) return map;
  for (const t of prints) {
    if (!(t.price > 0) || !(t.amount > 0)) continue;
    if (t.ts_ms && nowMs - t.ts_ms > maxAgeMs) continue;
    const p = quantizePrice(t.price, step);
    const cur = map.get(p) || { buy: 0, sell: 0 };
    if (t.side === "buy") cur.buy += t.amount;
    else cur.sell += t.amount;
    map.set(p, cur);
  }
  return map;
}

function mergeFlow(a: Map<number, FlowAtPrice>, b: Map<number, FlowAtPrice>): Map<number, FlowAtPrice> {
  const out = new Map<number, FlowAtPrice>();
  for (const src of [a, b]) {
    for (const [p, f] of src) {
      const cur = out.get(p) || { buy: 0, sell: 0 };
      cur.buy += f.buy;
      cur.sell += f.sell;
      out.set(p, cur);
    }
  }
  return out;
}

function flowPrints(map: Map<number, FlowAtPrice>): number {
  let n = 0;
  for (const f of map.values()) if (f.buy + f.sell > 0) n += 1;
  return n;
}

function lookupFlow(
  map: Map<number, FlowAtPrice> | undefined,
  price: number,
  step: number
): FlowAtPrice {
  const empty = { buy: 0, sell: 0 };
  if (!map?.size) return empty;
  const exact = map.get(price);
  if (exact) return exact;
  const acc = { buy: 0, sell: 0 };
  for (const [p, f] of map) {
    if (Math.abs(p - price) < step / 2) {
      acc.buy += f.buy;
      acc.sell += f.sell;
    }
  }
  return acc;
}

function collapseNearby(rows: LiqBucket[], flag: LiqFlag, gap: number): void {
  const hits = rows
    .filter((r) => r.flag === flag)
    .sort((a, b) => (b.score || 0) - (a.score || 0));
  const kept: number[] = [];
  for (const r of hits) {
    if (kept.some((p) => Math.abs(p - r.price) <= gap)) r.flag = null;
    else kept.push(r.price);
  }
}

function eatenFrom(samples: number[]): number {
  let e = 0;
  for (let i = 1; i < samples.length; i++) {
    e += Math.max(0, samples[i - 1] - samples[i]);
  }
  return e;
}

function refillAmt(samples: number[]): number {
  let a = 0;
  for (let i = 1; i < samples.length; i++) {
    a += Math.max(0, samples[i] - samples[i - 1]);
  }
  return a;
}

function refillCount(samples: number[], peak: number): number {
  if (!(peak > 0)) return 0;
  let n = 0;
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1];
    const b = samples[i];
    if (a > 0 && a <= peak * 0.72 && b >= a * 1.32 && b >= peak * 0.55) n += 1;
  }
  return n;
}

function keepTopFlags(
  rows: LiqBucket[],
  flag: LiqFlag,
  maxN: number,
  wallCut: number,
  demoteToWall = false
): number {
  const hits = rows.filter((r) => r.flag === flag).sort((a, b) => (b.score || 0) - (a.score || 0));
  const drop = new Set(hits.slice(Math.max(0, maxN)).map((r) => r.price));
  let kept = 0;
  for (const r of rows) {
    if (r.flag !== flag) continue;
    if (drop.has(r.price)) {
      r.flag = demoteToWall && r.rest >= wallCut ? "wall" : null;
    } else {
      kept += 1;
    }
  }
  return kept;
}

export type LiqVacuum = { lo: number; hi: number; up: boolean; ticks: number };

export type LiqSnapshot = {
  mid: number;
  last: number;
  bestBid: number;
  bestAsk: number;
  tickSize: number;
  step: number;
  rows: LiqBucket[];
  zones: LiqZone[];
  nearS: LiqZone | null;
  nearR: LiqZone | null;
  vacuums: LiqVacuum[];
  bias: "up" | "down" | "flat";
  biasLabel: string;
  costUp: number;
  costDn: number;
  wallCut: number;
  srCut: number;
  noiseCut: number;
  peakShow: number;
  peakRest: number;
  icebergs: number;
  walls: number;
  spoofs: number;
};

export function fmtPx(n: number, digits: number): string {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function fmtTicks(n: number): string {
  const a = Math.abs(Math.round(n));
  return `${n > 0 ? "+" : n < 0 ? "−" : ""}${a}t`;
}

export function inferTick(levels: HeatmapLevel[]): number {
  const prices: number[] = [];
  for (const lvl of levels) {
    if (lvl.price > 0) prices.push(lvl.price);
  }
  prices.sort((a, b) => a - b);
  let min = Infinity;
  const cap = Math.min(prices.length, 120);
  for (let i = 1; i < cap; i++) {
    const d = prices[i] - prices[i - 1];
    if (d > 0 && d < min) min = d;
  }
  return Number.isFinite(min) && min > 0 ? min : 0.01;
}

function quantizePrice(price: number, step: number): number {
  return Number((Math.round(price / step) * step).toFixed(10));
}

function medianOf(sorted: number[]): number {
  if (!sorted.length) return 0;
  const m = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
}

function percentileOf(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const t = Math.min(1, Math.max(0, p));
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(t * (sorted.length - 1))));
  return sorted[i];
}

/** Rest size at which cumulative volume reaches fraction `p` of total contracts. */
function volumePercentileOf(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const total = sorted.reduce((s, x) => s + x, 0);
  if (!(total > 0)) return percentileOf(sorted, p);
  const target = Math.min(1, Math.max(0, p)) * total;
  let acc = 0;
  for (const x of sorted) {
    acc += x;
    if (acc >= target) return x;
  }
  return sorted[sorted.length - 1];
}

function mixedSizeCut(sorted: number[], p: number, volumeWeight: number): number {
  if (!(p > 0) || !sorted.length) return 0;
  const byCount = percentileOf(sorted, p);
  const w = Math.min(1, Math.max(0, volumeWeight));
  if (w <= 0) return byCount;
  const byVol = volumePercentileOf(sorted, p);
  return byCount * (1 - w) + byVol * w;
}

function clusterZones(
  rows: { price: number; bid: number; ask: number; rest: number }[],
  mid: number,
  wallCut: number,
  step: number,
  med: number
): LiqZone[] {
  const byPrice = new Map(rows.map((r) => [r.price, r]));
  const walls = rows.filter((r) => r.rest >= wallCut).sort((a, b) => a.price - b.price);
  const zones: LiqZone[] = [];
  const mergeGap = step * 1.01;
  const softGap = step * 2.01;

  for (const w of walls) {
    const side: "bid" | "ask" = w.bid >= w.ask ? "bid" : "ask";
    const last = zones[zones.length - 1];
    const gap = last ? w.price - last.hi : Infinity;
    let merge = false;
    if (last && last.side === side) {
      if (gap <= mergeGap) merge = true;
      else if (gap <= softGap) {
        const midPx = quantizePrice((last.hi + w.price) / 2, step);
        const midRow = byPrice.get(midPx);
        merge = (midRow?.rest || 0) >= wallCut * 0.45;
      }
    }
    if (merge && last) {
      const prev = last.size;
      last.hi = w.price;
      last.size += w.rest;
      last.poc = last.size > 0 ? (last.poc * prev + w.price * w.rest) / last.size : w.price;
      if (w.rest > last.pocSize) last.pocSize = w.rest;
      continue;
    }
    zones.push({
      lo: w.price,
      hi: w.price,
      poc: w.price,
      pocSize: w.rest,
      size: w.rest,
      side,
      support: w.price <= mid,
      ticks: 1,
      magnet: true,
      score: med > 0 ? w.rest / med : 1,
    });
  }

  for (const z of zones) {
    z.support = z.hi < mid - step * 0.25;
    z.ticks = Math.max(1, Math.round((z.hi - z.lo) / step) + 1);
    z.magnet = z.ticks <= 2 && z.pocSize >= z.size * 0.62;
    z.score = med > 0 ? z.size / med : 1;
    z.poc = Number(z.poc.toFixed(10));
  }
  return zones.filter((z) => z.hi < mid - step * 0.25 || z.lo > mid + step * 0.25);
}

function depthTo(
  rows: { price: number; bid: number; ask: number }[],
  mid: number,
  target: number,
  lambda: number
): number {
  const up = target >= mid;
  let s = 0;
  for (const r of rows) {
    if (up) {
      if (r.price <= mid || r.price > target) continue;
      s += r.ask * Math.exp(-(r.price - mid) / lambda);
    } else {
      if (r.price >= mid || r.price < target) continue;
      s += r.bid * Math.exp(-(mid - r.price) / lambda);
    }
  }
  return s;
}

/** Merge histogram rows when a price step is thinner than ~2px. Display only — not for S/R. */
export function snapAutoGroup(pxPerTick: number): number {
  if (!(pxPerTick > 0) || pxPerTick >= 2.1) return 1;
  const need = 2.1 / pxPerTick;
  const opts = [1, 2, 5, 10, 20, 50];
  return opts.find((n) => n >= need) || 50;
}

export function analyzeLiquidity(opts: {
  levels: HeatmapLevel[];
  viz: HeatVizSettings;
  tick: number;
  lastClose: number;
  sessionVol?: Map<number, number>;
  recentVol?: Map<number, number>;
  prevRest?: Map<number, number>;
  bookMem?: BookMem;
  tape?: TapePrint[] | null;
  fpBars?: FpBars;
  nowMs?: number;
}): LiqSnapshot | null {
  const { levels, viz, lastClose } = opts;
  if (!levels.length) return null;
  const tickSize = Math.max(1e-9, opts.tick || inferTick(levels));
  const userGroup = [1, 2, 5, 10, 20].includes(viz.tickGroup) ? viz.tickGroup : 1;
  const step = tickSize * userGroup;

  let bestBid = -Infinity;
  let bestAsk = Infinity;
  const grouped = new Map<number, { bid: number; ask: number }>();
  for (const lvl of levels) {
    if (lvl.bid > 0) bestBid = Math.max(bestBid, lvl.price);
    if (lvl.ask > 0) bestAsk = Math.min(bestAsk, lvl.price);
    const p = quantizePrice(lvl.price, step);
    const cur = grouped.get(p) || { bid: 0, ask: 0 };
    cur.bid += lvl.bid;
    cur.ask += lvl.ask;
    grouped.set(p, cur);
  }
  if (!grouped.size) return null;

  const mid =
    Number.isFinite(bestBid) && Number.isFinite(bestAsk)
      ? (bestBid + bestAsk) / 2
      : lastClose || (Number.isFinite(bestBid) ? bestBid : bestAsk);
  const last = lastClose > 0 ? lastClose : mid;

  const rows: LiqBucket[] = [];
  for (const [price, v] of grouped) {
    const rest = Math.max(v.bid, v.ask);
    if (rest <= 0) continue;
    rows.push({
      price,
      bid: v.bid,
      ask: v.ask,
      rest,
      showBid: v.bid,
      showAsk: v.ask,
      flag: null,
      sessionVol: 0,
      prevRest: 0,
      implied: 0,
      score: 0,
    });
  }
  if (!rows.length) return null;

  if (viz.cumulative) {
    const bids = rows.filter((r) => r.bid > 0).sort((a, b) => b.price - a.price);
    const asks = rows.filter((r) => r.ask > 0).sort((a, b) => a.price - b.price);
    let acc = 0;
    for (const r of bids) {
      if (r.price > mid) continue;
      acc += r.bid;
      r.showBid = acc;
    }
    acc = 0;
    for (const r of asks) {
      if (r.price < mid) continue;
      acc += r.ask;
      r.showAsk = acc;
    }
  }

  const rests = rows.map((r) => r.rest).sort((a, b) => a - b);
  const med = medianOf(rests);
  const noisePct = Math.min(0.6, Math.max(0, viz.noisePct));
  const wallPct = Math.min(0.97, Math.max(0.5, viz.wallPct));
  const volW = Math.min(1, Math.max(0, viz.volumeWeight ?? 0.7));
  const noiseCut = noisePct <= 0.01 ? 0 : mixedSizeCut(rests, noisePct, volW);
  const visible = rows.filter((r) => r.rest >= noiseCut);
  if (!visible.length) return null;
  const visRests = visible.map((r) => r.rest).sort((a, b) => a - b);
  const wallCut = mixedSizeCut(visRests, wallPct, volW);
  const srCut = mixedSizeCut(visRests, Math.min(0.995, wallPct + 0.08), volW);

  let peakShow = 0;
  let peakRest = 0;
  for (const r of visible) {
    peakShow = Math.max(peakShow, r.showBid, r.showAsk);
    peakRest = Math.max(peakRest, r.rest);
  }
  if (peakShow <= 0 || peakRest <= 0) return null;

  const sessionVol = opts.sessionVol;
  const bookMem = opts.bookMem;
  const lookup = (map: Map<number, number> | undefined, price: number) => {
    if (!map || !map.size) return 0;
    const exact = map.get(price);
    if (exact) return exact;
    let acc = 0;
    for (const [p, v] of map) {
      if (Math.abs(p - price) < step / 2) acc += v;
    }
    return acc;
  };

  const tapeFlow = tradedFlowFromTape(opts.tape, step, 12000, opts.nowMs ?? Date.now());
  let flow = tapeFlow;
  if (flowPrints(tapeFlow) < 5) {
    flow = mergeFlow(tapeFlow, tradedFlowFromBars(opts.fpBars, 2, step));
  }
  const spreadTicks =
    Number.isFinite(bestAsk) && Number.isFinite(bestBid)
      ? Math.max(1, (bestAsk - bestBid) / tickSize)
      : 2;
  const touchTicks = Math.min(6, Math.max(2, spreadTicks + 1.5));
  const hitVals: number[] = [];
  for (const row of visible) {
    const f0 = lookupFlow(flow, row.price, step);
    const h0 = row.bid >= row.ask ? f0.sell : f0.buy;
    if (h0 > 0) hitVals.push(h0);
  }
  hitVals.sort((a, b) => a - b);
  const medHits = medianOf(hitVals);
  const hotHits = hitVals.length ? percentileOf(hitVals, 0.78) : 0;

  let icebergs = 0;
  let walls = 0;
  let spoofs = 0;
  for (const r of visible) {
    const sessV = lookup(sessionVol, r.price);
    const hist = bookMem?.get(r.price);
    const series = (hist?.rest || []).concat(r.rest);
    const prev =
      series.length >= 2 ? series[series.length - 2] : opts.prevRest?.get(r.price) || 0;
    const winMax = Math.max(hist?.max || 0, r.rest, prev);
    const floor = Math.max(noiseCut, med * 0.28, r.rest * 0.5);
    let persist = 0;
    for (const s of series) if (s >= floor) persist += 1;
    const n = Math.max(series.length, 1);
    const persistPct = persist / n;
    const eaten = eatenFrom(series);
    const added = refillAmt(series);
    const refills = refillCount(series, winMax);
    const drop = winMax > 0 ? 1 - r.rest / winMax : 0;
    const isBid = r.bid >= r.ask;
    const distToTouch = isBid
      ? Number.isFinite(bestBid)
        ? (bestBid - r.price) / tickSize
        : Math.abs(r.price - mid) / tickSize
      : Number.isFinite(bestAsk)
        ? (r.price - bestAsk) / tickSize
        : Math.abs(r.price - mid) / tickSize;
    const atTouch = distToTouch >= -0.6 && distToTouch <= touchTicks;
    const f = lookupFlow(flow, r.price, step);
    const hits = isBid ? f.sell : f.buy;
    const contra = isBid ? f.buy : f.sell;
    const hitFloor = Math.max(hotHits * 0.7, medHits * 1.55, r.rest * 0.28);
    const held = drop < 0.38 && r.rest >= Math.max(noiseCut, med * 0.45);
    const intoQueue = hits >= contra * 0.85;
    const replenish =
      hits >= Math.max(eaten * 2.15, r.rest * 0.4, hitFloor) && hits > eaten + r.rest * 0.15;
    const refillWithFlow = refills >= 2 && added > eaten * 0.55 && hits >= hitFloor && held;
    const enoughHist = n >= 5;
    const restOk = r.rest >= Math.max(noiseCut, med * 0.45);
    const recentPull =
      series.length >= 3 &&
      Math.max(series[series.length - 3], series[series.length - 2]) >= wallCut * 0.9 &&
      r.rest < wallCut * 0.5;
    const pulledNotFilled = hits < Math.max(eaten * 0.45, winMax * 0.18) && drop >= 0.62;

    r.sessionVol = sessV;
    r.prevRest = prev;
    r.implied = Math.max(0, hits - eaten, hits - r.rest * 0.4);

    if (n >= 4 && winMax >= wallCut * 0.88 && pulledNotFilled && (recentPull || persistPct < 0.5)) {
      r.flag = "spoof";
      r.score = Math.min(
        1,
        0.45 * drop + 0.35 * (1 - Math.min(1, hits / Math.max(winMax, 1e-9))) + 0.2 * (1 - persistPct)
      );
      spoofs += 1;
    } else if (
      atTouch &&
      enoughHist &&
      restOk &&
      held &&
      intoQueue &&
      hits > 0 &&
      (replenish || refillWithFlow)
    ) {
      r.flag = "iceberg";
      r.score = Math.min(
        1,
        0.36 * Math.min(1, hits / Math.max(r.rest, 1e-9) / 1.8) +
          0.28 * Math.min(1, hits / Math.max(eaten, r.rest * 0.12, 1e-9) / 2.6) +
          0.16 * persistPct +
          0.1 * Math.max(0, 1 - distToTouch / touchTicks) +
          0.1 * Math.min(1, refills / 2)
      );
      icebergs += 1;
    } else if (
      r.rest >= wallCut &&
      (n < 3 ? r.rest >= srCut : persist >= 3 && (n < 6 || persistPct >= 0.42))
    ) {
      r.flag = "wall";
      r.score = Math.min(1, 0.7 * (r.rest / Math.max(peakRest, 1e-9)) + 0.3 * persistPct);
      walls += 1;
    } else {
      r.score = Math.min(1, r.rest / Math.max(peakRest, 1e-9));
    }
  }

  collapseNearby(visible, "iceberg", step * 1.6);
  for (const r of visible) {
    if (r.flag === "iceberg" && (r.score || 0) < 0.4) r.flag = null;
  }
  icebergs = keepTopFlags(visible, "iceberg", 3, wallCut, true);
  collapseNearby(visible, "spoof", step * 1.6);
  spoofs = keepTopFlags(visible, "spoof", 4, wallCut, false);
  walls = keepTopFlags(visible, "wall", 10, wallCut, false);

  const zones = viz.zones
    ? clusterZones(visible, mid, wallCut, step, med).sort((a, b) => b.score - a.score)
    : [];
  const nearS = zones.filter((z) => z.support).sort((a, b) => b.hi - a.hi)[0] || null;
  const nearR = zones.filter((z) => !z.support).sort((a, b) => a.lo - b.lo)[0] || null;

  const lambda = Math.max(
    tickSize * 14,
    Number.isFinite(bestAsk) && Number.isFinite(bestBid) ? (bestAsk - bestBid) * 10 : tickSize * 14
  );
  const horizonUp = nearR ? nearR.lo : mid + tickSize * 28;
  const horizonDn = nearS ? nearS.hi : mid - tickSize * 28;
  const costUp = depthTo(visible, mid, horizonUp, lambda);
  const costDn = depthTo(visible, mid, horizonDn, lambda);
  const costTot = costUp + costDn;
  const bias: LiqSnapshot["bias"] =
    costTot > 0 && costUp < costDn * 0.88 ? "up" : costTot > 0 && costDn < costUp * 0.88 ? "down" : "flat";
  const ticksTo = (px: number) => Math.round((px - last) / tickSize);
  let biasLabel = "vyvážená kniha";
  if (bias === "up") {
    biasLabel = nearR ? `↑ ${fmtTicks(ticksTo(nearR.poc))} → ${fmtPx(nearR.poc, 2)}` : "↑ menší odpor";
  } else if (bias === "down") {
    biasLabel = nearS ? `↓ ${fmtTicks(ticksTo(nearS.poc))} → ${fmtPx(nearS.poc, 2)}` : "↓ menší odpor";
  }

  const vacuums: LiqVacuum[] = [];
  if (viz.vacuums) {
    if (nearR && Number.isFinite(bestAsk) && nearR.lo > bestAsk + step * 2) {
      vacuums.push({
        lo: bestAsk,
        hi: nearR.lo,
        up: true,
        ticks: Math.max(1, Math.round((nearR.lo - bestAsk) / tickSize)),
      });
    }
    if (nearS && Number.isFinite(bestBid) && bestBid > nearS.hi + step * 2) {
      vacuums.push({
        lo: nearS.hi,
        hi: bestBid,
        up: false,
        ticks: Math.max(1, Math.round((bestBid - nearS.hi) / tickSize)),
      });
    }
  }

  return {
    mid,
    last,
    bestBid,
    bestAsk,
    tickSize,
    step,
    rows: visible,
    zones,
    nearS,
    nearR,
    vacuums,
    bias,
    biasLabel,
    costUp,
    costDn,
    wallCut,
    srCut,
    noiseCut,
    peakShow,
    peakRest,
    icebergs,
    walls,
    spoofs,
  };
}
