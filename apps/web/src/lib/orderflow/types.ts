/** Wire types for `GET /desk/{id}/footprint` plus shared orderflow settings. */

export type FootprintLevel = {
  price: number;
  buy: number;
  sell: number;
};

export type FootprintBar = {
  ts: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  delta: number;
  poc: number | null;
  levels: FootprintLevel[];
};

export type FootprintData = {
  symbol: string;
  source: string;
  interval: string;
  lookback: string;
  tick: number;
  bars_count: number;
  as_of: string;
  note: string;
  bars: FootprintBar[];
};

/** What each footprint cell prints. */
export type FootprintCellMode = "bidask" | "delta" | "volume" | "profile";

/** What drives the cell background intensity. */
export type FootprintHeatMode = "volume" | "delta" | "off";

export type OrderflowSettings = {
  cellMode: FootprintCellMode;
  heatMode: FootprintHeatMode;
  /** Ticks merged into one footprint row. */
  tickGroup: number;
  barWidth: number;
  rowHeight: number;
  showText: boolean;
  showCandle: boolean;
  showPoc: boolean;
  showValueArea: boolean;
  valueAreaPct: number;
  showImbalance: boolean;
  /** Diagonal Bid(P) vs Ask(P+1) dominance in percent. 300 = 3:1. */
  imbalanceRatio: number;
  /** Absolute volume floor that kills statistically irrelevant imbalances. */
  imbalanceMinVolume: number;
  showStacked: boolean;
  stackedMin: number;
  showFade: boolean;
  showAbsorption: boolean;
  /** |delta| / volume needed to call a bar absorbed. */
  absorptionRatio: number;
  showDeltaRow: boolean;
  showVolumeRow: boolean;
  showCvd: boolean;
  cvdHeight: number;
  showProfile: boolean;
  profileWidth: number;
  heatOpacity: number;
};

export const DEFAULT_ORDERFLOW_SETTINGS: OrderflowSettings = {
  cellMode: "bidask",
  heatMode: "volume",
  tickGroup: 10,
  barWidth: 74,
  rowHeight: 15,
  showText: true,
  showCandle: true,
  showPoc: true,
  showValueArea: true,
  valueAreaPct: 70,
  showImbalance: true,
  imbalanceRatio: 300,
  imbalanceMinVolume: 0,
  showStacked: true,
  stackedMin: 3,
  showFade: true,
  showAbsorption: true,
  absorptionRatio: 0.35,
  showDeltaRow: true,
  showVolumeRow: true,
  showCvd: true,
  cvdHeight: 56,
  showProfile: true,
  profileWidth: 90,
  heatOpacity: 60,
};

export const TICK_GROUPS = [1, 2, 5, 10, 20, 25, 50, 100, 250] as const;

/** How the DOM ladder aggregates and flags book behaviour. */
export type DomSettings = {
  tickGroup: number;
  rowHeight: number;
  rows: number;
  centerLock: boolean;
  showHeatmap: boolean;
  heatWidth: number;
  /** Seconds of book history kept for the heatmap and pull/stack diffing. */
  heatSeconds: number;
  showVolume: boolean;
  showCumulative: boolean;
  showSessionProfile: boolean;
  /** Minutes of traded volume used for the volume-at-price columns. */
  sessionMinutes: number;
  showWalls: boolean;
  /** Depth multiple over the ladder median that counts as a wall. */
  wallRatio: number;
  showPulling: boolean;
  /** Share of a level that must vanish unfilled to call it pulling. */
  pullPct: number;
  showIceberg: boolean;
  /** Traded volume vs max observed depth that flags hidden size. */
  icebergRatio: number;
  showDepthBars: boolean;
};

export const DEFAULT_DOM_SETTINGS: DomSettings = {
  tickGroup: 10,
  rowHeight: 18,
  rows: 44,
  centerLock: true,
  showHeatmap: true,
  heatWidth: 96,
  heatSeconds: 90,
  showVolume: true,
  showCumulative: false,
  showSessionProfile: true,
  sessionMinutes: 60,
  showWalls: true,
  wallRatio: 3,
  showPulling: true,
  pullPct: 55,
  showIceberg: true,
  icebergRatio: 3,
  showDepthBars: true,
};
