import {
  addToLevel,
  appendSmartPrint,
  buildSmartTape,
  candlePoc,
  detectBookWalls,
  emptyLevel,
  fromWireLevel,
  sessionFromLevels,
  snapTick,
} from "./analytics";
import type {
  BookWallFlag,
  CvdPoint,
  FootprintLevel,
  OrderBookLevel,
  OrderFlowCandle,
  SessionProfile,
  SessionProfileRow,
  SmartPrint,
  TradeTick,
} from "./types";

export type OrderFlowConfig = {
  tickSize: number;
  intervalMs: number;
  blockSize: number;
  smartTape: boolean;
  tapeWindowMs?: number;
};

export type OrderFlowState = {
  lastPrice: number;
  cvd: number;
  cvdSeries: CvdPoint[];
  session: Map<number, FootprintLevel>;
  candles: Map<number, OrderFlowCandle>;
  tape: SmartPrint[];
  book: OrderBookLevel[];
  walls: BookWallFlag[];
  seen: Set<string>;
};

const CVD_CAP = 2400;
const SEEN_CAP = 4000;

function barTs(ts: number, intervalMs: number): number {
  return Math.floor(ts / intervalMs) * intervalMs;
}

export function emptyOrderFlow(tickSize: number): OrderFlowState {
  return {
    lastPrice: 0,
    cvd: 0,
    cvdSeries: [],
    session: new Map(),
    candles: new Map(),
    tape: [],
    book: [],
    walls: [],
    seen: new Set(),
  };
}

function bumpSession(state: OrderFlowState, price: number, tick: TradeTick): void {
  const cur = state.session.get(price) || emptyLevel(price);
  state.session.set(price, addToLevel(cur, tick));
}

function bumpCandle(state: OrderFlowState, cfg: OrderFlowConfig, tick: TradeTick, price: number): void {
  const ts = barTs(tick.ts, cfg.intervalMs);
  let candle = state.candles.get(ts);
  if (!candle) {
    candle = {
      ts,
      open: price,
      high: price,
      low: price,
      close: price,
      volume: 0,
      delta: 0,
      cumulativeDelta: state.cvd,
      poc: price,
      levels: [],
    };
    state.candles.set(ts, candle);
  }
  candle.high = Math.max(candle.high, price);
  candle.low = Math.min(candle.low, price);
  candle.close = price;
  candle.volume += tick.size;
  const signed = tick.aggressorSide === "buy" ? tick.size : -tick.size;
  candle.delta += signed;
  candle.cumulativeDelta = state.cvd;
  const idx = candle.levels.findIndex((l) => l.price === price);
  if (idx < 0) candle.levels.push(addToLevel(emptyLevel(price), tick));
  else candle.levels[idx] = addToLevel(candle.levels[idx], tick);
  candle.poc = candlePoc(candle.levels);
}

/**
 * One executed print fans out to tape, forming candle, session volume, and CVD.
 * Dedupes by `tick.id` so REST polls can be applied incrementally.
 */
export function applyTradeTick(
  prev: OrderFlowState,
  tick: TradeTick,
  cfg: OrderFlowConfig
): OrderFlowState {
  if (!tick.size || !tick.price || tick.ts <= 0) return prev;
  if (prev.seen.has(tick.id)) return prev;

  const state: OrderFlowState = {
    ...prev,
    session: new Map(prev.session),
    candles: new Map(prev.candles),
    seen: new Set(prev.seen),
    cvdSeries: prev.cvdSeries.slice(),
  };
  state.seen.add(tick.id);
  if (state.seen.size > SEEN_CAP) {
    state.seen = new Set([...state.seen].slice(-SEEN_CAP / 2));
  }

  const price = snapTick(tick.price, cfg.tickSize);
  const signed = tick.aggressorSide === "buy" ? tick.size : -tick.size;
  state.cvd += signed;
  state.lastPrice = price;
  state.cvdSeries.push({ ts: tick.ts, value: state.cvd });
  if (state.cvdSeries.length > CVD_CAP) {
    state.cvdSeries = state.cvdSeries.slice(-CVD_CAP);
  }

  bumpSession(state, price, tick);
  bumpCandle(state, cfg, tick, price);
  state.tape = appendSmartPrint(state.tape, { ...tick, price }, {
    smart: cfg.smartTape,
    blockSize: cfg.blockSize,
    windowMs: cfg.tapeWindowMs,
  });

  return state;
}

export function applyBook(
  prev: OrderFlowState,
  book: OrderBookLevel[]
): OrderFlowState {
  const prevSize = new Map(prev.book.map((l) => [l.price, l.size]));
  return {
    ...prev,
    book,
    walls: detectBookWalls(book, prevSize),
  };
}

export function hydrateFromTicks(
  ticks: TradeTick[],
  cfg: OrderFlowConfig,
  book: OrderBookLevel[] = []
): OrderFlowState {
  let state = emptyOrderFlow(cfg.tickSize);
  const chrono = [...ticks].sort((a, b) => a.ts - b.ts);
  for (const t of chrono) state = applyTradeTick(state, t, cfg);
  if (book.length) state = applyBook(state, book);
  if (!state.tape.length && ticks.length) {
    state.tape = buildSmartTape(ticks, {
      smart: cfg.smartTape,
      blockSize: cfg.blockSize,
      windowMs: cfg.tapeWindowMs,
    });
  }
  return state;
}

export function sessionProfileOf(state: OrderFlowState, tick: number): SessionProfile {
  const rows: SessionProfileRow[] = [...state.session.values()]
    .map((l) => ({
      price: l.price,
      bidVolume: l.bidVolume,
      askVolume: l.askVolume,
      totalVolume: l.totalVolume,
      delta: l.delta,
    }))
    .sort((a, b) => a.price - b.price);
  return sessionFromLevels(rows, tick, state.cvd);
}

export function candlesOf(state: OrderFlowState): OrderFlowCandle[] {
  return [...state.candles.values()].sort((a, b) => a.ts - b.ts);
}

export function levelsFromWireBars(
  bars: { delta?: number; levels?: { price: number; buy: number; sell: number }[] }[],
  tick: number
): SessionProfile {
  const map = new Map<number, FootprintLevel>();
  let cvd = 0;
  for (const bar of bars) {
    cvd += bar.delta || 0;
    for (const raw of bar.levels || []) {
      const lvl = fromWireLevel(raw);
      const p = snapTick(lvl.price, tick);
      const cur = map.get(p) || emptyLevel(p);
      map.set(p, {
        price: p,
        bidVolume: cur.bidVolume + lvl.bidVolume,
        askVolume: cur.askVolume + lvl.askVolume,
        totalVolume: cur.totalVolume + lvl.totalVolume,
        delta: cur.delta + lvl.delta,
      });
    }
  }
  const rows: SessionProfileRow[] = [...map.values()]
    .map((l) => ({
      price: l.price,
      bidVolume: l.bidVolume,
      askVolume: l.askVolume,
      totalVolume: l.totalVolume,
      delta: l.delta,
    }))
    .sort((a, b) => a.price - b.price);
  return sessionFromLevels(rows, tick, cvd);
}

type Listener = () => void;

/** Lightweight store: one TradeTick updates tape, candle, session volume, CVD. */
export function createOrderFlowStore(cfg: OrderFlowConfig) {
  let state = emptyOrderFlow(cfg.tickSize);
  let config = cfg;
  const listeners = new Set<Listener>();
  const emit = () => {
    for (const fn of listeners) fn();
  };
  return {
    getState: () => state,
    subscribe: (fn: Listener) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    setConfig: (next: Partial<OrderFlowConfig>) => {
      config = { ...config, ...next };
    },
    applyTick: (tick: TradeTick) => {
      state = applyTradeTick(state, tick, config);
      emit();
    },
    applyTicks: (ticks: TradeTick[]) => {
      for (const t of ticks) state = applyTradeTick(state, t, config);
      emit();
    },
    setBook: (book: OrderBookLevel[]) => {
      state = applyBook(state, book);
      emit();
    },
    reset: () => {
      state = emptyOrderFlow(config.tickSize);
      emit();
    },
  };
}
