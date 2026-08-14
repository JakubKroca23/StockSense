import type {
  BookWallFlag,
  FootprintLevel,
  FootprintLevelWire,
  ImbalanceZone,
  OrderBookLevel,
  OrderFlowCandle,
  SessionProfile,
  SessionProfileRow,
  SmartPrint,
  TradeTick,
  UnfinishedAuction,
} from "./types";

export function snapTick(price: number, tick: number): number {
  if (tick <= 0) return price;
  return Math.round(price / tick) * tick;
}

export function fromWireLevel(lvl: FootprintLevelWire): FootprintLevel {
  const bidVolume = lvl.sell || 0;
  const askVolume = lvl.buy || 0;
  return {
    price: lvl.price,
    bidVolume,
    askVolume,
    totalVolume: bidVolume + askVolume,
    delta: askVolume - bidVolume,
  };
}

export function toWireLevel(lvl: FootprintLevel): FootprintLevelWire {
  return { price: lvl.price, buy: lvl.askVolume, sell: lvl.bidVolume };
}

export function emptyLevel(price: number): FootprintLevel {
  return { price, bidVolume: 0, askVolume: 0, totalVolume: 0, delta: 0 };
}

export function addToLevel(lvl: FootprintLevel, tick: TradeTick): FootprintLevel {
  const bid = tick.aggressorSide === "sell" ? tick.size : 0;
  const ask = tick.aggressorSide === "buy" ? tick.size : 0;
  const bidVolume = lvl.bidVolume + bid;
  const askVolume = lvl.askVolume + ask;
  return {
    price: lvl.price,
    bidVolume,
    askVolume,
    totalVolume: bidVolume + askVolume,
    delta: askVolume - bidVolume,
  };
}

export function candlePoc(levels: FootprintLevel[]): number | null {
  let poc: number | null = null;
  let peak = 0;
  for (const lvl of levels) {
    if (lvl.totalVolume > peak) {
      peak = lvl.totalVolume;
      poc = lvl.price;
    }
  }
  return poc;
}

/** Consecutive stacked bid/ask imbalance (e.g. 3+ ticks at ≥ 300%). */
export function stackedImbalanceZones(
  levels: FootprintLevel[],
  tick: number,
  ratio: number,
  minStack: number
): ImbalanceZone[] {
  if (ratio <= 0 || minStack < 1 || !levels.length) return [];
  const sorted = [...levels].sort((a, b) => a.price - b.price);
  const sideOf = (lvl: FootprintLevel): "ask" | "bid" | null => {
    if (lvl.askVolume <= 0 && lvl.bidVolume <= 0) return null;
    if (lvl.bidVolume <= 0 && lvl.askVolume > 0) return "ask";
    if (lvl.askVolume <= 0 && lvl.bidVolume > 0) return "bid";
    if (lvl.askVolume >= lvl.bidVolume * ratio) return "ask";
    if (lvl.bidVolume >= lvl.askVolume * ratio) return "bid";
    return null;
  };
  const zones: ImbalanceZone[] = [];
  let run: ImbalanceZone | null = null;
  let prevPrice: number | null = null;
  for (const lvl of sorted) {
    const side = sideOf(lvl);
    const adjacent = prevPrice != null && Math.abs(lvl.price - prevPrice - tick) < tick * 0.01;
    if (side && run && run.side === side && adjacent) {
      run.prices.push(lvl.price);
    } else {
      if (run && run.prices.length >= minStack) zones.push(run);
      run = side ? { side, prices: [lvl.price] } : null;
    }
    prevPrice = lvl.price;
  }
  if (run && run.prices.length >= minStack) zones.push(run);
  return zones;
}

export function unfinishedAuction(candle: {
  high: number;
  low: number;
  levels: FootprintLevel[];
}): UnfinishedAuction {
  if (!candle.levels.length) return { high: true, low: true };
  let hi = candle.levels[0];
  let lo = candle.levels[0];
  for (const l of candle.levels) {
    if (l.price > hi.price) hi = l;
    if (l.price < lo.price) lo = l;
  }
  return {
    high: hi.bidVolume <= 0,
    low: lo.askVolume <= 0,
  };
}

/** Lowest-volume valley in a candle (not the POC). */
export function lowVolumeNodes(levels: FootprintLevel[]): number[] {
  if (levels.length < 2) return [];
  const sorted = [...levels].sort((a, b) => a.price - b.price);
  let peak = 0;
  let peakPx = sorted[0].price;
  for (const l of sorted) {
    if (l.totalVolume > peak) {
      peak = l.totalVolume;
      peakPx = l.price;
    }
  }
  if (peak <= 0) return [];
  const cut = peak * 0.2;
  const out: number[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const l = sorted[i];
    if (l.price === peakPx) continue;
    const prev = i > 0 ? sorted[i - 1].totalVolume : l.totalVolume + 1;
    const next = i < sorted.length - 1 ? sorted[i + 1].totalVolume : l.totalVolume + 1;
    const valley = l.totalVolume <= prev && l.totalVolume <= next;
    if (valley && l.totalVolume <= cut) out.push(l.price);
  }
  if (!out.length) {
    let min = sorted[0];
    for (const l of sorted) {
      if (l.price === peakPx) continue;
      if (l.totalVolume < min.totalVolume) min = l;
    }
    if (min.price !== peakPx && min.totalVolume <= cut) out.push(min.price);
  }
  return out;
}

/** Value area covering `cover` fraction of volume, grown from POC. */
export function valueArea(
  rows: SessionProfileRow[],
  cover = 0.7
): { poc: number | null; vah: number | null; val: number | null } {
  if (!rows.length) return { poc: null, vah: null, val: null };
  const sorted = [...rows].sort((a, b) => a.price - b.price);
  let pocIdx = 0;
  let peak = -1;
  let total = 0;
  for (let i = 0; i < sorted.length; i++) {
    total += sorted[i].totalVolume;
    if (sorted[i].totalVolume > peak) {
      peak = sorted[i].totalVolume;
      pocIdx = i;
    }
  }
  if (total <= 0) {
    const p = sorted[pocIdx].price;
    return { poc: p, vah: p, val: p };
  }
  const target = total * Math.min(0.95, Math.max(0.5, cover));
  let lo = pocIdx;
  let hi = pocIdx;
  let acc = sorted[pocIdx].totalVolume;
  while (acc < target && (lo > 0 || hi < sorted.length - 1)) {
    const nextLo = lo > 0 ? sorted[lo - 1].totalVolume : -1;
    const nextHi = hi < sorted.length - 1 ? sorted[hi + 1].totalVolume : -1;
    if (nextHi > nextLo) {
      hi += 1;
      acc += sorted[hi].totalVolume;
    } else {
      lo -= 1;
      acc += sorted[lo].totalVolume;
    }
  }
  return {
    poc: sorted[pocIdx].price,
    val: sorted[lo].price,
    vah: sorted[hi].price,
  };
}

export function sessionFromLevels(
  rows: SessionProfileRow[],
  tick: number,
  cvd: number
): SessionProfile {
  let volume = 0;
  let bidVolume = 0;
  let askVolume = 0;
  for (const r of rows) {
    volume += r.totalVolume;
    bidVolume += r.bidVolume;
    askVolume += r.askVolume;
  }
  const va = valueArea(rows, 0.7);
  return {
    rows,
    volume,
    bidVolume,
    askVolume,
    delta: askVolume - bidVolume,
    cvd,
    poc: va.poc,
    vah: va.vah,
    val: va.val,
    tick,
  };
}

const TAPE_WINDOW_MS = 400;
const TAPE_CAP = 180;

export function appendSmartPrint(
  tape: SmartPrint[],
  tick: TradeTick,
  opts: { smart: boolean; blockSize: number; windowMs?: number }
): SmartPrint[] {
  const windowMs = opts.windowMs ?? TAPE_WINDOW_MS;
  const block = tick.size >= opts.blockSize && opts.blockSize > 0;
  const print: SmartPrint = {
    id: tick.id,
    ts: tick.ts,
    price: tick.price,
    size: tick.size,
    aggressorSide: tick.aggressorSide,
    count: 1,
    block,
  };
  if (opts.smart && tape.length) {
    const last = tape[0];
    if (
      last.aggressorSide === tick.aggressorSide &&
      last.price === tick.price &&
      tick.ts - last.ts <= windowMs
    ) {
      const merged: SmartPrint = {
        ...last,
        id: tick.id,
        ts: tick.ts,
        size: last.size + tick.size,
        count: last.count + 1,
        block: last.block || block || last.size + tick.size >= opts.blockSize,
      };
      return [merged, ...tape.slice(1)].slice(0, TAPE_CAP);
    }
  }
  return [print, ...tape].slice(0, TAPE_CAP);
}

export function buildSmartTape(
  ticks: TradeTick[],
  opts: { smart: boolean; blockSize: number; windowMs?: number }
): SmartPrint[] {
  const chronological = [...ticks].sort((a, b) => a.ts - b.ts || a.id.localeCompare(b.id));
  let tape: SmartPrint[] = [];
  for (const t of chronological) {
    tape = appendSmartPrint(tape, t, opts);
  }
  return tape;
}

export function detectBookWalls(
  levels: OrderBookLevel[],
  prevSize: Map<number, number>,
  wallMult = 3
): BookWallFlag[] {
  const sizes = levels.map((l) => l.size).filter((s) => s > 0).sort((a, b) => a - b);
  if (!sizes.length) return [];
  const mid = sizes[Math.floor(sizes.length / 2)] || 1;
  const cut = mid * wallMult;
  const flags: BookWallFlag[] = [];
  for (const lvl of levels) {
    if (lvl.size < cut) continue;
    const prev = prevSize.get(lvl.price);
    const spoof = prev != null && prev >= cut && lvl.size < prev * 0.3;
    flags.push({
      price: lvl.price,
      side: lvl.side,
      size: lvl.size,
      kind: spoof ? "spoof" : "wall",
    });
  }
  return flags;
}

export function cvdSeriesFromCandles(candles: OrderFlowCandle[]): { ts: number; value: number }[] {
  return candles
    .slice()
    .sort((a, b) => a.ts - b.ts)
    .map((c) => ({ ts: c.ts, value: c.cumulativeDelta }));
}
