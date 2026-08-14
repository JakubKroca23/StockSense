import type { Time, UTCTimestamp } from "lightweight-charts";

export type OhlcvBar = {
  time: Time;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type TradeTick = {
  id: string;
  ts: number;
  price: number;
  size: number;
  side: "buy" | "sell";
};

/** Incremental kline/candle update from a socket. */
export type CandleTick = {
  time: Time;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closed: boolean;
};

export type LinePoint = {
  time: Time;
  value: number;
};

export type HistogramPoint = {
  time: Time;
  value: number;
  color?: string;
};

export type ChartPoint = {
  time: UTCTimestamp;
  price: number;
};

export type DrawTool = "none" | "trend" | "ray" | "rect" | "hline";

export type ChartDrawing =
  | {
      id: string;
      kind: "trend" | "ray" | "rect";
      a: ChartPoint;
      b: ChartPoint;
      color: string;
    }
  | {
      id: string;
      kind: "hline";
      price: number;
      color: string;
    };

export type IndicatorParams = Record<string, number>;

export type IndicatorFn = (bars: OhlcvBar[], params?: IndicatorParams) => LinePoint[];

export type MarketInterval =
  | "1s"
  | "1m"
  | "5m"
  | "15m"
  | "30m"
  | "1h"
  | "4h"
  | "1d"
  | "1w";

export type HistoryQuery = {
  symbol: string;
  interval: MarketInterval;
  limit?: number;
  from?: number;
  to?: number;
};

export type MarketDataAdapter = {
  id: string;
  label: string;
  fetchHistory: (q: HistoryQuery) => Promise<OhlcvBar[]>;
  streamUrl?: (symbol: string, interval: MarketInterval) => string;
  parseSocket?: (raw: unknown) => CandleTick | TradeTick | null;
};
