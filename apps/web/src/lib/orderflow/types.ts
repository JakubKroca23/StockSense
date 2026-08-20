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
export type FootprintCellMode =
  | "bidask"
  | "delta"
  | "volume"
  | "profile"
  | "bidask-ladder"
  | "bidask-profile"
  | "delta-ladder"
  | "delta-profile";

export type FootprintImbalanceHighlight = "all" | "stacked";

/** What drives the cell background intensity. */
export type FootprintHeatMode = "volume" | "delta" | "off";

export type FootprintCandlePosition = "off" | "left" | "center" | "right";
export type FootprintProfileSide = "off" | "left" | "right" | "both";
export type ProfileRange = "visible" | "all" | "day" | "hour" | "custom";

/** Histogram overlay — independent from footprint / TPO. */
export type VolumeProfileAlign = "left" | "right";

export type VolumeProfileSettings = {
  tickGroup: number;
  profileWidth: number;
  rowHeight: number;
  showHistogram: boolean;
  showPoc: boolean;
  showValueArea: boolean;
  valueAreaPct: number;
  profileRange: ProfileRange;
  profileSessionMinutes: number;
  /** Histogram sits on the left or right edge of the session (day / hour / custom). */
  profileAlign: VolumeProfileAlign;
  upColor?: string;
  downColor?: string;
  pocColor?: string;
  vaColor?: string;
};

export type OrderflowSettings = {
  cellMode: FootprintCellMode;
  heatMode: FootprintHeatMode;
  /** Ticks merged into one footprint row. */
  tickGroup: number;
  barWidth: number;
  rowHeight: number;
  showText: boolean;
  showCandle: boolean;
  /** OHLC wick: edge of the column, or between bid and ask. */
  candlePosition: FootprintCandlePosition;
  /** Volume-profile histogram relative to the candle. */
  profileSide: FootprintProfileSide;
  showPoc: boolean;
  extendPoc: boolean;
  pocLineStyle: "solid" | "dashed" | "dotted";
  pocLineWidth: number;
  pocLineOpacity: number;
  showValueArea: boolean;
  valueAreaPct: number;
  showImbalance: boolean;
  /** Highlight every imbalance cell, or only those that belong to a stacked run. */
  imbalanceHighlight: FootprintImbalanceHighlight;
  /** Diagonal Bid(P) vs Ask(P+1) dominance in percent. 300 = 3:1. */
  imbalanceRatio: number;
  /** Absolute volume floor that kills statistically irrelevant imbalances. */
  imbalanceMinVolume: number;
  imbalanceFillOpacity: number;
  imbalanceStackedFillOpacity: number;
  imbalanceBuyColor?: string;
  imbalanceSellColor?: string;
  /** Heat scale: "bar" normalizes per bar, "global" across all visible bars. */
  heatScale: "bar" | "global";
  /** How profile cells are rendered in `cellMode=profile`. */
  profileStyle: "bars" | "cells";
  /** Volume or delta for the candle-side histogram and `profileStyle=cells`. */
  profileCellMetric: "volume" | "delta";
  showStacked: boolean;
  stackedMin: number;
  stackedLineStyle: "solid" | "dashed" | "dotted";
  stackedLineWidth: number;
  stackedFillOpacity: number;
  stackedLineOpacity: number;
  showFade: boolean;
  showAbsorption: boolean;
  /** |delta| / volume needed to call a bar absorbed. */
  absorptionRatio: number;
  showDeltaRow: boolean;
  showMaxDeltaRow: boolean;
  showMinDeltaRow: boolean;
  showVolumeRow: boolean;
  showCvd: boolean;
  cvdHeight: number;
  /** Total height of the chart footer (stat rows + CVD). Drag the divider to change. */
  footerHeight?: number;
  showProfile: boolean;
  profileWidth: number;
  heatOpacity: number;
  /** TPO letters in the dedicated profile chart. */
  showTpo: boolean;
  /** Minutes packed into one TPO letter (A, B, C…). */
  tpoBlockMinutes: number;
  /**
   * Volume profile window: visible bars, whole lookback, or one histogram
   * per UTC day / hour / custom block.
   */
  profileRange: ProfileRange;
  /** Minutes per custom session when `profileRange` is `"custom"`. */
  profileSessionMinutes: number;
  /** Vlastní barvy — prázdné = téma aplikace. */
  upColor?: string;
  downColor?: string;
  senseColor?: string;
  textColor?: string;
  fontBuyColor?: string;
  fontSellColor?: string;
  candleUpColor?: string;
  candleDownColor?: string;
};

export const DEFAULT_ORDERFLOW_SETTINGS: OrderflowSettings = {
  cellMode: "bidask",
  heatMode: "volume",
  tickGroup: 10,
  barWidth: 74,
  rowHeight: 15,
  showText: true,
  showCandle: true,
  candlePosition: "left",
  profileSide: "off",
  showPoc: true,
  extendPoc: false,
  pocLineStyle: "solid",
  pocLineWidth: 1,
  pocLineOpacity: 70,
  showValueArea: true,
  valueAreaPct: 70,
  showImbalance: true,
  imbalanceHighlight: "all",
  imbalanceRatio: 300,
  imbalanceMinVolume: 0,
  imbalanceFillOpacity: 22,
  imbalanceStackedFillOpacity: 40,
  imbalanceBuyColor: undefined,
  imbalanceSellColor: undefined,
  heatScale: "bar",
  profileStyle: "bars",
  profileCellMetric: "volume",
  showStacked: true,
  stackedMin: 3,
  stackedLineStyle: "dashed",
  stackedLineWidth: 1,
  stackedFillOpacity: 8,
  stackedLineOpacity: 55,
  showFade: true,
  showAbsorption: true,
  absorptionRatio: 0.35,
  showDeltaRow: true,
  showMaxDeltaRow: true,
  showMinDeltaRow: true,
  showVolumeRow: true,
  showCvd: true,
  cvdHeight: 56,
  footerHeight: undefined,
  showProfile: true,
  profileWidth: 90,
  heatOpacity: 60,
  showTpo: true,
  tpoBlockMinutes: 30,
  profileRange: "visible",
  profileSessionMinutes: 60,
  fontBuyColor: undefined,
  fontSellColor: undefined,
  candleUpColor: undefined,
  candleDownColor: undefined,
};

export const DEFAULT_VOLUME_PROFILE_SETTINGS: VolumeProfileSettings = {
  tickGroup: 10,
  profileWidth: 90,
  rowHeight: 15,
  showHistogram: true,
  showPoc: true,
  showValueArea: true,
  valueAreaPct: 70,
  profileRange: "visible",
  profileSessionMinutes: 60,
  profileAlign: "right",
};

export function normalizeVolumeProfileSettings(
  raw?: Partial<VolumeProfileSettings> | null,
  seedFrom?: Partial<OrderflowSettings> | null
): VolumeProfileSettings {
  const seed: Partial<VolumeProfileSettings> = raw
    ? {}
    : seedFrom
      ? {
          tickGroup: seedFrom.tickGroup,
          profileWidth: seedFrom.profileWidth,
          rowHeight: seedFrom.rowHeight,
          showHistogram: seedFrom.showProfile,
          showPoc: seedFrom.showPoc,
          showValueArea: seedFrom.showValueArea,
          valueAreaPct: seedFrom.valueAreaPct,
          profileRange: seedFrom.profileRange,
          profileSessionMinutes: seedFrom.profileSessionMinutes,
          upColor: seedFrom.upColor,
          downColor: seedFrom.downColor,
          pocColor: seedFrom.senseColor,
        }
      : {};
  return { ...DEFAULT_VOLUME_PROFILE_SETTINGS, ...seed, ...(raw ?? {}) };
}

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
  /** Unused — buy/sell columns always use the current UTC day. Kept for saved prefs. */
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
  showHeatmap: false,
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
