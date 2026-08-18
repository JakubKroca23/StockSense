"use client";

import { useEffect, useRef, useState, type MutableRefObject, type PointerEvent as ReactPointerEvent } from "react";
import {
  ColorType,
  CrosshairMode,
  IChartApi,
  IPriceLine,
  ISeriesApi,
  CandlestickData,
  LineStyle,
  PriceScaleMode,
  Time,
  createChart,
} from "lightweight-charts";
import { useThemeRevision } from "@/lib/theme";
import {
  analyzeLiquidity,
  applyCumulativeDepth,
  inferTick,
  snapAutoGroup,
  rememberBook,
  DEFAULT_HEAT_VIZ,
  type HeatmapLevel,
  type HeatVizSettings,
  type LiqZone,
  type BookMem,
  type TapePrint,
} from "@/lib/liquidity";
import { ChartDrawOverlay } from "@/components/ChartDrawOverlay";
import { applyIndicator, type ChartDrawing, type DrawTool, type OhlcvBar } from "@/lib/chart";
import {
  drawFootprintOnChart,
  drawVolumeBarStats,
  fpBandTop,
  fpOverlayBottom,
  fpVolumeMargins,
  fmtV,
  DEFAULT_FP_VIZ,
  type FootprintData,
  type FpVizSettings,
} from "@/components/FootprintChart";
import type { SessionProfile } from "@/lib/orderflow";

export type { HeatmapLevel, HeatVizSettings };
export { DEFAULT_HEAT_VIZ };

export type ChartStyle = "candle" | "hollow" | "line";
export type ChartCrosshair = "normal" | "magnet" | "off";

export type ChartVizSettings = {
  style: ChartStyle;
  grid: boolean;
  sma20: boolean;
  sma50: boolean;
  ema20: boolean;
  rsi: boolean;
  volume: boolean;
  priceLine: boolean;
  lastValue: boolean;
  wicks: boolean;
  logScale: boolean;
  crosshair: ChartCrosshair;
  barSpacing: number;
  rightOffset: number;
};

export const DEFAULT_CHART_VIZ: ChartVizSettings = {
  style: "candle",
  grid: true,
  sma20: true,
  sma50: true,
  ema20: false,
  rsi: false,
  volume: true,
  priceLine: true,
  lastValue: true,
  wicks: true,
  logScale: false,
  crosshair: "normal",
  barSpacing: 9,
  rightOffset: 0,
};

export const DEFAULT_DESK_CHART_VIZ: ChartVizSettings = {
  ...DEFAULT_CHART_VIZ,
  sma20: false,
  sma50: false,
  volume: true,
};

export type ChartBar = {
  ts: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  data_quality?: string;
};

export type ChartLevel = {
  price: number;
  title: string;
  color?: string;
  style?: "solid" | "dashed" | "dotted";
};

/** @deprecated use HeatmapLevel[] — kept for type aliases */
export type HeatmapColumn = {
  ts: number;
  levels: HeatmapLevel[];
};

type Props = {
  bars: ChartBar[];
  /** Fixed px height, or omit to fill parent (`.price-chart--fill`). */
  height?: number;
  levels?: ChartLevel[];
  className?: string;
  /** Overlay SMA20 / SMA50 on candles. */
  showMa?: boolean;
  /** Incremental updates (live WS) — avoid fitContent thrash. */
  realtime?: boolean;
  /** Show seconds on time axis (1s / 1m charts). */
  secondsVisible?: boolean;
  /** Current L2 liquidity levels (live snapshot, no scroll history). */
  heatmapLevels?: HeatmapLevel[];
  showHeatmap?: boolean;
  /** Global heatmap opacity 0–1 (default 0.55). */
  heatOpacity?: number;
  heatViz?: Partial<HeatVizSettings>;
  /** Instrument tick — groups L2 into price buckets. */
  tick?: number;
  /** Price decimals for S/R tags and the DOM ladder. */
  priceDigits?: number;
  /** Session volume-at-price for the DOM vol column. */
  session?: SessionProfile | null;
  /** Drag the profile divider — fraction of plot width. */
  onProfileWidthChange?: (frac: number) => void;
  /** Bottom volume histogram. Desk hides it in favor of footprint cells. */
  showVolume?: boolean;
  /** Overlay buy/sell cells on candle bodies. */
  showFootprint?: boolean;
  footprintData?: FootprintData | null;
  fpViz?: Partial<FpVizSettings>;
  /** Live tape prints — iceberg detection uses last ~12s of aggression into rest. */
  tapePrints?: TapePrint[] | null;
  chartViz?: Partial<ChartVizSettings>;
  drawTool?: DrawTool;
  drawings?: ChartDrawing[];
  onDrawingsChange?: (next: ChartDrawing[]) => void;
  chartApiRef?: MutableRefObject<PriceChartHandle | null>;
};

export type PriceChartHandle = {
  chart: () => IChartApi | null;
  series: () => ISeriesApi<"Candlestick"> | null;
};

type Theme = {
  text: string;
  muted: string;
  line: string;
  sense: string;
  up: string;
  upDim: string;
  down: string;
  downDim: string;
  grid: string;
  cross: string;
  maFast: string;
  maSlow: string;
  bgSoft: string;
  bgElevated: string;
  chartBg: string;
  font: string;
};

function readTheme(): Theme {
  const s = getComputedStyle(document.documentElement);
  const g = (name: string, fallback: string) => s.getPropertyValue(name).trim() || fallback;
  return {
    text: g("--text", "#e8eefc"),
    muted: g("--muted", "#93a0b8"),
    line: g("--line", "#243049"),
    sense: g("--sense", "#5dde8a"),
    up: g("--chart-up", "#5dde8a"),
    upDim: g("--chart-up-dim", "#3a9f62"),
    down: g("--chart-down", "#e05a8a"),
    downDim: g("--chart-down-dim", "#a83d68"),
    grid: g("--chart-grid", "rgba(158,182,255,0.08)"),
    cross: g("--chart-cross", "#5dde8a"),
    maFast: g("--chart-ma-fast", "#7eb6ff"),
    maSlow: g("--chart-ma-slow", "#e0b35a"),
    bgSoft: g("--bg-soft", "#182238"),
    bgElevated: g("--bg-elevated", "#121a2b"),
    chartBg: g("--chart-bg", "#060a12"),
    font: g("--font-body", '"IBM Plex Sans", sans-serif'),
  };
}

/** Last candle sits fully left of the native price scale. */
const LIVE_RIGHT_PAD = 0.42;

function stickLiveToPriceScale(chart: IChartApi, lastIndex: number) {
  const ts = chart.timeScale();
  const spacing = Math.max(1, ts.options().barSpacing || 9);
  const width = Math.max(spacing * 8, ts.width());
  const visible = width / spacing;
  const rangeTo = lastIndex + LIVE_RIGHT_PAD;
  ts.setVisibleLogicalRange({ from: rangeTo - visible, to: rangeTo });
}

function lookingAtFuture(rangeTo: number, lastIndex: number) {
  return rangeTo > lastIndex + LIVE_RIGHT_PAD + 1;
}

function sizeCanvas(canvas: HTMLCanvasElement, w: number, h: number) {
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
  if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

function hexAlpha(hex: string, alpha: number): string {
  const raw = hex.replace("#", "").trim();
  if (raw.length !== 6) {
    // already rgba / color-mix — fall back to solid
    return hex;
  }
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

function toCandle(b: ChartBar): CandlestickData {
  return {
    time: toUnix(b.ts),
    open: b.open,
    high: b.high,
    low: b.low,
    close: b.close,
  };
}

function candleLook(
  theme: Theme,
  viz: ChartVizSettings,
  fp: boolean,
  fpWicks: boolean
) {
  const hide = viz.style === "line";
  const hollow = viz.style === "hollow" || fp;
  return {
    upColor: hide || hollow ? "rgba(0,0,0,0)" : theme.up,
    downColor: hide || hollow ? "rgba(0,0,0,0)" : theme.down,
    borderUpColor: hide ? "rgba(0,0,0,0)" : theme.up,
    borderDownColor: hide ? "rgba(0,0,0,0)" : theme.down,
    wickUpColor: theme.up,
    wickDownColor: theme.down,
    wickVisible: !hide && viz.wicks && !fp,
    borderVisible: !hide,
    priceLineVisible: viz.priceLine,
    lastValueVisible: viz.lastValue,
    priceLineColor: hexAlpha(theme.sense, 0.55),
    priceLineWidth: 1 as const,
    priceLineStyle: LineStyle.Dashed,
  };
}

export function PriceChart({
  bars,
  height,
  levels = [],
  className,
  showMa = true,
  realtime = false,
  secondsVisible = false,
  heatmapLevels = [],
  showHeatmap = false,
  heatOpacity = 0.55,
  heatViz,
  tick,
  priceDigits = 2,
  session = null,
  onProfileWidthChange,
  showVolume = true,
  showFootprint = false,
  footprintData = null,
  fpViz,
  tapePrints = null,
  chartViz,
  drawTool = "none",
  drawings = [],
  onDrawingsChange,
  chartApiRef,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const heatRef = useRef<HTMLCanvasElement>(null);
  const domRef = useRef<HTMLCanvasElement>(null);
  const splitRef = useRef<HTMLDivElement>(null);
  const profileGeomRef = useRef({ left: 0, plotW: 120, frac: 0.26, domW: 160 });
  const sessionRef = useRef<SessionProfile | null>(session);
  const onWidthRef = useRef(onProfileWidthChange);
  onWidthRef.current = onProfileWidthChange;
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const sma20Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const sma50Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const ema20Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const rsiRef = useRef<ISeriesApi<"Line"> | null>(null);
  const closeLineRef = useRef<ISeriesApi<"Line"> | null>(null);
  const linesRef = useRef<IPriceLine[]>([]);
  const themeRef = useRef<Theme | null>(null);
  const prevSigRef = useRef<string>("");
  const heatLevelsRef = useRef<HeatmapLevel[]>(heatmapLevels);
  const showHeatRef = useRef(showHeatmap);
  const heatOpacityRef = useRef(heatOpacity);
  const heatVizRef = useRef<HeatVizSettings>({ ...DEFAULT_HEAT_VIZ, ...heatViz });
  const heatTickRef = useRef(tick ?? 0);
  const lastCloseRef = useRef(0);
  const showFpRef = useRef(showFootprint);
  const fpDataRef = useRef<FootprintData | null>(footprintData);
  const tapeRef = useRef<TapePrint[] | null>(tapePrints);
  const fpVizRef = useRef<FpVizSettings>({ ...DEFAULT_FP_VIZ, ...fpViz });
  const volOnRef = useRef(false);
  const barsRef = useRef(bars);
  const lastIdxRef = useRef(0);
  const realtimeRef = useRef(realtime);
  const drawRef = useRef<() => void>(() => undefined);
  const heatFnRef = useRef<() => void>(() => undefined);
  const drawRafRef = useRef(0);
  const fpLayerRef = useRef<HTMLCanvasElement | null>(null);
  const fpLayerKeyRef = useRef("");
  const bookMemRef = useRef<BookMem>(new Map());
  const bookSrcRef = useRef<HeatmapLevel[] | null>(null);
  const fill = height == null;
  const themeRev = useThemeRevision();
  const [chartTick, setChartTick] = useState(0);

  heatLevelsRef.current = heatmapLevels;
  showHeatRef.current = showHeatmap;
  heatOpacityRef.current = Math.min(1, Math.max(0.1, heatOpacity));
  heatVizRef.current = { ...DEFAULT_HEAT_VIZ, ...heatViz };
  heatTickRef.current = tick ?? 0;
  lastCloseRef.current = bars.length ? bars[bars.length - 1].close : 0;
  showFpRef.current = showFootprint;
  fpDataRef.current = footprintData;
  tapeRef.current = tapePrints;
  fpVizRef.current = { ...DEFAULT_FP_VIZ, ...fpViz };
  sessionRef.current = session;
  lastIdxRef.current = Math.max(0, bars.length - 1);
  realtimeRef.current = realtime;
  barsRef.current = bars;
  const viz: ChartVizSettings = {
    ...DEFAULT_CHART_VIZ,
    sma20: showMa,
    sma50: showMa,
    ...chartViz,
    volume: showVolume,
  };
  volOnRef.current = viz.volume;

  const drawHeatmap = () => {
    try {
    const canvas = heatRef.current;
    const series = seriesRef.current;
    const chart = chartRef.current;
    const wrap = wrapRef.current;
    const main = mainRef.current;
    if (!canvas || !series || !chart || !wrap || !main) return;

    const mainW = main.clientWidth;
    const h = main.clientHeight;
    if (mainW < 8 || h < 8) return;

    const ctx = sizeCanvas(canvas, mainW, h);
    if (!ctx) return;
    ctx.clearRect(0, 0, mainW, h);

    const hideSplit = () => {
      if (splitRef.current) splitRef.current.style.visibility = "hidden";
      if (domRef.current) {
        domRef.current.classList.remove("is-on");
        const dctx = sizeCanvas(domRef.current, 1, h);
        dctx?.clearRect(0, 0, 1, h);
      }
    };

    const theme = themeRef.current || readTheme();
    const viz = heatVizRef.current;
    const raw = heatLevelsRef.current;
    const showHeat = showHeatRef.current && raw.length > 0;
    const showDom = false;
    const wrapW = wrap.clientWidth;
    const profileFrac = Math.min(0.52, Math.max(0.16, viz.profileWidth));
    const profileW = showHeat && showDom
      ? Math.max(128, Math.min(wrapW * profileFrac, wrapW * 0.54))
      : 0;
    const plotW = Math.max(32, chart.timeScale().width() || mainW - 56);

    if (showHeat && showDom && splitRef.current && domRef.current) {
      profileGeomRef.current = { left: plotW, plotW, frac: profileFrac, domW: profileW };
      splitRef.current.style.visibility = "visible";
      domRef.current.classList.add("is-on");
      domRef.current.style.width = `${profileW}px`;
      domRef.current.style.flexBasis = `${profileW}px`;
    } else {
      hideSplit();
    }

    const alignTimes = barsRef.current
      .map((b) => Number(toUnix(b.ts)))
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => a - b);

    const paintFootprint = () => {
      if (!showFpRef.current) return;
      const fpSnap = fpDataRef.current;
      if (!fpSnap?.bars?.length) return;
      const range = chart.timeScale().getVisibleLogicalRange();
      const last = fpSnap.bars[fpSnap.bars.length - 1];
      const v = fpVizRef.current;
      const key = [
        canvas.width,
        canvas.height,
        plotW,
        range?.from ?? "",
        range?.to ?? "",
        fpSnap.interval,
        fpSnap.tick,
        fpSnap.bars.length,
        last?.ts,
        last?.volume,
        last?.delta,
        last?.close,
        JSON.stringify(v),
      ].join("|");
      let layer = fpLayerRef.current;
      if (!layer) {
        layer = document.createElement("canvas");
        fpLayerRef.current = layer;
      }
      if (
        fpLayerKeyRef.current !== key ||
        layer.width !== canvas.width ||
        layer.height !== canvas.height
      ) {
        layer.width = canvas.width;
        layer.height = canvas.height;
        const lctx = layer.getContext("2d");
        if (!lctx) return;
        const dpr = Math.min(window.devicePixelRatio || 1, 3);
        lctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        lctx.clearRect(0, 0, mainW, h);
        lctx.save();
        const bandTop = fpBandTop(h, true, volOnRef.current);
        lctx.beginPath();
        lctx.rect(0, 0, plotW, bandTop);
        lctx.clip();
        try {
          drawFootprintOnChart(
            lctx,
            chart,
            series,
            fpSnap,
            v,
            mainW,
            h,
            plotW,
            theme,
            alignTimes,
            bandTop
          );
        } catch {
          /* keep book / volume */
        }
        lctx.restore();
        fpLayerKeyRef.current = key;
      }
      ctx.drawImage(layer, 0, 0, mainW, h);
    };

    const paintVolumeStats = () => {
      if (!volOnRef.current && !showFpRef.current) return;
      try {
        drawVolumeBarStats(
          ctx,
          chart,
          fpDataRef.current,
          barsRef.current,
          plotW,
          h,
          theme,
          alignTimes,
          showFpRef.current
        );
      } catch {
        /* keep book */
      }
    };

    if (!showHeat) {
      paintFootprint();
      paintVolumeStats();
      return;
    }

    const opacityMul = heatOpacityRef.current;
    const lastPx = lastCloseRef.current;
    const tickSize = Math.max(1e-9, heatTickRef.current || inferTick(raw));

    const topP = series.coordinateToPrice(0);
    const botP = series.coordinateToPrice(h);
    const priceToY = (price: number): number | null => {
      const y = series.priceToCoordinate(price);
      if (y != null) return y;
      if (topP == null || botP == null || topP === botP) return null;
      return ((topP - price) / (topP - botP)) * h;
    };

    const sess = sessionRef.current;
    const volMap = new Map((sess?.rows || []).map((r) => [r.price, r.totalVolume]));
    const snap = analyzeLiquidity({
      levels: raw,
      viz,
      tick: tickSize,
      lastClose: lastPx,
      sessionVol: volMap,
      bookMem: bookMemRef.current,
      tape: tapeRef.current,
      fpBars: fpDataRef.current?.bars,
    });
    if (!snap) {
      paintFootprint();
      paintVolumeStats();
      return;
    }

    const {
      rows: visible,
      nearS,
      nearR,
      vacuums,
      srCut,
      peakShow,
      peakRest,
      step,
      mid,
      last,
    } = snap;
    if (bookSrcRef.current !== raw) {
      bookMemRef.current = rememberBook(bookMemRef.current, visible);
      bookSrcRef.current = raw;
    }
    const gamma = Math.min(1.55, Math.max(0.32, viz.gamma));
    const punch = (size: number) => Math.pow(Math.min(1, size / peakRest), gamma);
    const volOf = (price: number, step: number) => {
      const exact = volMap.get(price);
      if (exact) return exact;
      let acc = 0;
      for (const [p, v] of volMap) {
        if (Math.abs(p - price) < step / 2) acc += v;
      }
      return acc;
    };
    const hasVol = volMap.size > 0;
    const volColW = hasVol ? Math.max(28, profileW * 0.22) : 0;
    const bookW = Math.max(36, profileW - volColW);
    const halfBook = bookW / 2;
    const bidLeft = 0;
    const askLeft = halfBook;
    const volLeft = bookW;
    let barPeak = Math.max(peakShow, 1e-9);
    const widthOf = (size: number, maxW: number) => {
      const t = Math.pow(Math.min(1, size / barPeak), gamma);
      return Math.max(1.5, maxW * t);
    };

    const leftPad = 0;
    const profileLeft = plotW;

    const yBand = (zlo: number, zhi: number, pad = 0): { y: number; h: number } | null => {
      const yHi = priceToY(zhi + pad);
      const yLo = priceToY(zlo - pad);
      if (yHi == null || yLo == null) return null;
      const y = Math.min(yHi, yLo);
      return { y, h: Math.max(1.5, Math.abs(yLo - yHi)) };
    };

    const candleW = Math.max(0, profileLeft - leftPad);

    if (viz.vacuums) {
      for (const v of vacuums) {
        const box = yBand(v.lo, v.hi, step * 0.1);
        if (!box || candleW < 8) continue;
        const col = v.up ? theme.up : theme.down;
        ctx.save();
        ctx.beginPath();
        ctx.rect(leftPad, box.y, candleW, box.h);
        ctx.clip();
        ctx.fillStyle = hexAlpha(col, 0.055 * opacityMul);
        ctx.fillRect(leftPad, box.y, candleW, box.h);
        ctx.strokeStyle = hexAlpha(col, 0.14 * opacityMul);
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let x = leftPad - box.h; x < leftPad + candleW; x += 10) {
          ctx.moveTo(x, box.y + box.h);
          ctx.lineTo(x + box.h, box.y);
        }
        ctx.stroke();
        ctx.restore();
        ctx.strokeStyle = hexAlpha(col, 0.28 * opacityMul);
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 4]);
        ctx.beginPath();
        ctx.moveTo(leftPad, box.y + 0.5);
        ctx.lineTo(profileLeft, box.y + 0.5);
        ctx.moveTo(leftPad, box.y + box.h + 0.5);
        ctx.lineTo(profileLeft, box.y + box.h + 0.5);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    const paintNear = (z: LiqZone | null) => {
      if (!z) return;
      const color = z.support ? theme.up : theme.down;
      const pad = z.magnet ? 0 : step * 0.45;
      const box = yBand(z.lo, z.hi, pad);
      const pocY = priceToY(z.poc);
      if (z.magnet) {
        if (pocY == null) return;
        ctx.strokeStyle = hexAlpha(color, 0.78 * opacityMul);
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(leftPad, pocY + 0.5);
        ctx.lineTo(profileLeft, pocY + 0.5);
        ctx.stroke();
        ctx.fillStyle = hexAlpha(color, 0.92 * opacityMul);
        ctx.beginPath();
        ctx.moveTo(profileLeft - 1, pocY);
        ctx.lineTo(profileLeft - 9, pocY - 5);
        ctx.lineTo(profileLeft - 9, pocY + 5);
        ctx.closePath();
        ctx.fill();
      } else if (box) {
        ctx.fillStyle = hexAlpha(color, 0.16 * opacityMul);
        ctx.fillRect(leftPad, box.y, candleW, box.h);
        ctx.strokeStyle = hexAlpha(color, 0.42 * opacityMul);
        ctx.lineWidth = 1;
        ctx.strokeRect(leftPad + 0.5, box.y + 0.5, Math.max(0, candleW - 1), Math.max(1, box.h - 1));
        if (pocY != null) {
          ctx.strokeStyle = hexAlpha(color, 0.7 * opacityMul);
          ctx.lineWidth = 1.15;
          ctx.setLineDash([5, 3]);
          ctx.beginPath();
          ctx.moveTo(leftPad, pocY + 0.5);
          ctx.lineTo(profileLeft, pocY + 0.5);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
    };
    if (viz.zones) {
      paintNear(nearS);
      paintNear(nearR);
    }

    const yStep = priceToY(snap.mid + step);
    const yMid = priceToY(snap.mid);
    const pxPerStep = yMid != null && yStep != null ? Math.abs(yStep - yMid) : 2;
    const visGroup = snapAutoGroup(pxPerStep);
    let drawRows = visible;
    let drawStep = step;
    if (visGroup > 1) {
      const merged = new Map<number, (typeof visible)[number]>();
      const qStep = step * visGroup;
      for (const r of visible) {
        const p = Number((Math.round(r.price / qStep) * qStep).toFixed(10));
        const cur = merged.get(p);
        if (!cur) {
          merged.set(p, { ...r, price: p });
        } else {
          cur.bid += r.bid;
          cur.ask += r.ask;
          cur.showBid = Math.max(cur.showBid, r.showBid);
          cur.showAsk = Math.max(cur.showAsk, r.showAsk);
          cur.rest = Math.max(cur.rest, r.rest);
          cur.sessionVol = (cur.sessionVol || 0) + (r.sessionVol || 0);
          cur.implied = Math.max(cur.implied || 0, r.implied || 0);
          cur.prevRest = Math.max(cur.prevRest || 0, r.prevRest || 0);
          cur.score = Math.max(cur.score || 0, r.score || 0);
          if (r.flag === "spoof" || cur.flag === "spoof") cur.flag = "spoof";
          else if (r.flag === "iceberg" || cur.flag === "iceberg") cur.flag = "iceberg";
          else if (r.flag === "wall" || cur.flag === "wall") cur.flag = "wall";
        }
      }
      drawRows = [...merged.values()];
      drawStep = qStep;
    }
    if (viz.cumulative) {
      applyCumulativeDepth(drawRows, mid, drawStep);
      let viewPeak = 0;
      for (const r of drawRows) {
        const y = priceToY(r.price);
        if (y == null || y < -10 || y > h + 10) continue;
        viewPeak = Math.max(viewPeak, r.showBid, r.showAsk);
      }
      if (viewPeak > 0) barPeak = viewPeak;
    }

    const byRest = [...drawRows].sort((a, b) => a.rest - b.rest);
    let peakVol = 0.0001;
    if (hasVol) {
      for (const r of drawRows) peakVol = Math.max(peakVol, volOf(r.price, drawStep));
    }

    const iceCol = "#6ec8ff";
    const spoofCol = "#e0b35a";
    const hatch = (
      c: CanvasRenderingContext2D,
      x: number,
      y: number,
      w: number,
      hh: number,
      col: string
    ) => {
      if (w < 2 || hh < 2) return;
      c.save();
      c.beginPath();
      c.rect(x, y, w, hh);
      c.clip();
      c.strokeStyle = col;
      c.lineWidth = 1;
      const stepH = 3.4;
      for (let i = -hh; i < w + hh; i += stepH) {
        c.beginPath();
        c.moveTo(x + i, y + hh);
        c.lineTo(x + i + hh, y);
        c.stroke();
      }
      c.restore();
    };

    const paintLiqOnChart = () => {
      if (candleW < 24 || !drawRows.length) return;
      ctx.save();
      ctx.beginPath();
      ctx.rect(leftPad, 0, candleW, h);
      ctx.clip();
      const heatW = Math.min(168, candleW * 0.28);
      const heatX = leftPad + candleW - heatW;
      const fade = ctx.createLinearGradient(heatX, 0, leftPad + candleW, 0);
      fade.addColorStop(0, "rgba(0,0,0,0)");
      fade.addColorStop(0.22, "rgba(0,0,0,0)");
      fade.addColorStop(1, "rgba(4,8,16,0.38)");
      ctx.fillStyle = fade;
      ctx.fillRect(heatX, 0, heatW, h);

      const nearDist = tickSize * (12 + Math.min(1, Math.max(0, viz.reach || 1)) * 48);
      const farDist = nearDist * 2.6;
      const midPx = lastPx > 0 ? lastPx : snap.mid;

      for (const r of byRest) {
        const yHi = priceToY(r.price + drawStep / 2);
        const yLo = priceToY(r.price - drawStep / 2);
        if (yHi == null || yLo == null) continue;
        const top = Math.min(yHi, yLo);
        let hh = Math.abs(yLo - yHi);
        if (hh < 1.2) hh = 1.2;
        const dist = Math.abs(r.price - midPx);
        if (dist > farDist) continue;
        const prox = Math.max(0, 1 - dist / farDist);
        const nearBoost = dist <= nearDist ? 1 : 0.45;
        const mag = Math.min(1, r.rest / peakRest);
        const w = Math.max(8, mag * prox * nearBoost * heatW * 0.96);
        const x = leftPad + candleW - w;
        const a = (0.1 + mag * prox * 0.48) * opacityMul * nearBoost;
        ctx.fillStyle = r.bid >= r.ask ? hexAlpha(theme.up, a) : hexAlpha(theme.down, a);
        ctx.fillRect(x, top, w, hh);
        if (mag > 0.55 && prox > 0.4) {
          ctx.fillStyle = r.bid >= r.ask ? hexAlpha(theme.up, 0.55 * opacityMul) : hexAlpha(theme.down, 0.55 * opacityMul);
          ctx.fillRect(leftPad + candleW - 3, top, 3, hh);
        }
      }

      let peakIce = peakRest;
      for (const r of drawRows) {
        if (r.flag !== "iceberg") continue;
        peakIce = Math.max(peakIce, r.rest + (r.implied || 0));
      }
      const iceMaxW = Math.min(candleW * 0.58, 340);

      for (const r of drawRows) {
        if (!r.flag) continue;
        const yHi = priceToY(r.price + drawStep / 2);
        const yLo = priceToY(r.price - drawStep / 2);
        if (yHi == null || yLo == null) continue;
        const top = Math.min(yHi, yLo);
        let hh = Math.abs(yLo - yHi);
        if (hh < 1.8) hh = 1.8;
        const conf = Math.max(0.4, r.score || 0.5);
        if (r.flag === "iceberg") {
          const hidden = Math.max(0, r.implied || 0);
          const iceSize = r.rest + hidden;
          const t = Math.pow(Math.min(1, iceSize / Math.max(peakIce, 1e-9)), gamma);
          const totW = Math.max(16, t * iceMaxW);
          const visW = Math.max(6, totW * (r.rest / Math.max(iceSize, 1e-9)));
          const xTot = leftPad + candleW - totW;
          const xVis = leftPad + candleW - visW;
          hatch(ctx, xTot, top, totW, hh, hexAlpha(iceCol, (0.38 + conf * 0.32) * opacityMul));
          ctx.fillStyle = hexAlpha(iceCol, (0.16 + conf * 0.14) * opacityMul);
          ctx.fillRect(xTot, top, totW, hh);
          ctx.fillStyle = hexAlpha(iceCol, (0.42 + conf * 0.38) * opacityMul);
          ctx.fillRect(xVis, top, visW, hh);
          ctx.fillStyle = hexAlpha(iceCol, 0.95 * opacityMul);
          ctx.fillRect(leftPad + candleW - 4, top, 4, hh);
          ctx.strokeStyle = hexAlpha(iceCol, (0.55 + conf * 0.35) * opacityMul);
          ctx.lineWidth = 1;
          ctx.strokeRect(xTot + 0.5, top + 0.5, Math.max(2, totW - 1), Math.max(1, hh - 1));
          if (hh >= 10 && totW >= 28) {
            ctx.fillStyle = iceCol;
            ctx.font = `700 9px ${theme.font}`;
            ctx.textAlign = "left";
            ctx.textBaseline = "middle";
            ctx.fillText("ICE", xTot + 4, top + hh / 2);
          }
        } else if (r.flag === "wall") {
          const col = r.bid >= r.ask ? theme.up : theme.down;
          ctx.fillStyle = hexAlpha(col, (0.07 + conf * 0.12) * opacityMul);
          ctx.fillRect(leftPad + candleW * 0.38, top, candleW * 0.62, hh);
          ctx.fillStyle = hexAlpha(col, (0.62 + conf * 0.32) * opacityMul);
          ctx.fillRect(leftPad + candleW - 5, top, 5, hh);
          if (hh >= 11) {
            ctx.fillStyle = hexAlpha(col, 0.95);
            ctx.font = `700 9px ${theme.font}`;
            ctx.textAlign = "right";
            ctx.textBaseline = "middle";
            ctx.fillText("WALL", leftPad + candleW - 9, top + hh / 2);
          }
        } else if (r.flag === "spoof") {
          ctx.strokeStyle = hexAlpha(spoofCol, (0.4 + conf * 0.4) * opacityMul);
          ctx.lineWidth = 1.2;
          ctx.setLineDash([4, 3]);
          ctx.beginPath();
          ctx.moveTo(leftPad + candleW * 0.52, top + hh / 2);
          ctx.lineTo(leftPad + candleW, top + hh / 2);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = hexAlpha(spoofCol, (0.5 + conf * 0.35) * opacityMul);
          ctx.fillRect(leftPad + candleW - 4, top, 4, hh);
          if (hh >= 11) {
            ctx.fillStyle = spoofCol;
            ctx.font = `700 9px ${theme.font}`;
            ctx.textAlign = "right";
            ctx.textBaseline = "middle";
            ctx.fillText("SPF", leftPad + candleW - 8, top + hh / 2);
          }
        }
      }
      ctx.restore();
    };

    const dctx = showDom && domRef.current ? sizeCanvas(domRef.current, profileW, h) : null;
    if (dctx) {
      dctx.clearRect(0, 0, profileW, h);
      dctx.fillStyle = theme.chartBg;
      dctx.fillRect(0, 0, profileW, h);
      dctx.fillStyle = hexAlpha(theme.up, 0.05);
      dctx.fillRect(0, 0, halfBook, h);
      dctx.fillStyle = hexAlpha(theme.down, 0.05);
      dctx.fillRect(askLeft, 0, halfBook, h);
      if (hasVol) {
        dctx.fillStyle = hexAlpha(theme.sense, 0.04);
        dctx.fillRect(volLeft, 0, volColW, h);
      }
      dctx.strokeStyle = "#000";
      dctx.lineWidth = 1;
      dctx.beginPath();
      dctx.moveTo(0.5, 0);
      dctx.lineTo(0.5, h);
      dctx.stroke();
      dctx.strokeStyle = hexAlpha(theme.line, 0.55);
      dctx.beginPath();
      dctx.moveTo(askLeft + 0.5, 0);
      dctx.lineTo(askLeft + 0.5, h);
      if (hasVol) {
        dctx.moveTo(volLeft + 0.5, 0);
        dctx.lineTo(volLeft + 0.5, h);
      }
      dctx.stroke();

      if (Number.isFinite(snap.bestBid) && Number.isFinite(snap.bestAsk) && snap.bestAsk > snap.bestBid) {
        const yAsk = priceToY(snap.bestAsk);
        const yBid = priceToY(snap.bestBid);
        if (yAsk != null && yBid != null) {
          const y0 = Math.min(yAsk, yBid);
          dctx.fillStyle = hexAlpha(theme.sense, 0.14 * opacityMul);
          dctx.fillRect(0, y0, profileW, Math.max(1, Math.abs(yBid - yAsk)));
        }
      }

      dctx.font = `650 10px ${theme.font}`;
      dctx.textBaseline = "middle";
      for (const r of byRest) {
        const y = priceToY(r.price);
        const yNext = priceToY(r.price + drawStep);
        if (y == null) continue;
        if (y < -10 || y > h + 10) continue;
        const bandH = Math.max(1.4, yNext != null ? Math.abs(yNext - y) * 0.9 : 3);
        const t = punch(r.rest);
        const flag = r.flag;
        const y0 = y - bandH / 2;
        const bh = Math.max(1.2, bandH * 0.86);
        const paintSide = (size: number, col: string, x0: number, alignRight: boolean) => {
          if (size <= 0 && flag !== "spoof") return;
          const bw = widthOf(Math.max(size, 0), halfBook - 4);
          const colRight = x0 + halfBook;
          const barX = (w: number) => (alignRight ? colRight - 1 - w : x0 + 1);
          const cum = viz.cumulative;
          if (flag === "spoof" && !cum) {
            const ghost = widthOf(Math.max(r.prevRest, size, 0.0001), halfBook - 4);
            const gx = barX(ghost);
            hatch(dctx, gx, y0, ghost, bh, hexAlpha(spoofCol, 0.45 * opacityMul));
            dctx.strokeStyle = hexAlpha(spoofCol, 0.9 * opacityMul);
            dctx.lineWidth = 1;
            dctx.setLineDash([2.5, 2]);
            dctx.strokeRect(gx + 0.5, y0 + 0.5, Math.max(2, ghost - 1), Math.max(1, bh - 1));
            dctx.setLineDash([]);
            if (size > 0) {
              dctx.fillStyle = hexAlpha(col, 0.45 * opacityMul);
              dctx.fillRect(barX(bw), y0, bw, bh);
            }
            return;
          }
          if (flag === "iceberg" && !cum) {
            const extra = widthOf(size + Math.max(r.implied, size * 0.8), halfBook - 4);
            const ex = barX(extra);
            hatch(dctx, ex, y0, extra, bh, hexAlpha(iceCol, 0.5 * opacityMul));
            dctx.fillStyle = hexAlpha(col, (0.55 + t * 0.4) * opacityMul);
            dctx.fillRect(barX(bw), y0, bw, bh);
            dctx.strokeStyle = hexAlpha(iceCol, 0.95 * opacityMul);
            dctx.lineWidth = 1.35;
            dctx.strokeRect(ex + 0.5, y0 + 0.5, Math.max(2, extra - 1), Math.max(1, bh - 1));
            dctx.fillStyle = iceCol;
            const tip = alignRight ? ex - 5 : ex + extra + 5;
            const back = alignRight ? ex - 9 : ex + extra + 9;
            dctx.beginPath();
            dctx.moveTo(tip, y);
            dctx.lineTo(back, y - 3.2);
            dctx.lineTo(back, y + 3.2);
            dctx.closePath();
            dctx.fill();
            return;
          }
          if (flag === "spoof") {
            hatch(dctx, barX(bw), y0, bw, bh, hexAlpha(spoofCol, 0.4 * opacityMul));
            dctx.strokeStyle = hexAlpha(spoofCol, 0.9 * opacityMul);
            dctx.lineWidth = 1;
            dctx.setLineDash([2.5, 2]);
            dctx.strokeRect(barX(bw) + 0.5, y0 + 0.5, Math.max(2, bw - 1), Math.max(1, bh - 1));
            dctx.setLineDash([]);
            dctx.fillStyle = hexAlpha(col, 0.4 * opacityMul);
            dctx.fillRect(barX(bw), y0, bw, bh);
            return;
          }
          if (flag === "iceberg") {
            const x = barX(bw);
            hatch(dctx, x, y0, bw, bh, hexAlpha(iceCol, 0.45 * opacityMul));
            dctx.fillStyle = hexAlpha(col, (0.5 + t * 0.4) * opacityMul);
            dctx.fillRect(x, y0, bw, bh);
            dctx.strokeStyle = hexAlpha(iceCol, 0.95 * opacityMul);
            dctx.lineWidth = 1.2;
            dctx.strokeRect(x + 0.5, y0 + 0.5, Math.max(2, bw - 1), Math.max(1, bh - 1));
            return;
          }
          if (flag === "wall" || r.rest >= srCut) {
            const x = barX(bw);
            dctx.fillStyle = hexAlpha(col, 0.18 * opacityMul);
            dctx.fillRect(alignRight ? x - 4 : x, y0 - 1, bw + 5, bh + 2);
            dctx.fillStyle = hexAlpha(col, Math.min(0.96, 0.35 + t * 0.6) * opacityMul);
            dctx.fillRect(x, y0, bw, bh);
            dctx.fillStyle = hexAlpha(col, 1);
            dctx.fillRect(alignRight ? x + bw - 2.2 : x, y0, 2.2, bh);
            return;
          }
          dctx.fillStyle = hexAlpha(col, (0.2 + t * 0.68) * opacityMul);
          dctx.fillRect(barX(Math.max(2.4, bw)), y0, Math.max(2.4, bw), bh);
        };
        if (r.bid > 0 || (flag && r.bid >= r.ask)) paintSide(r.showBid, theme.up, bidLeft, true);
        if (r.ask > 0 || (flag && r.ask > r.bid)) paintSide(r.showAsk, theme.down, askLeft, false);
        if (hasVol) {
          const v = r.sessionVol || volOf(r.price, drawStep);
          if (v > 0) {
            const bw = Math.max(1.5, (volColW - 3) * Math.pow(v / peakVol, gamma));
            const volCol = flag === "iceberg" ? iceCol : theme.sense;
            dctx.fillStyle = hexAlpha(volCol, 0.22 + 0.58 * (v / peakVol));
            dctx.fillRect(volLeft + 1, y0, bw, bh);
          }
        }
        if (bandH >= 9 && halfBook >= 26) {
          const bidLab = viz.cumulative ? r.showBid : r.bid;
          const askLab = viz.cumulative ? r.showAsk : r.ask;
          if (bidLab > 0) {
            dctx.textAlign = "right";
            dctx.fillStyle = hexAlpha(theme.up, 0.95);
            dctx.fillText(fmtV(bidLab), askLeft - 3, y);
          }
          if (askLab > 0) {
            dctx.textAlign = "left";
            dctx.fillStyle = hexAlpha(theme.down, 0.95);
            dctx.fillText(fmtV(askLab), askLeft + 3, y);
          }
        }
        if (bandH >= 9 && hasVol && volColW >= 24) {
          const v = r.sessionVol || volOf(r.price, drawStep);
          if (v > 0) {
            dctx.textAlign = "left";
            dctx.fillStyle = hexAlpha(flag === "iceberg" ? iceCol : theme.muted, 0.95);
            dctx.fillText(fmtV(v), volLeft + 3, y);
          }
        }
      }

      const lastY = last > 0 ? priceToY(last) : priceToY(mid);
      if (lastY != null && lastY >= 0 && lastY <= h) {
        dctx.strokeStyle = hexAlpha(theme.sense, 0.8 * opacityMul);
        dctx.lineWidth = 1.2;
        dctx.beginPath();
        dctx.moveTo(0, lastY + 0.5);
        dctx.lineTo(profileW, lastY + 0.5);
        dctx.stroke();
      }

      const headH = 22;
      dctx.fillStyle = hexAlpha(theme.bgElevated, 0.96);
      dctx.fillRect(0, 0, profileW, headH);
      dctx.fillStyle = hexAlpha(theme.muted, 0.9);
      dctx.font = `750 8px ${theme.font}`;
      dctx.textBaseline = "middle";
      dctx.textAlign = "left";
      dctx.textAlign = "right";
      dctx.fillText(viz.cumulative ? "Bid Σ" : "Bid", askLeft - 4, 7);
      dctx.textAlign = "left";
      dctx.fillText(viz.cumulative ? "Ask Σ" : "Ask", askLeft + 4, 7);
      if (hasVol) dctx.fillText("Vol", volLeft + 3, 7);
      dctx.font = `700 7px ${theme.font}`;
      let lx = 4;
      const chips: { lab: string; col: string }[] = [
        { lab: "ICE", col: iceCol },
        { lab: "WALL", col: theme.up },
        { lab: "SPOOF", col: spoofCol },
      ];
      for (const ch of chips) {
        dctx.fillStyle = ch.col;
        dctx.fillRect(lx, 15, 5, 5);
        dctx.fillStyle = hexAlpha(theme.muted, 0.95);
        dctx.fillText(ch.lab, lx + 7, 17);
        lx += 8 + dctx.measureText(ch.lab).width + 8;
      }
    }

    paintFootprint();
    paintLiqOnChart();
    paintVolumeStats();
    } catch {
      /* overlay must not kill the chart */
    }
  };
  heatFnRef.current = drawHeatmap;
  drawRef.current = () => {
    if (drawRafRef.current) return;
    drawRafRef.current = requestAnimationFrame(() => {
      drawRafRef.current = 0;
      heatFnRef.current();
    });
  };

  const onProfileSplitDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startFrac = profileGeomRef.current.frac;
    const wrapW = Math.max(48, wrapRef.current?.clientWidth || 400);
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const onMove = (ev: PointerEvent) => {
      const next = Math.min(0.52, Math.max(0.16, startFrac + (startX - ev.clientX) / wrapW));
      profileGeomRef.current.frac = next;
      onWidthRef.current?.(next);
    };
    const onUp = () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
  };

  useEffect(() => {
    if (!containerRef.current) return;

    const theme = readTheme();
    themeRef.current = theme;

    const initialH = fill
      ? Math.max(containerRef.current.clientHeight || 480, 240)
      : height;

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: initialH,
      layout: {
        background: { type: ColorType.Solid, color: theme.chartBg },
        textColor: theme.muted,
        fontFamily: theme.font,
        fontSize: 11,
      },
      grid: {
        vertLines: {
          visible: viz.grid,
          color: theme.grid,
          style: LineStyle.Dotted,
        },
        horzLines: {
          visible: viz.grid,
          color: theme.grid,
          style: LineStyle.Dotted,
        },
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
          labelVisible: true,
          labelBackgroundColor: theme.bgElevated,
        },
      },
      rightPriceScale: {
        visible: true,
        borderVisible: false,
        scaleMargins: { top: 0.06, bottom: fpOverlayBottom(showFootprint, viz.volume) },
        entireTextOnly: true,
        mode: viz.logScale ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal,
      },
      leftPriceScale: { visible: false },
      timeScale: {
        borderVisible: false,
        timeVisible: true,
        secondsVisible,
        rightOffset: LIVE_RIGHT_PAD,
        barSpacing: viz.barSpacing,
        minBarSpacing: 3,
        fixLeftEdge: false,
        fixRightEdge: false,
        shiftVisibleRangeOnNewBar: true,
        lockVisibleTimeRangeOnResize: true,
      },
      localization: {
        locale: "cs-CZ",
      },
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

    // Bull = Sense green, bear = red-purple
    const look = candleLook(theme, viz, showFootprint, fpViz?.wicks ?? true);
    const candle = chart.addCandlestickSeries({
      ...look,
      priceLineColor: hexAlpha(theme.sense, 0.55),
      priceLineWidth: 1,
      priceLineStyle: LineStyle.Dashed,
    });

    const volume = chart.addHistogramSeries({
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
      lastValueVisible: false,
      priceLineVisible: false,
      visible: viz.volume,
    });
    chart.priceScale("volume").applyOptions({
      scaleMargins: fpVolumeMargins(showFootprint, viz.volume),
      borderVisible: false,
    });

    const sma20 = chart.addLineSeries({
      color: hexAlpha(theme.maFast, 0.9),
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    const sma50 = chart.addLineSeries({
      color: hexAlpha(theme.maSlow, 0.75),
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    const ema20 = chart.addLineSeries({
      color: hexAlpha(theme.sense, 0.85),
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    const rsiLine = chart.addLineSeries({
      color: hexAlpha(theme.down, 0.9),
      lineWidth: 1,
      priceScaleId: "rsi",
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    chart.priceScale("rsi").applyOptions({
      scaleMargins: { top: 0.8, bottom: 0.02 },
      borderVisible: false,
    });

    const closeLine = chart.addLineSeries({
      color: hexAlpha(theme.sense, 0.95),
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: viz.style === "line" && viz.lastValue,
      crosshairMarkerVisible: viz.style === "line",
    });

    chartRef.current = chart;
    seriesRef.current = candle;
    volumeRef.current = volume;
    sma20Ref.current = sma20;
    sma50Ref.current = sma50;
    ema20Ref.current = ema20;
    rsiRef.current = rsiLine;
    closeLineRef.current = closeLine;
    if (chartApiRef) {
      chartApiRef.current = {
        chart: () => chartRef.current,
        series: () => seriesRef.current,
      };
    }
    setChartTick((n) => n + 1);
    prevSigRef.current = "";

    const ro = new ResizeObserver(() => {
      if (!containerRef.current || !chartRef.current) return;
      const w = containerRef.current.clientWidth;
      const h = fill
        ? Math.max(containerRef.current.clientHeight, 240)
        : height!;
      chartRef.current.applyOptions({ width: w, height: h });
      if (realtimeRef.current) {
        const ts = chartRef.current.timeScale();
        const range = ts.getVisibleLogicalRange();
        const last = lastIdxRef.current;
        if (!range || !lookingAtFuture(range.to, last)) {
          stickLiveToPriceScale(chartRef.current, last);
        }
      }
      drawRef.current();
    });
    if (wrapRef.current) ro.observe(wrapRef.current);
    ro.observe(containerRef.current);

    let clampLock = false;
    const clampPast = () => {
      if (clampLock) return;
      const ts = chart.timeScale();
      const range = ts.getVisibleLogicalRange();
      const last = lastIdxRef.current;
      const minTo = last + LIVE_RIGHT_PAD;
      if (!range || range.to >= minTo - 0.15) return;
      const span = Math.max(range.to - range.from, 8);
      clampLock = true;
      ts.setVisibleLogicalRange({ from: minTo - span, to: minTo });
      requestAnimationFrame(() => {
        clampLock = false;
      });
    };

    const onRange = () => {
      if (realtimeRef.current) clampPast();
      drawRef.current();
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(onRange);
    chart.timeScale().applyOptions({
      minBarSpacing: showFootprint ? 8 : 3,
    });

    return () => {
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRange);
      if (drawRafRef.current) {
        cancelAnimationFrame(drawRafRef.current);
        drawRafRef.current = 0;
      }
      fpLayerRef.current = null;
      fpLayerKeyRef.current = "";
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      volumeRef.current = null;
      sma20Ref.current = null;
      sma50Ref.current = null;
      ema20Ref.current = null;
      rsiRef.current = null;
      closeLineRef.current = null;
      if (chartApiRef) chartApiRef.current = null;
      setChartTick(0);
      linesRef.current = [];
      themeRef.current = null;
    };
  }, [height, fill, secondsVisible, themeRev]);

  useEffect(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!chart || !series) return;
    const theme = themeRef.current || readTheme();
    const gridCol = viz.grid ? theme.grid : "rgba(0,0,0,0)";
    chart.applyOptions({
      grid: {
        vertLines: { visible: viz.grid, color: gridCol, style: LineStyle.Dotted },
        horzLines: { visible: viz.grid, color: gridCol, style: LineStyle.Dotted },
      },
      crosshair: {
        mode: viz.crosshair === "magnet" ? CrosshairMode.Magnet : CrosshairMode.Normal,
        vertLine: {
          visible: viz.crosshair !== "off",
          color: hexAlpha(theme.sense, 0.45),
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: theme.bgElevated,
        },
        horzLine: {
          visible: viz.crosshair !== "off",
          labelVisible: viz.crosshair !== "off",
          color: hexAlpha(theme.sense, 0.45),
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: theme.bgElevated,
        },
      },
      rightPriceScale: {
        visible: true,
        mode: viz.logScale ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal,
        scaleMargins: {
          top: 0.06,
          bottom: fpOverlayBottom(showFootprint, viz.volume) + (viz.rsi ? 0.16 : 0),
        },
      },
    });
    series.applyOptions(candleLook(theme, viz, showFootprint, fpViz?.wicks ?? true));
    volumeRef.current?.applyOptions({ visible: viz.volume });
    chart.priceScale("volume").applyOptions({
      scaleMargins: fpVolumeMargins(showFootprint, viz.volume),
    });
    closeLineRef.current?.applyOptions({
      visible: viz.style === "line",
      lastValueVisible: viz.style === "line" && viz.lastValue,
      crosshairMarkerVisible: viz.style === "line",
    });
    rsiRef.current?.applyOptions({ visible: viz.rsi });
    chart.priceScale("rsi").applyOptions({
      scaleMargins: { top: viz.volume ? 0.74 : 0.8, bottom: 0.02 },
    });
    drawRef.current();
  }, [
    viz.style,
    viz.grid,
    viz.volume,
    viz.priceLine,
    viz.lastValue,
    viz.wicks,
    viz.logScale,
    viz.crosshair,
    viz.rsi,
    showFootprint,
    fpViz?.wicks,
    showHeatmap,
  ]);

  useEffect(() => {
    chartRef.current?.timeScale().applyOptions({
      barSpacing: viz.barSpacing,
      minBarSpacing: showFootprint ? 8 : 3,
    });
  }, [viz.barSpacing, showFootprint]);

  useEffect(() => {
    chartRef.current?.timeScale().applyOptions({
      fixRightEdge: false,
    });
    drawRef.current();
  }, [viz.rightOffset]);

  useEffect(() => {
    drawRef.current();
  });

  useEffect(() => {
    if (!seriesRef.current || !chartRef.current) return;
    if (!bars.length) {
      seriesRef.current.setData([]);
      volumeRef.current?.setData([]);
      sma20Ref.current?.setData([]);
      sma50Ref.current?.setData([]);
      ema20Ref.current?.setData([]);
      rsiRef.current?.setData([]);
      closeLineRef.current?.setData([]);
      prevSigRef.current = "";
      return;
    }

    const theme = themeRef.current || readTheme();

    const candleData: CandlestickData[] = bars
      .filter((b) => b.open != null && b.high != null && b.low != null && b.close != null)
      .map(toCandle)
      .sort((a, b) => Number(a.time) - Number(b.time));

    const seen = new Set<number>();
    const unique = candleData.filter((d) => {
      const t = Number(d.time);
      if (seen.has(t)) return false;
      seen.add(t);
      return true;
    });

    const last = bars[bars.length - 1];
    const histKey = `${unique.length}:${unique[0] ? Number(unique[0].time) : 0}:${
      unique.length > 1 ? Number(unique[unique.length - 2].time) : 0
    }:${viz.volume}:${viz.sma20}:${viz.sma50}:${viz.ema20}:${viz.rsi}:${viz.style}`;
    const lastSig = last
      ? `${toUnix(last.ts)}:${last.open}:${last.high}:${last.low}:${last.close}:${last.volume ?? 0}`
      : "";
    const prev = prevSigRef.current;
    const prevHist = prev.split("|")[0] || "";
    const canUpdate = Boolean(realtime && prev && prevHist === histKey && unique.length > 0);

    const volUp = hexAlpha(theme.up, 0.28);
    const volDown = hexAlpha(theme.down, 0.26);

    if (canUpdate) {
      const lastBar = unique[unique.length - 1];
      const isUp = lastBar.close >= lastBar.open;
      seriesRef.current.update(lastBar);
      if (viz.volume) {
        volumeRef.current?.update({
          time: lastBar.time,
          value: last?.volume ?? 0,
          color: isUp ? volUp : volDown,
        });
      }
      if (viz.style === "line") {
        closeLineRef.current?.update({ time: lastBar.time, value: lastBar.close });
      }
      const ohlcv: OhlcvBar[] = unique.map((c) => ({
        time: c.time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: 0,
      }));
      if (viz.sma20 && sma20Ref.current && unique.length >= 20) {
        const s20 = applyIndicator(ohlcv, "sma", { period: 20 });
        if (s20.length) sma20Ref.current.update(s20[s20.length - 1]);
      }
      if (viz.sma50 && sma50Ref.current && unique.length >= 50) {
        const s50 = applyIndicator(ohlcv, "sma", { period: 50 });
        if (s50.length) sma50Ref.current.update(s50[s50.length - 1]);
      }
      if (viz.ema20 && ema20Ref.current && unique.length >= 20) {
        const e20 = applyIndicator(ohlcv, "ema", { period: 20 });
        if (e20.length) ema20Ref.current.update(e20[e20.length - 1]);
      }
      if (viz.rsi && rsiRef.current && unique.length >= 16) {
        const r = applyIndicator(ohlcv, "rsi", { period: 14 });
        if (r.length) rsiRef.current.update(r[r.length - 1]);
      }
    } else {
      const volumeData = bars
        .map((b) => {
          const isUp = b.close >= b.open;
          return {
            time: toUnix(b.ts),
            value: b.volume ?? 0,
            color: isUp ? volUp : volDown,
          };
        })
        .filter((d) => seen.has(Number(d.time)))
        .sort((a, b) => Number(a.time) - Number(b.time));

      const vSeen = new Set<number>();
      const uniqueVol = volumeData.filter((d) => {
        const t = Number(d.time);
        if (vSeen.has(t)) return false;
        vSeen.add(t);
        return true;
      });

      seriesRef.current.setData(unique);
      if (viz.volume) volumeRef.current?.setData(uniqueVol);
      else volumeRef.current?.setData([]);

      const closes = unique.map((c) => ({ time: c.time, value: c.close }));
      if (viz.style === "line") closeLineRef.current?.setData(closes);
      else closeLineRef.current?.setData([]);

      const ohlcv: OhlcvBar[] = unique.map((c) => ({
        time: c.time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: 0,
      }));
      sma20Ref.current?.setData(viz.sma20 ? applyIndicator(ohlcv, "sma", { period: 20 }) : []);
      sma50Ref.current?.setData(viz.sma50 ? applyIndicator(ohlcv, "sma", { period: 50 }) : []);
      ema20Ref.current?.setData(viz.ema20 ? applyIndicator(ohlcv, "ema", { period: 20 }) : []);
      rsiRef.current?.setData(viz.rsi ? applyIndicator(ohlcv, "rsi", { period: 14 }) : []);

      if (!realtime || !prev) {
        const ts = chartRef.current.timeScale();
        ts.applyOptions({ rightOffset: LIVE_RIGHT_PAD, fixRightEdge: false });
        if (realtime) stickLiveToPriceScale(chartRef.current, unique.length - 1);
        else ts.fitContent();
      }
    }

    prevSigRef.current = `${histKey}|${lastSig}`;
  }, [bars, realtime, viz.volume, viz.sma20, viz.sma50, viz.ema20, viz.rsi, viz.style]);

  useEffect(() => {
    if (!seriesRef.current) return;

    for (const line of linesRef.current) {
      seriesRef.current.removePriceLine(line);
    }
    linesRef.current = [];

    const theme = themeRef.current || readTheme();
    const palette = [theme.sense, theme.maFast, theme.maSlow, theme.down];

    levels.forEach((lvl, i) => {
      if (!Number.isFinite(lvl.price) || lvl.price <= 0) return;
      const style =
        lvl.style === "dotted"
          ? LineStyle.Dotted
          : lvl.style === "solid"
            ? LineStyle.Solid
            : LineStyle.Dashed;
      const pl = seriesRef.current!.createPriceLine({
        price: lvl.price,
        color: lvl.color || palette[i % palette.length],
        lineWidth: 1,
        lineStyle: style,
        axisLabelVisible: true,
        title: lvl.title,
      });
      linesRef.current.push(pl);
    });
  }, [levels]);

  if (!bars.length) {
    return <p className="muted text-sm">Graf zatím nemá data.</p>;
  }

  return (
    <div
      ref={wrapRef}
      className={`price-chart${fill ? " price-chart--fill" : ""}${className ? ` ${className}` : ""}`}
    >
      <div ref={mainRef} className="price-chart__main">
        <div
          ref={containerRef}
          className="price-chart__canvas"
          style={fill ? undefined : { height }}
        />
        <canvas
          ref={heatRef}
          className={`price-chart__heat ${showHeatmap || showFootprint || viz.volume ? "is-on" : ""}`}
          aria-hidden
        />
        <ChartDrawOverlay
          chart={chartTick ? chartRef.current : null}
          series={chartTick ? seriesRef.current : null}
          wrap={mainRef.current}
          tool={drawTool}
          drawings={drawings}
          onChange={onDrawingsChange || (() => undefined)}
        />
      </div>
      <div
        ref={splitRef}
        className="price-chart__split"
        onPointerDown={onProfileSplitDown}
        title="Šířka profilu"
        role="separator"
        aria-orientation="vertical"
        aria-label="Šířka profilu likvidity"
      />
      <canvas
        ref={domRef}
        className="price-chart__dom"
        aria-hidden
      />
    </div>
  );
}
