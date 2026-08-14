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
  profileWidth: 0.26,
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

export type LiqBucket = {
  price: number;
  bid: number;
  ask: number;
  rest: number;
  showBid: number;
  showAsk: number;
};

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
  };
}
