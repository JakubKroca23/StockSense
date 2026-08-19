/**
 * DOM depth analytics.
 *
 * Keeps a short rolling replica of the book so the ladder can show more than static
 * sizes: a liquidity heatmap over time, pulling vs. stacking (depth that vanished
 * *without* trading through), and iceberg suspicion from the traded-volume to
 * visible-depth ratio.
 */

export type DepthLevelInput = { price: number; amount: number };

export type DepthBookInput = {
  tick: number;
  mid: number | null;
  best_bid: number | null;
  best_ask: number | null;
  bids: DepthLevelInput[];
  asks: DepthLevelInput[];
  as_of?: string;
};

export type DepthTradeInput = {
  id: string;
  ts_ms: number;
  price: number;
  amount: number;
  side: "buy" | "sell";
};

export type DepthSnapshot = {
  t: number;
  bids: Map<number, number>;
  asks: Map<number, number>;
};

export type DepthLevelStat = {
  maxBid: number;
  maxAsk: number;
  pastBid: number;
  pastAsk: number;
  addedBid: number;
  addedAsk: number;
  /** Size that left the level without a matching print — spoof / pull candidate. */
  pulledBid: number;
  pulledAsk: number;
  traded: number;
};

export const EMPTY_DEPTH_STAT: DepthLevelStat = Object.freeze({
  maxBid: 0,
  maxAsk: 0,
  pastBid: 0,
  pastAsk: 0,
  addedBid: 0,
  addedAsk: 0,
  pulledBid: 0,
  pulledAsk: 0,
  traded: 0,
});

const SEEN_CAP = 4000;

function bucket(levels: DepthLevelInput[], step: number): Map<number, number> {
  const out = new Map<number, number>();
  for (const level of levels) {
    if (!Number.isFinite(level.price) || !(level.amount > 0)) continue;
    const key = Math.round(level.price / step);
    out.set(key, (out.get(key) ?? 0) + level.amount);
  }
  return out;
}

export class DepthTracker {
  private step = 0;
  private snaps: DepthSnapshot[] = [];
  private sec = new Map<number, Map<number, number>>();
  private seen = new Set<string>();
  private maxBid = new Map<number, number>();
  private maxAsk = new Map<number, number>();

  /** Everything is keyed by the row grid, so a grouping change invalidates the whole history. */
  configure(step: number) {
    if (step === this.step) return;
    this.step = step;
    this.snaps = [];
    this.sec.clear();
    this.seen.clear();
    this.maxBid.clear();
    this.maxAsk.clear();
  }

  pushBook(book: DepthBookInput, nowMs: number, keepMs: number) {
    if (!this.step) return;
    const bids = bucket(book.bids, this.step);
    const asks = bucket(book.asks, this.step);
    for (const [key, size] of bids) {
      if (size > (this.maxBid.get(key) ?? 0)) this.maxBid.set(key, size);
    }
    for (const [key, size] of asks) {
      if (size > (this.maxAsk.get(key) ?? 0)) this.maxAsk.set(key, size);
    }
    const last = this.snaps[this.snaps.length - 1];
    if (last && nowMs - last.t < 40) return;
    this.snaps.push({ t: nowMs, bids, asks });
    const cutoff = nowMs - keepMs;
    let drop = 0;
    while (drop < this.snaps.length && this.snaps[drop].t < cutoff) drop += 1;
    if (drop > 0) this.snaps.splice(0, drop);
  }

  pushTrades(trades: DepthTradeInput[], nowMs: number, keepMs: number) {
    if (!this.step) return;
    for (const trade of trades) {
      if (!trade.id || this.seen.has(trade.id)) continue;
      this.seen.add(trade.id);
      if (!(trade.amount > 0) || !Number.isFinite(trade.price)) continue;
      const key = Math.round(trade.price / this.step);
      const secTs = Math.floor(trade.ts_ms / 1000);
      let row = this.sec.get(secTs);
      if (!row) {
        row = new Map<number, number>();
        this.sec.set(secTs, row);
      }
      row.set(key, (row.get(key) ?? 0) + trade.amount);
    }
    if (this.seen.size > SEEN_CAP) this.seen.clear();
    const cutoff = Math.floor((nowMs - keepMs) / 1000);
    for (const secTs of this.sec.keys()) {
      if (secTs < cutoff) this.sec.delete(secTs);
    }
  }

  history(nowMs: number, windowMs: number): DepthSnapshot[] {
    const cutoff = nowMs - windowMs;
    return this.snaps.filter((s) => s.t >= cutoff);
  }

  tradedSince(nowMs: number, windowMs: number): Map<number, number> {
    const cutoff = Math.floor((nowMs - windowMs) / 1000);
    const out = new Map<number, number>();
    for (const [secTs, row] of this.sec) {
      if (secTs < cutoff) continue;
      for (const [key, vol] of row) out.set(key, (out.get(key) ?? 0) + vol);
    }
    return out;
  }

  /**
   * Depth deltas over `windowMs`, with executed volume netted out so absorption is not
   * mistaken for a pull (100 contracts gone + 100 printed = filled, not cancelled).
   */
  stats(nowMs: number, windowMs: number): Map<number, DepthLevelStat> {
    const out = new Map<number, DepthLevelStat>();
    if (!this.snaps.length) return out;
    const current = this.snaps[this.snaps.length - 1];
    const cutoff = nowMs - windowMs;
    const past = this.snaps.find((s) => s.t >= cutoff) ?? this.snaps[0];
    const traded = this.tradedSince(nowMs, windowMs);
    const keys = new Set<number>([
      ...current.bids.keys(),
      ...current.asks.keys(),
      ...past.bids.keys(),
      ...past.asks.keys(),
      ...traded.keys(),
    ]);
    for (const key of keys) {
      const nowBid = current.bids.get(key) ?? 0;
      const nowAsk = current.asks.get(key) ?? 0;
      const pastBid = past.bids.get(key) ?? 0;
      const pastAsk = past.asks.get(key) ?? 0;
      const filled = traded.get(key) ?? 0;
      out.set(key, {
        maxBid: this.maxBid.get(key) ?? 0,
        maxAsk: this.maxAsk.get(key) ?? 0,
        pastBid,
        pastAsk,
        addedBid: Math.max(0, nowBid - pastBid),
        addedAsk: Math.max(0, nowAsk - pastAsk),
        pulledBid: Math.max(0, pastBid - nowBid - filled),
        pulledAsk: Math.max(0, pastAsk - nowAsk - filled),
        traded: filled,
      });
    }
    return out;
  }

  maxDepthAt(key: number): number {
    return Math.max(this.maxBid.get(key) ?? 0, this.maxAsk.get(key) ?? 0);
  }

  get snapshotCount() {
    return this.snaps.length;
  }
}

/** Median of the non-zero depths on screen — the baseline a wall has to tower over. */
export function medianDepth(values: number[]): number {
  const nz = values.filter((v) => v > 0).sort((a, b) => a - b);
  if (!nz.length) return 0;
  const mid = Math.floor(nz.length / 2);
  return nz.length % 2 ? nz[mid] : (nz[mid - 1] + nz[mid]) / 2;
}
