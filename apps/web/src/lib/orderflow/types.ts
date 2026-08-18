/** Aggressor side of an executed print. Buy = lift ask, sell = hit bid. */
export type AggressorSide = "buy" | "sell";

export type TradeTick = {
  id: string;
  ts: number;
  price: number;
  size: number;
  aggressorSide: AggressorSide;
};

export type OrderBookLevel = {
  price: number;
  size: number;
  side: "bid" | "ask";
};

/**
 * Intrabar cluster cell.
 * bidVolume = sell aggressors (hit bid), askVolume = buy aggressors (lift ask).
 */
export type FootprintLevel = {
  price: number;
  bidVolume: number;
  askVolume: number;
  totalVolume: number;
  delta: number;
};

/** Wire format from `/desk/{id}/footprint` (buy = ask vol, sell = bid vol). */
export type FootprintLevelWire = {
  price: number;
  buy: number;
  sell: number;
};

export type OrderFlowCandle = {
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  delta: number;
  cumulativeDelta: number;
  poc: number | null;
  levels: FootprintLevel[];
};

export type FootprintViewMode = "bidAsk" | "volume" | "delta";

export type CvdPoint = {
  ts: number;
  value: number;
};

export type SessionProfileRow = {
  price: number;
  bidVolume: number;
  askVolume: number;
  totalVolume: number;
  delta: number;
};

export type SessionProfile = {
  rows: SessionProfileRow[];
  volume: number;
  bidVolume: number;
  askVolume: number;
  delta: number;
  cvd: number;
  poc: number | null;
  vah: number | null;
  val: number | null;
  tick: number;
};

export type SmartPrint = {
  id: string;
  ts: number;
  price: number;
  size: number;
  aggressorSide: AggressorSide;
  count: number;
  block: boolean;
};

export type BookWallFlag = {
  price: number;
  side: "bid" | "ask";
  size: number;
  kind: "wall" | "spoof";
};

export type UnfinishedAuction = {
  high: boolean;
  low: boolean;
};

export type ImbalanceZone = {
  side: "bid" | "ask";
  prices: number[];
};

/** Single price cell inside a footprint candle (prompt: TickData). */
export type TickData = FootprintLevel;

export type CandleStats = {
  totalVolume: number;
  netDelta: number;
  maxDelta: number;
  minDelta: number;
  cumulativeDelta: number;
  deltaPercentage: number;
};
