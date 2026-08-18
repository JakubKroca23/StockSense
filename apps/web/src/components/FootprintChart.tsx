"use client";

import { useEffect, useRef } from "react";
import {
  ColorType,
  CrosshairMode,
  IChartApi,
  ISeriesApi,
  LineStyle,
  Time,
  createChart,
} from "lightweight-charts";
import { useThemeRevision } from "@/lib/theme";
import {
  fromWireLevel,
  levelsFromWireBars,
  diagonalImbalances,
  unfinishedAuction,
  lowVolumeNodes,
  highVolumeNodes,
  valueArea,
  emptyLevel,
  buildCandleStats,
  type FootprintLevel as OfLevel,
  type FootprintViewMode,
  type CandleStats,
  type TickData,
} from "@/lib/orderflow";

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
  interval: string;
  tick: number;
  bars: FootprintBar[];
};

export type { CandleStats, TickData };

export type FpNumberMode = "auto" | "bidAsk" | "volume" | "delta";
export type FpHistAlign = "left" | "center" | "split";
export type FpPocStyle = "box" | "fill" | "both";

export type FpVizSettings = {
  numbers: boolean;
  poc: boolean;
  lvn: boolean;
  hvn: boolean;
  wicks: boolean;
  unfinished: boolean;
  valueArea: boolean;
  candleDelta: boolean;
  candleVolume: boolean;
  showZeros: boolean;
  cellGrid: boolean;
  textShadow: boolean;
  numberBySide: boolean;
  /** Cluster cell coloring. */
  view: FootprintViewMode;
  /** Numbers can differ from cell mode. */
  numberMode: FpNumberMode;
  histAlign: FpHistAlign;
  pocStyle: FpPocStyle;
  /** Group adjacent ticks: 1 = native. */
  tickGroup: number;
  /** Contrast curve for buy/sell fill (lower = punchier). */
  gamma: number;
  /** Overall cell fill 0–1. */
  fill: number;
  /** Normalize histogram to this candle vs whole session. */
  scale: "candle" | "session";
  /** Width-based volume histogram inside the candle (not only opacity). */
  histogram: boolean;
  /** Cluster width as a fraction of bar spacing. */
  bodyWidth: number;
  /** Vertical gap between cells in px. */
  cellGap: number;
  /** Number size multiplier. */
  fontScale: number;
  /** Dark cell background opacity 0–1. */
  cellBg: number;
  /** Hide cells below this total volume. */
  minVolume: number;
  /** Hide numbers below this volume / |delta|. */
  numberMin: number;
  /** LVN cut as a fraction of candle peak. */
  lvnPct: number;
  /** HVN cut as a fraction of candle peak. */
  hvnPct: number;
  /** Unfinished-auction marker size. */
  uaScale: number;
  buyColor: string;
  sellColor: string;
  pocColor: string;
  lvnColor: string;
  hvnColor: string;
  uaColor: string;
  vaColor: string;
  numberColor: string;
  imbAskColor: string;
  imbBidColor: string;
  /** Highlight stacked imbalance when one side ≥ this × the other. 0 = off. */
  imbalance: number;
  /** Min consecutive imbalanced ticks to mark a stack. */
  imbalanceStack: number;
  /** Extra fill on imbalanced side. */
  imbFill: number;
};

export const DEFAULT_FP_VIZ: FpVizSettings = {
  numbers: true,
  poc: true,
  lvn: true,
  hvn: false,
  wicks: true,
  unfinished: true,
  valueArea: false,
  candleDelta: false,
  candleVolume: false,
  showZeros: false,
  cellGrid: false,
  textShadow: false,
  numberBySide: false,
  view: "bidAsk",
  numberMode: "auto",
  histAlign: "split",
  pocStyle: "box",
  tickGroup: 1,
  gamma: 0.55,
  fill: 0.88,
  scale: "candle",
  histogram: false,
  bodyWidth: 0.9,
  cellGap: 0.4,
  fontScale: 1,
  cellBg: 0.16,
  minVolume: 0,
  numberMin: 0,
  lvnPct: 0.2,
  hvnPct: 0.75,
  uaScale: 1,
  buyColor: "#5dde8a",
  sellColor: "#e05a8a",
  pocColor: "#fff3b0",
  lvnColor: "#6ec8ff",
  hvnColor: "#c9a0ff",
  uaColor: "#ffe066",
  vaColor: "#9eb6ff",
  numberColor: "#e8eefc",
  imbAskColor: "#5dde8a",
  imbBidColor: "#e05a8a",
  imbalance: 3,
  imbalanceStack: 1,
  imbFill: 0.22,
};

export function groupLevels(levels: FootprintLevel[], tick: number, n: number): FootprintLevel[] {
  if (n <= 1) return levels;
  const step = tick * n;
  const map = new Map<number, FootprintLevel>();
  for (const lvl of levels) {
    const p = Math.round(lvl.price / step) * step;
    const cur = map.get(p);
    if (cur) {
      cur.buy += lvl.buy;
      cur.sell += lvl.sell;
    } else {
      map.set(p, { price: p, buy: lvl.buy, sell: lvl.sell });
    }
  }
  return [...map.values()].sort((a, b) => a.price - b.price);
}

function fillEmptyLevels(levels: OfLevel[], lo: number, hi: number, tick: number): OfLevel[] {
  if (!levels.length || tick <= 0) return levels;
  const start = Math.round(Math.min(lo, hi) / tick) * tick;
  const end = Math.round(Math.max(lo, hi) / tick) * tick;
  const n = Math.round((end - start) / tick);
  if (n < 1 || n > 400) return levels;
  const key = (p: number) => Number(p.toFixed(10));
  const map = new Map(levels.map((l) => [key(l.price), l]));
  const out: OfLevel[] = [];
  for (let i = 0; i <= n; i++) {
    const p = key(start + i * tick);
    out.push(map.get(p) || emptyLevel(p));
  }
  return out;
}

function readTheme() {
  const s = getComputedStyle(document.documentElement);
  const g = (name: string, fallback: string) => s.getPropertyValue(name).trim() || fallback;
  return {
    text: g("--text", "#e8eefc"),
    muted: g("--muted", "#93a0b8"),
    sense: g("--sense", "#5dde8a"),
    up: g("--chart-up", "#5dde8a"),
    down: g("--chart-down", "#e05a8a"),
    grid: g("--chart-grid", "rgba(158,182,255,0.08)"),
    bgElevated: g("--bg-elevated", "#121a2b"),
    chartBg: g("--chart-bg", "#060a12"),
    font: g("--font-body", '"IBM Plex Sans", sans-serif'),
  };
}

function hexAlpha(hex: string, alpha: number): string {
  const raw = hex.replace("#", "").trim();
  if (raw.length !== 6) return hex;
  const a = Math.round(Math.min(1, Math.max(0, alpha)) * 255)
    .toString(16)
    .padStart(2, "0");
  return `#${raw}${a}`;
}

function toUnix(ts: string): Time {
  const s = ts.trim();
  const hasTz = /[zZ]|[+-]\d{2}:?\d{2}$/.test(s);
  const d = new Date(hasTz ? s : `${s}Z`);
  return Math.floor(d.getTime() / 1000) as Time;
}

function nearestUnix(target: number, times: number[]): number | null {
  if (!times.length) return null;
  let lo = 0;
  let hi = times.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] < target) lo = mid + 1;
    else hi = mid - 1;
  }
  const a = times[Math.max(0, hi)];
  const b = times[Math.min(times.length - 1, lo)];
  const pick = Math.abs(a - target) <= Math.abs(b - target) ? a : b;
  const step = times.length > 1 ? Math.abs(times[1] - times[0]) : 60;
  if (!Number.isFinite(pick) || Math.abs(pick - target) > Math.max(step, 1) * 0.51) return null;
  return pick;
}

export function timeCoordinate(chart: IChartApi, ts: string, alignTimes?: number[]): number | null {
  const unix = toUnix(ts);
  const direct = chart.timeScale().timeToCoordinate(unix);
  if (direct != null) return direct;
  const snapped = nearestUnix(Number(unix), alignTimes || []);
  if (snapped == null) return null;
  return chart.timeScale().timeToCoordinate(snapped as Time);
}

export function fmtV(n: number) {
  const a = Math.abs(n);
  if (a >= 1000) return `${(a / 1000).toFixed(1)}k`;
  if (a >= 10) return a.toFixed(0);
  if (a >= 1) return a.toFixed(1);
  return a.toFixed(2);
}

export function fmtDelta(n: number) {
  if (!Number.isFinite(n)) return "—";
  if (n === 0) return "0";
  return `${n > 0 ? "+" : "−"}${fmtV(n)}`;
}

/** Volume histogram band (above stats) when footprint is on. */
export const FP_VOL_FRAC = 0.13;
/** Stats table at the bottom edge. */
export const FP_STATS_FRAC = 0.22;

export function fpOverlayBottom(footprint: boolean, volume: boolean): number {
  if (footprint) return FP_STATS_FRAC + (volume ? FP_VOL_FRAC : 0);
  if (volume) return 0.18;
  return 0.06;
}

export function fpVolumeMargins(footprint: boolean, volume: boolean): { top: number; bottom: number } {
  if (footprint && volume) return { top: 1 - FP_VOL_FRAC - FP_STATS_FRAC, bottom: FP_STATS_FRAC };
  if (volume) return { top: 0.84, bottom: 0 };
  return { top: 1, bottom: 0 };
}

/** Top of overlay (volume + stats, or stats only) — footprint/candles clip here. */
export function fpBandTop(h: number, footprint: boolean, volume = false): number {
  if (footprint) return Math.round(h * (1 - fpOverlayBottom(true, volume)));
  if (volume) return Math.round(h * 0.84);
  return h;
}

export function fpStatsTop(h: number, footprint: boolean): number {
  if (!footprint) return h;
  return Math.round(h * (1 - FP_STATS_FRAC));
}

function contrastInk(hex: string, alpha: number): string {
  const raw = hex.replace("#", "").trim();
  if (raw.length !== 6) return "#f3f6ff";
  const r = parseInt(raw.slice(0, 2), 16) / 255;
  const g = parseInt(raw.slice(2, 4), 16) / 255;
  const b = parseInt(raw.slice(4, 6), 16) / 255;
  const bg = 0.045;
  const R = r * alpha + bg * (1 - alpha);
  const G = g * alpha + bg * (1 - alpha);
  const B = b * alpha + bg * (1 - alpha);
  const lum = 0.2126 * R + 0.7152 * G + 0.0722 * B;
  return lum > 0.48 ? "#10141c" : "#f3f6ff";
}

type VolumeStatsTheme = {
  text: string;
  muted: string;
  up: string;
  down: string;
  font: string;
  bgElevated: string;
};

type StatsMemo = {
  bars: FootprintBar[];
  lastTs: string;
  lastVol: number;
  lastDelta: number;
  rows: CandleStats[];
};
let statsMemo: StatsMemo | null = null;

function candleStatsOf(bars: FootprintBar[]): CandleStats[] {
  const last = bars[bars.length - 1];
  if (
    statsMemo &&
    statsMemo.bars === bars &&
    statsMemo.lastTs === last?.ts &&
    statsMemo.lastVol === last?.volume &&
    statsMemo.lastDelta === last?.delta
  ) {
    return statsMemo.rows;
  }
  const rows = buildCandleStats(bars);
  statsMemo = {
    bars,
    lastTs: last?.ts || "",
    lastVol: last?.volume || 0,
    lastDelta: last?.delta || 0,
    rows,
  };
  return rows;
}

const STATS_LABELS = ["Vol", "Δ", "MaxΔ", "MinΔ", "CVD"] as const;

function heatT(value: number, peak: number): number {
  if (!(peak > 0) || !Number.isFinite(value)) return 0;
  return Math.min(1, Math.abs(value) / peak);
}

function volHeat(t: number): { bg: string; ink: string } {
  const a = 0.2 + t * 0.72;
  const r = Math.round(36 + t * 196);
  const g = Math.round(78 + t * 86);
  const b = Math.round(132 - t * 86);
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return {
    bg: `rgba(${r},${g},${b},${a.toFixed(3)})`,
    ink: lum * a + 0.05 * (1 - a) > 0.42 ? "#10141c" : "#f3f6ff",
  };
}

/** Aligned candle stats grid flush to the bottom edge. Volume histogram sits above. */
export function drawVolumeBarStats(
  ctx: CanvasRenderingContext2D,
  chart: IChartApi,
  data: FootprintData | null,
  ohlcv: { ts: string; volume?: number }[],
  clipRight: number,
  h: number,
  theme: VolumeStatsTheme,
  alignTimes?: number[],
  footprintOn = false
) {
  if (!footprintOn) return;
  const statsTop = fpStatsTop(h, true);
  const bandH = h - statsTop;
  if (bandH < 44 || clipRight < 24) return;

  const fpBars = data?.bars?.length ? data.bars : [];
  const stats = fpBars.length ? candleStatsOf(fpBars) : null;
  const spacing = chart.timeScale().options().barSpacing || 9;
  const colW = Math.max(4, spacing * 0.92);
  const showText = colW >= 12;
  if (colW < 5) return;

  const labels = stats ? STATS_LABELS : (["Vol"] as const);
  const nRows = labels.length;
  const rowH = Math.floor(bandH / nRows);
  if (rowH < 14) return;
  const tableH = rowH * nRows;
  const tableTop = h - tableH;
  const labW = 46;
  const fs = Math.max(12, Math.min(16, Math.floor(rowH * 0.58)));
  const labFs = Math.max(12, Math.min(14, fs));

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, statsTop, clipRight, bandH);
  ctx.clip();
  ctx.fillStyle = hexAlpha(theme.bgElevated, 0.92);
  ctx.fillRect(0, statsTop, clipRight, bandH);
  ctx.strokeStyle = hexAlpha(theme.muted, 0.28);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, statsTop + 0.5);
  ctx.lineTo(clipRight, statsTop + 0.5);
  ctx.stroke();

  const paintLabels = () => {
    ctx.fillStyle = hexAlpha(theme.bgElevated, 1);
    ctx.fillRect(0, tableTop, labW, tableH);
    ctx.font = `700 ${labFs}px ${theme.font}`;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    for (let i = 0; i < nRows; i++) {
      ctx.fillStyle = hexAlpha(theme.muted, 0.98);
      ctx.fillText(labels[i], 6, tableTop + rowH * (i + 0.5));
      ctx.strokeStyle = hexAlpha(theme.muted, 0.18);
      ctx.beginPath();
      ctx.moveTo(0, tableTop + rowH * (i + 1) + 0.5);
      ctx.lineTo(clipRight, tableTop + rowH * (i + 1) + 0.5);
      ctx.stroke();
    }
  };
  paintLabels();

  let peakVol = 0;
  let peakAbsDelta = 0;
  let peakAbsMax = 0;
  let peakAbsMin = 0;
  let peakAbsCvd = 0;
  const vis = chart.timeScale().getVisibleRange();
  const from = vis ? Number(vis.from) - 120 : -Infinity;
  const to = vis ? Number(vis.to) + 120 : Infinity;
  const n = stats && fpBars.length ? Math.min(fpBars.length, stats.length) : 0;
  if (stats && n) {
    for (let i = 0; i < n; i++) {
      const t = Number(toUnix(fpBars[i].ts));
      if (t < from || t > to) continue;
      const st = stats[i];
      if (st.totalVolume > peakVol) peakVol = st.totalVolume;
      const ad = Math.abs(st.netDelta);
      if (ad > peakAbsDelta) peakAbsDelta = ad;
      const aMax = Math.abs(st.maxDelta);
      if (aMax > peakAbsMax) peakAbsMax = aMax;
      const aMin = Math.abs(st.minDelta);
      if (aMin > peakAbsMin) peakAbsMin = aMin;
      const aCvd = Math.abs(st.cumulativeDelta);
      if (aCvd > peakAbsCvd) peakAbsCvd = aCvd;
    }
  } else {
    for (const b of ohlcv) {
      const v = b.volume ?? 0;
      if (v > peakVol) peakVol = v;
    }
  }

  const paintAt = (ts: string, st: CandleStats | null, fallbackVol: number) => {
    const x = timeCoordinate(chart, ts, alignTimes);
    if (x == null) return;
    const left = x - colW / 2;
    if (left > clipRight || left + colW < labW) return;
    const x0 = Math.max(left, labW);
    const cellW = Math.min(left + colW, clipRight) - x0;
    if (cellW < 3) return;
    const mid = left + colW / 2;
    const cells: { t: string; bg: string; fg: string }[] = [];
    if (st) {
      const vh = volHeat(heatT(st.totalVolume, peakVol));
      const dA = heatT(st.netDelta, peakAbsDelta);
      const mxA = heatT(st.maxDelta, peakAbsMax);
      const mnA = heatT(st.minDelta, peakAbsMin);
      const cA = heatT(st.cumulativeDelta, peakAbsCvd);
      const signed = (a: number, pos: boolean) => {
        const hex = pos ? theme.up : theme.down;
        const alpha = 0.18 + a * 0.78;
        return { bg: hexAlpha(hex, alpha), fg: contrastInk(hex, alpha) };
      };
      const d = signed(dA, st.netDelta >= 0);
      const mx = signed(mxA, true);
      const mn = signed(mnA, false);
      const cv = signed(cA, st.cumulativeDelta >= 0);
      cells.push(
        { t: fmtV(st.totalVolume), bg: vh.bg, fg: vh.ink },
        { t: fmtDelta(st.netDelta), bg: d.bg, fg: d.fg },
        { t: fmtDelta(st.maxDelta), bg: mx.bg, fg: mx.fg },
        { t: fmtDelta(st.minDelta), bg: mn.bg, fg: mn.fg },
        { t: fmtDelta(st.cumulativeDelta), bg: cv.bg, fg: cv.fg }
      );
    } else {
      const vh = volHeat(heatT(fallbackVol, peakVol));
      cells.push({ t: fmtV(fallbackVol), bg: vh.bg, fg: vh.ink });
    }
    ctx.textAlign = "center";
    ctx.font = `700 ${fs}px ${theme.font}`;
    const nPaint = Math.min(cells.length, nRows);
    for (let i = 0; i < nPaint; i++) {
      const y = tableTop + rowH * i;
      ctx.fillStyle = cells[i].bg;
      ctx.fillRect(x0, y, cellW, rowH);
      if (showText && mid >= labW + 4) {
        ctx.fillStyle = cells[i].fg;
        ctx.fillText(cells[i].t, mid, y + rowH * 0.5, cellW - 4);
      }
    }
  };

  if (fpBars.length && stats) {
    for (let i = 0; i < n; i++) {
      const t = Number(toUnix(fpBars[i].ts));
      if (t < from || t > to) continue;
      paintAt(fpBars[i].ts, stats[i], fpBars[i].volume);
    }
  } else {
    for (const b of ohlcv) paintAt(b.ts, null, b.volume ?? 0);
  }

  paintLabels();
  ctx.restore();
}

export type FpProfileRow = {
  price: number;
  buy: number;
  sell: number;
  vol: number;
  delta: number;
};

export type FpProfile = {
  rows: FpProfileRow[];
  buy: number;
  sell: number;
  volume: number;
  delta: number;
  cvd: number;
  poc: number | null;
  vah: number | null;
  val: number | null;
  tick: number;
};

export function aggregateFootprint(data: FootprintData, tickGroup = 1): FpProfile {
  const tick = (data.tick || 0.01) * Math.max(1, tickGroup);
  const session = levelsFromWireBars(data.bars, tick);
  return {
    rows: session.rows.map((r) => ({
      price: r.price,
      buy: r.askVolume,
      sell: r.bidVolume,
      vol: r.totalVolume,
      delta: r.delta,
    })),
    buy: session.askVolume,
    sell: session.bidVolume,
    volume: session.volume,
    delta: session.delta,
    cvd: session.cvd,
    poc: session.poc,
    vah: session.vah,
    val: session.val,
    tick,
  };
}

type FpDrawTheme = {
  text: string;
  sense: string;
  up: string;
  down: string;
  font: string;
};

function intervalPadSec(interval: string): number {
  const m: Record<string, number> = {
    "1s": 2,
    "1m": 120,
    "5m": 600,
    "15m": 1800,
    "30m": 3600,
    "1h": 7200,
    "4h": 28800,
    "1d": 172800,
    "1wk": 1209600,
  };
  return m[interval] ?? 180;
}

function levelPeak(lvl: { buy?: number; sell?: number }, view: FootprintViewMode): number {
  const buy = lvl.buy || 0;
  const sell = lvl.sell || 0;
  if (view === "volume") return buy + sell;
  if (view === "delta") return Math.abs(buy - sell);
  return Math.max(buy, sell, buy + sell);
}

type PrepBar = {
  bar: FootprintBar;
  levels: OfLevel[];
  poc: number | null;
  localPeak: number;
  imbBid: Set<number>;
  imbAsk: Set<number>;
  ua: { high: boolean; low: boolean };
  lvn: Set<number>;
  hvn: Set<number>;
  va: { poc: number | null; vah: number | null; val: number | null } | null;
  hiP: number;
  loP: number;
};

const prepCache = new Map<string, PrepBar>();
let sessionPeakMemo: { sig: string; peak: number } | null = null;

function prepBar(
  b: FootprintBar,
  nativeTick: number,
  tick: number,
  groupN: number,
  viz: FpVizSettings,
  imb: number,
  stackMin: number,
  fancy: boolean,
  view: FootprintViewMode
): Omit<PrepBar, "bar"> {
  const key = `${b.ts}|${b.volume}|${b.delta}|${b.levels?.length}|${groupN}|${imb}|${stackMin}|${viz.showZeros ? 1 : 0}|${fancy && viz.unfinished ? 1 : 0}|${fancy && viz.lvn !== false ? viz.lvnPct : 0}|${fancy && viz.hvn ? viz.hvnPct : 0}|${fancy && viz.valueArea ? 1 : 0}|${view}`;
  const hit = prepCache.get(key);
  if (hit) return hit;
  const wire = groupLevels(b.levels, nativeTick, groupN);
  let levels = wire.map(fromWireLevel);
  let poc = b.poc;
  let localPeak = 0;
  if (levels.length) {
    let best = levels[0];
    for (const lvl of levels) {
      if (lvl.totalVolume > best.totalVolume) best = lvl;
    }
    poc = best.price;
  }
  let hiP = b.high;
  let loP = b.low;
  if (levels.length) {
    hiP = levels[0].price;
    loP = levels[0].price;
    for (const lvl of levels) {
      if (lvl.price > hiP) hiP = lvl.price;
      if (lvl.price < loP) loP = lvl.price;
    }
  }
  if (viz.showZeros) levels = fillEmptyLevels(levels, Math.min(loP, b.low), Math.max(hiP, b.high), tick);
  const diag = imb > 0 ? diagonalImbalances(levels, tick, imb, stackMin) : { bid: new Set<number>(), ask: new Set<number>() };
  const ua =
    fancy && viz.unfinished
      ? unfinishedAuction({ high: b.high, low: b.low, levels })
      : { high: false, low: false };
  const lvn =
    fancy && viz.lvn !== false ? new Set(lowVolumeNodes(levels, viz.lvnPct ?? 0.2)) : new Set<number>();
  const hvn =
    fancy && viz.hvn ? new Set(highVolumeNodes(levels, viz.hvnPct ?? 0.75)) : new Set<number>();
  const va =
    fancy && viz.valueArea
      ? valueArea(
          levels.map((l) => ({
            price: l.price,
            bidVolume: l.bidVolume,
            askVolume: l.askVolume,
            totalVolume: l.totalVolume,
            delta: l.delta,
          })),
          0.7
        )
      : null;
  for (const lvl of levels) {
    if (view === "volume") localPeak = Math.max(localPeak, lvl.totalVolume);
    else if (view === "delta") localPeak = Math.max(localPeak, Math.abs(lvl.delta));
    else localPeak = Math.max(localPeak, lvl.askVolume, lvl.bidVolume);
  }
  const prep: PrepBar = {
    bar: b,
    levels,
    poc,
    localPeak,
    imbBid: diag.bid,
    imbAsk: diag.ask,
    ua,
    lvn,
    hvn,
    va,
    hiP,
    loP,
  };
  if (prepCache.size > 1200) prepCache.clear();
  prepCache.set(key, prep);
  return prep;
}

export function drawFootprintOnChart(
  ctx: CanvasRenderingContext2D,
  chart: IChartApi,
  series: ISeriesApi<"Candlestick">,
  data: FootprintData,
  viz: FpVizSettings,
  w: number,
  h: number,
  clipRight: number,
  theme: FpDrawTheme,
  alignTimes?: number[],
  clipBottom?: number
) {
  const bars = data.bars;
  if (!bars.length) return;
  const yMax = clipBottom ?? h;
  const groupN = Math.max(1, Math.round(viz.tickGroup || 1));
  const tick = (data.tick || 0.01) * groupN;
  const spacing = chart.timeScale().options().barSpacing || 9;
  const body = Math.min(1, Math.max(0.4, viz.bodyWidth ?? 0.9));
  const colW = Math.max(4, spacing * body);
  const zoomedOut = colW < 10;
  const showText = viz.numbers && colW >= 12 && !zoomedOut;
  const fancy = colW >= 10;
  const stroke = Math.max(1.1, Math.min(3.4, colW * 0.05 + 0.75));
  const gamma = Math.min(1.45, Math.max(0.28, viz.gamma ?? 0.55));
  const fill = Math.min(1, Math.max(0.2, viz.fill ?? 0.88));
  const hist = viz.histogram === true;
  const perCandle = (viz.scale || "candle") === "candle";
  const buyCol = viz.buyColor || theme.up;
  const sellCol = viz.sellColor || theme.down;
  const pocCol = viz.pocColor || "#fff3b0";
  const lvnCol = viz.lvnColor || "#6ec8ff";
  const hvnCol = viz.hvnColor || "#c9a0ff";
  const uaCol = viz.uaColor || "#ffe066";
  const vaCol = viz.vaColor || "#9eb6ff";
  const numCol = viz.numberColor || theme.text;
  const imbAskCol = viz.imbAskColor || buyCol;
  const imbBidCol = viz.imbBidColor || sellCol;
  const imb = fancy && viz.imbalance > 0 ? viz.imbalance : 0;
  const stackMin = Math.max(1, Math.round(viz.imbalanceStack || 1));
  const imbFill = Math.min(0.55, Math.max(0, viz.imbFill ?? 0.22));
  const view = viz.view || "bidAsk";
  const nMode: FootprintViewMode =
    viz.numberMode && viz.numberMode !== "auto" ? viz.numberMode : view;
  const histAlign = viz.histAlign || "split";
  const pocStyle = viz.pocStyle || "box";
  const gap = Math.min(4, Math.max(0, viz.cellGap ?? 0.4));
  const fontScale = Math.min(1.9, Math.max(0.55, viz.fontScale ?? 1));
  const cellBg = Math.min(0.7, Math.max(0, viz.cellBg ?? 0.16));
  const minVol = Math.max(0, viz.minVolume || 0);
  const numMin = Math.max(0, viz.numberMin || 0);
  const vis = chart.timeScale().getVisibleRange();
  const padT = intervalPadSec(data.interval);
  const from = vis ? Number(vis.from) - padT : null;
  const to = vis ? Number(vis.to) + padT : null;

  let sessionPeak = 0;
  if (!perCandle) {
    const last = bars[bars.length - 1];
    const sig = `${bars.length}:${last?.ts}:${last?.volume}:${last?.delta}:${view}:${groupN}`;
    if (sessionPeakMemo?.sig === sig) sessionPeak = sessionPeakMemo.peak;
    else {
      for (const b of bars) {
        for (const lvl of b.levels || []) sessionPeak = Math.max(sessionPeak, levelPeak(lvl, view));
      }
      sessionPeakMemo = { sig, peak: sessionPeak };
    }
  }
  const grouped: PrepBar[] = [];
  for (const b of bars) {
    if (from != null && to != null) {
      const t = Number(toUnix(b.ts));
      if (t < from || t > to) continue;
    }
    const prep = prepBar(b, data.tick || 0.01, tick, groupN, viz, imb, stackMin, fancy, view);
    sessionPeak = Math.max(sessionPeak, prep.localPeak);
    grouped.push({ ...prep, bar: b });
  }
  if (sessionPeak <= 0 && grouped.length === 0) return;

  const allowText = showText && grouped.length <= 140;
  const allowFancy = fancy && grouped.length <= 140;
  let textCells = 0;
  const MAX_TEXT_CELLS = 900;

  ctx.textBaseline = "middle";

  const cellBox = (price: number) => {
    const y = series.priceToCoordinate(price);
    const y2 = series.priceToCoordinate(price - tick);
    if (y == null) return null;
    const yBot = y2 == null ? y + 4 : y2;
    const top = Math.min(y, yBot);
    const bot = Math.max(y, yBot);
    return { top, bot, cellH: Math.max(1.2, bot - top - gap) };
  };

  for (const { bar, levels, poc, imbBid, imbAsk, ua, lvn, hvn, va, hiP, loP, localPeak } of grouped) {
    const x = timeCoordinate(chart, bar.ts, alignTimes);
    if (x == null) continue;
    const left = x - colW / 2;
    if (left > clipRight || left + colW < 0) continue;
    const cellW = Math.min(colW, Math.max(4, clipRight - left));
    const midX = left + cellW / 2;
    const half = cellW / 2;
    const peak = Math.max(1e-12, perCandle ? localPeak : sessionPeak);

    if (viz.wicks !== false) {
      const yH = series.priceToCoordinate(bar.high);
      const yL = series.priceToCoordinate(bar.low);
      if (yH != null && yL != null) {
        ctx.strokeStyle = hexAlpha(bar.close >= bar.open ? buyCol : sellCol, 0.7);
        ctx.lineWidth = Math.max(1, Math.min(2.4, cellW * 0.045));
        ctx.beginPath();
        ctx.moveTo(midX + 0.5, Math.max(0, Math.min(yH, yL)));
        ctx.lineTo(midX + 0.5, Math.min(yMax, Math.max(yH, yL)));
        ctx.stroke();
      }
    }

    for (const lvl of levels) {
      const isImbBid = imbBid.has(lvl.price);
      const isImbAsk = imbAsk.has(lvl.price);
      if (minVol > 0 && lvl.totalVolume < minVol && !isImbBid && !isImbAsk) continue;
      const box = cellBox(lvl.price);
      if (!box || box.top > yMax || box.bot < 0) continue;
      const { top, cellH } = box;
      if (top > yMax) continue;
      const drawH = Math.min(cellH, yMax - top);
      if (drawH < 1) continue;
      const isPoc = viz.poc && poc != null && Math.abs(lvl.price - poc) < tick / 2;
      const inVa =
        va &&
        va.val != null &&
        va.vah != null &&
        lvl.price >= Math.min(va.val, va.vah) - tick / 2 &&
        lvl.price <= Math.max(va.val, va.vah) + tick / 2;

      if (cellBg > 0) {
        ctx.fillStyle = `rgba(0,0,0,${cellBg})`;
        ctx.fillRect(left, top, cellW, drawH);
      }
      if (inVa && !isPoc) {
        ctx.fillStyle = hexAlpha(vaCol, 0.12);
        ctx.fillRect(left, top, cellW, drawH);
      }

      const sellT = Math.pow(Math.min(1, lvl.bidVolume / peak), gamma);
      const buyT = Math.pow(Math.min(1, lvl.askVolume / peak), gamma);
      const sellA = fill * (0.1 + 0.9 * sellT);
      const buyA = fill * (0.1 + 0.9 * buyT);

      if (view === "volume") {
        const t = Math.pow(lvl.totalVolume / peak, gamma);
        const bw = hist ? Math.max(1.5, cellW * t) : Math.max(2, cellW * (0.12 + t * 0.88));
        ctx.fillStyle = hexAlpha(lvl.delta >= 0 ? buyCol : sellCol, fill * (0.22 + 0.78 * t));
        if (histAlign === "center" || !hist) ctx.fillRect(midX - bw / 2, top, bw, drawH);
        else ctx.fillRect(left, top, bw, drawH);
      } else if (view === "delta") {
        const t = Math.pow(Math.abs(lvl.delta) / peak, gamma);
        const bw = hist ? Math.max(1.5, half * t) : Math.max(2, half * (0.1 + t * 0.9));
        ctx.fillStyle = hexAlpha(lvl.delta >= 0 ? buyCol : sellCol, fill * (0.22 + 0.78 * t));
        if (histAlign === "center") ctx.fillRect(midX - bw / 2, top, bw, drawH);
        else if (lvl.delta >= 0) ctx.fillRect(midX, top, bw, drawH);
        else ctx.fillRect(midX - bw, top, bw, drawH);
      } else if (hist) {
        const sellW = Math.max(0, half * sellT);
        const buyW = Math.max(0, half * buyT);
        ctx.fillStyle = hexAlpha(sellCol, sellA);
        if (histAlign === "left") ctx.fillRect(left, top, sellW, drawH);
        else if (histAlign === "center") ctx.fillRect(left + (half - sellW) / 2, top, sellW, drawH);
        else ctx.fillRect(midX - sellW, top, sellW, drawH);
        ctx.fillStyle = hexAlpha(buyCol, buyA);
        if (histAlign === "left") ctx.fillRect(midX, top, buyW, drawH);
        else if (histAlign === "center") ctx.fillRect(midX + (half - buyW) / 2, top, buyW, drawH);
        else ctx.fillRect(midX, top, buyW, drawH);
      } else {
        ctx.fillStyle = hexAlpha(sellCol, sellA);
        ctx.fillRect(left, top, half, drawH);
        ctx.fillStyle = hexAlpha(buyCol, buyA);
        ctx.fillRect(midX, top, half, drawH);
      }

      if (colW >= 16 && view === "bidAsk") {
        ctx.strokeStyle = hexAlpha(theme.text, 0.18);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(midX + 0.5, top);
        ctx.lineTo(midX + 0.5, top + drawH);
        ctx.stroke();
      }

      if (isImbBid) {
        ctx.fillStyle = hexAlpha(imbBidCol, imbFill + 0.12);
        ctx.fillRect(left, top, half, drawH);
      }
      if (isImbAsk) {
        ctx.fillStyle = hexAlpha(imbAskCol, imbFill + 0.12);
        ctx.fillRect(midX, top, half, drawH);
      }

      if (isPoc) {
        if (pocStyle === "fill" || pocStyle === "both") {
          ctx.fillStyle = hexAlpha(pocCol, pocStyle === "both" ? 0.2 : 0.36);
          ctx.fillRect(left, top, cellW, drawH);
        }
        if (pocStyle === "box" || pocStyle === "both") {
          ctx.strokeStyle = hexAlpha(pocCol, 0.98);
          ctx.lineWidth = Math.max(1.8, stroke);
          ctx.strokeRect(left + 0.5, top + 0.5, cellW - 1, drawH - 1);
        }
      }

      if (allowFancy && hvn.has(lvl.price) && !isPoc) {
        ctx.strokeStyle = hexAlpha(hvnCol, 0.9);
        ctx.lineWidth = stroke;
        ctx.strokeRect(left + 0.5, top + 0.5, cellW - 1, drawH - 1);
      }

      if (allowFancy && lvn.has(lvl.price)) {
        ctx.strokeStyle = hexAlpha(lvnCol, 0.85);
        ctx.lineWidth = stroke;
        ctx.strokeRect(left + 1, top + 1, cellW - 2, drawH - 2);
      }

      const isUa =
        allowFancy &&
        ((ua.high && Math.abs(lvl.price - hiP) < tick / 2) ||
          (ua.low && Math.abs(lvl.price - loP) < tick / 2));
      if (isUa) {
        ctx.fillStyle = hexAlpha(uaCol, 0.22);
        ctx.fillRect(left, top, cellW, drawH);
        ctx.strokeStyle = uaCol;
        ctx.lineWidth = stroke + 0.4;
        ctx.strokeRect(left + 0.5, top + 0.5, cellW - 1, drawH - 1);
      }

      if (viz.cellGrid) {
        ctx.strokeStyle = hexAlpha(theme.text, 0.12);
        ctx.lineWidth = 0.6;
        ctx.strokeRect(left + 0.5, top + 0.5, cellW - 1, drawH - 1);
      }

      const fontPx = Math.max(
        6,
        Math.min(22, Math.min(colW * (nMode === "bidAsk" ? 0.18 : 0.26), drawH * 0.7) * fontScale)
      );
      if (allowText && drawH >= fontPx + 1 && textCells < MAX_TEXT_CELLS) {
        textCells += 1;
        ctx.font = `${isImbBid || isImbAsk ? 750 : 650} ${fontPx}px ${theme.font}`;
        const useShadow = viz.textShadow === true;
        if (useShadow) {
          ctx.shadowColor = "rgba(0,0,0,0.85)";
          ctx.shadowBlur = 2;
        }
        const padN = Math.max(2, fontPx * 0.28);
        const cy = top + drawH / 2;
        const writeSide = (n: number, align: CanvasTextAlign, px: number, bgHex: string, alpha: number, hot: boolean) => {
          if (!(n > 0) || n < numMin) return;
          ctx.textAlign = align;
          if (hot) {
            const tw = Math.min(half - 2, fontPx * 2.4);
            ctx.fillStyle = hexAlpha(bgHex, 0.92);
            ctx.fillRect(align === "right" ? px - tw : px, cy - fontPx * 0.55, tw, fontPx * 1.1);
            ctx.fillStyle = contrastInk(bgHex, 0.92);
          } else {
            ctx.fillStyle = viz.numberBySide ? contrastInk(bgHex, alpha) : hexAlpha(numCol, 0.96);
          }
          ctx.fillText(fmtV(n), px, cy);
        };
        if (nMode === "volume") {
          ctx.textAlign = "center";
          ctx.fillStyle = viz.numberBySide
            ? contrastInk(lvl.delta >= 0 ? buyCol : sellCol, fill)
            : hexAlpha(numCol, 0.96);
          ctx.fillText(fmtV(lvl.totalVolume), midX, cy);
        } else if (nMode === "delta") {
          if (Math.abs(lvl.delta) >= Math.max(numMin, 1e-9)) {
            ctx.textAlign = "center";
            ctx.fillStyle = contrastInk(lvl.delta >= 0 ? buyCol : sellCol, fill * 0.7);
            const sign = lvl.delta > 0 ? "+" : lvl.delta < 0 ? "−" : "";
            ctx.fillText(`${sign}${fmtV(Math.abs(lvl.delta))}`, midX, cy);
          }
        } else if (colW >= 22) {
          writeSide(lvl.bidVolume, "right", midX - padN, sellCol, sellA, isImbBid);
          writeSide(lvl.askVolume, "left", midX + padN, buyCol, buyA, isImbAsk);
        } else {
          ctx.textAlign = "center";
          ctx.fillStyle = hexAlpha(numCol, 0.96);
          ctx.fillText(fmtV(lvl.totalVolume), midX, cy);
        }
        ctx.shadowBlur = 0;
        ctx.shadowColor = "transparent";
      }
    }

    if (viz.candleDelta || viz.candleVolume) {
      const yHi = series.priceToCoordinate(hiP);
      if (yHi != null && yHi > 10 && yHi < yMax) {
        const fs = Math.max(8, Math.min(12, colW * 0.22));
        ctx.font = `700 ${fs}px ${theme.font}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        let ly = yHi - 2;
        if (viz.candleVolume) {
          ctx.fillStyle = hexAlpha(theme.text, 0.9);
          ctx.fillText(fmtV(bar.volume), midX, ly);
          ly -= fs + 1;
        }
        if (viz.candleDelta) {
          ctx.fillStyle = hexAlpha(bar.delta >= 0 ? buyCol : sellCol, 0.95);
          ctx.fillText(fmtDelta(bar.delta), midX, ly);
        }
        ctx.textBaseline = "middle";
      }
    }

    if (allowFancy && (ua.high || ua.low)) {
      const mark = (price: number, up: boolean) => {
        const y = series.priceToCoordinate(price);
        if (y == null || y > yMax) return;
        const size = Math.max(8, Math.min(22, colW * 0.4)) * Math.min(1.6, Math.max(0.5, viz.uaScale ?? 1));
        const dir = up ? 1 : -1;
        const base = y + dir * size;
        ctx.beginPath();
        ctx.moveTo(midX, y);
        ctx.lineTo(midX - size * 0.9, base);
        ctx.lineTo(midX + size * 0.9, base);
        ctx.closePath();
        ctx.fillStyle = uaCol;
        ctx.fill();
      };
      if (ua.high) mark(hiP, true);
      if (ua.low) mark(loP, false);
    }
  }
}

export function FootprintChart({
  data,
  viz,
}: {
  data: FootprintData;
  viz?: Partial<FpVizSettings>;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const dataRef = useRef(data);
  const vizRef = useRef<FpVizSettings>({ ...DEFAULT_FP_VIZ, ...viz });
  const prevLenRef = useRef(0);
  const themeRev = useThemeRevision();
  dataRef.current = data;
  vizRef.current = { ...DEFAULT_FP_VIZ, ...viz };

  const draw = () => {
    const canvas = canvasRef.current;
    const series = seriesRef.current;
    const chart = chartRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !series || !chart || !wrap) return;
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    if (w < 8 || h < 8) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const cw = Math.floor(w * dpr);
    const ch = Math.floor(h * dpr);
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const snap = dataRef.current;
    if (!snap.bars.length) return;
    const bandTop = fpBandTop(h, true, false);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, w - 68, bandTop);
    ctx.clip();
    drawFootprintOnChart(ctx, chart, series, snap, vizRef.current, w, h, w - 68, readTheme(), undefined, bandTop);
    ctx.restore();
    drawVolumeBarStats(ctx, chart, snap, snap.bars, w - 68, h, readTheme(), undefined, true);
  };

  useEffect(() => {
    if (!containerRef.current) return;
    const theme = readTheme();
    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: Math.max(containerRef.current.clientHeight || 480, 240),
      layout: {
        background: { type: ColorType.Solid, color: theme.chartBg },
        textColor: theme.muted,
        fontFamily: theme.font,
        fontSize: 11,
      },
      grid: {
        vertLines: { color: theme.grid, style: LineStyle.Dotted },
        horzLines: { color: theme.grid, style: LineStyle.Dotted },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: hexAlpha(theme.sense, 0.45),
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: theme.bgElevated,
        },
        horzLine: {
          color: hexAlpha(theme.sense, 0.45),
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: theme.bgElevated,
        },
      },
      rightPriceScale: {
        borderVisible: false,
        scaleMargins: { top: 0.04, bottom: FP_STATS_FRAC },
        entireTextOnly: true,
      },
      leftPriceScale: { visible: false },
      timeScale: {
        borderVisible: false,
        timeVisible: true,
        secondsVisible: data.interval === "1m",
        rightOffset: 4,
        barSpacing: 28,
        minBarSpacing: 8,
        lockVisibleTimeRangeOnResize: true,
      },
      localization: { locale: "cs-CZ" },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: true,
      },
      handleScale: {
        axisPressedMouseMove: true,
        mouseWheel: true,
        pinch: true,
        axisDoubleClickReset: true,
      },
    });
    const candle = chart.addCandlestickSeries({
      upColor: "rgba(0,0,0,0)",
      downColor: "rgba(0,0,0,0)",
      borderVisible: false,
      wickVisible: vizRef.current.wicks,
      wickUpColor: hexAlpha(theme.up, 0.55),
      wickDownColor: hexAlpha(theme.down, 0.55),
      priceLineVisible: false,
      lastValueVisible: true,
    });
    chartRef.current = chart;
    seriesRef.current = candle;
    chart.timeScale().subscribeVisibleLogicalRangeChange(() => draw());
    const onResize = () => {
      if (!containerRef.current || !chartRef.current) return;
      chartRef.current.applyOptions({
        width: containerRef.current.clientWidth,
        height: containerRef.current.clientHeight,
      });
      draw();
    };
    const ro = new ResizeObserver(onResize);
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [themeRev, data.interval]);

  useEffect(() => {
    const series = seriesRef.current;
    const chart = chartRef.current;
    if (!series || !chart) return;
    const unique = data.bars
      .filter((b) => b.open && b.high && b.low && b.close)
      .map((b) => ({
        time: toUnix(b.ts),
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
      }))
      .sort((a, b) => Number(a.time) - Number(b.time));
    const seen = new Set<number>();
    const bars = unique.filter((d) => {
      const t = Number(d.time);
      if (seen.has(t)) return false;
      seen.add(t);
      return true;
    });
    if (!bars.length) return;
    const len = bars.length;
    if (prevLenRef.current && len === prevLenRef.current) {
      series.update(bars[bars.length - 1]);
    } else {
      series.setData(bars);
      if (!prevLenRef.current) chart.timeScale().fitContent();
    }
    prevLenRef.current = len;
    draw();
  }, [data]);

  useEffect(() => {
    const series = seriesRef.current;
    if (series) {
      const theme = readTheme();
      const on = vizRef.current.wicks;
      series.applyOptions({
        wickVisible: on,
        wickUpColor: on ? hexAlpha(theme.up, 0.55) : "rgba(0,0,0,0)",
        wickDownColor: on ? hexAlpha(theme.down, 0.55) : "rgba(0,0,0,0)",
      });
    }
    const id = requestAnimationFrame(() => draw());
    return () => cancelAnimationFrame(id);
  }, [viz]);

  if (!data.bars.length) {
    return (
      <div className="price-chart price-chart--fill muted p-6 text-sm">
        Žádná footprint data za zvolené období. Pokud běží sběr tradů, první sloupce se objeví za chvíli.
      </div>
    );
  }

  return (
    <div ref={wrapRef} className="price-chart price-chart--fill">
      <div ref={containerRef} className="price-chart__canvas" />
      <canvas ref={canvasRef} className="price-chart__heat is-on" aria-hidden />
    </div>
  );
}
