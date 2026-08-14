"use client";

import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import {
  ColorType,
  CrosshairMode,
  IChartApi,
  IPriceLine,
  ISeriesApi,
  CandlestickData,
  LineStyle,
  Time,
  createChart,
} from "lightweight-charts";
import { useThemeRevision } from "@/lib/theme";
import {
  analyzeLiquidity,
  inferTick,
  snapAutoGroup,
  DEFAULT_HEAT_VIZ,
  type HeatmapLevel,
  type HeatVizSettings,
  type LiqZone,
} from "@/lib/liquidity";

export type { HeatmapLevel, HeatVizSettings };
export { DEFAULT_HEAT_VIZ };

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
  /** Price decimals for S/R tags. */
  priceDigits?: number;
  /** Drag the profile divider — fraction of plot width. */
  onProfileWidthChange?: (frac: number) => void;
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
  const d = new Date(ts);
  return Math.floor(d.getTime() / 1000) as Time;
}

function smaSeries(
  closes: { time: Time; value: number }[],
  period: number
): { time: Time; value: number }[] {
  const out: { time: Time; value: number }[] = [];
  let sum = 0;
  for (let i = 0; i < closes.length; i++) {
    sum += closes[i].value;
    if (i >= period) sum -= closes[i - period].value;
    if (i >= period - 1) {
      out.push({ time: closes[i].time, value: sum / period });
    }
  }
  return out;
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
  onProfileWidthChange,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const heatRef = useRef<HTMLCanvasElement>(null);
  const splitRef = useRef<HTMLDivElement>(null);
  const profileGeomRef = useRef({ left: 0, plotW: 120, frac: 0.26 });
  const onWidthRef = useRef(onProfileWidthChange);
  onWidthRef.current = onProfileWidthChange;
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const sma20Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const sma50Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const linesRef = useRef<IPriceLine[]>([]);
  const themeRef = useRef<Theme | null>(null);
  const prevSigRef = useRef<string>("");
  const heatLevelsRef = useRef<HeatmapLevel[]>(heatmapLevels);
  const showHeatRef = useRef(showHeatmap);
  const heatOpacityRef = useRef(heatOpacity);
  const heatVizRef = useRef<HeatVizSettings>({ ...DEFAULT_HEAT_VIZ, ...heatViz });
  const heatTickRef = useRef(tick ?? 0);
  const lastCloseRef = useRef(0);
  const fill = height == null;
  const themeRev = useThemeRevision();

  heatLevelsRef.current = heatmapLevels;
  showHeatRef.current = showHeatmap;
  heatOpacityRef.current = Math.min(1, Math.max(0.1, heatOpacity));
  heatVizRef.current = { ...DEFAULT_HEAT_VIZ, ...heatViz };
  heatTickRef.current = tick ?? 0;
  lastCloseRef.current = bars.length ? bars[bars.length - 1].close : 0;

  const drawHeatmap = () => {
    const canvas = heatRef.current;
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

    const hideSplit = () => {
      if (splitRef.current) splitRef.current.style.visibility = "hidden";
    };

    if (!showHeatRef.current) {
      hideSplit();
      return;
    }
    const raw = heatLevelsRef.current;
    if (!raw.length) {
      hideSplit();
      return;
    }

    const theme = themeRef.current || readTheme();
    const opacityMul = heatOpacityRef.current;
    const viz = heatVizRef.current;
    const isNarrow =
      w < 720 ||
      (typeof window !== "undefined" && window.matchMedia("(max-width: 1099px)").matches);
    const leftPad = 2;
    const rightPad = isNarrow ? 54 : 68;
    const plotW = Math.max(48, w - leftPad - rightPad);
    const profileFrac = Math.min(0.5, Math.max(0.12, viz.profileWidth));
    const profileW = isNarrow
      ? Math.max(44, Math.min(plotW * Math.min(profileFrac, 0.38), plotW * 0.42))
      : Math.max(56, Math.min(plotW * profileFrac, plotW * 0.5));
    const profileRight = leftPad + plotW;
    const profileLeft = profileRight - profileW;
    profileGeomRef.current = { left: profileLeft, plotW, frac: profileFrac };
    if (splitRef.current) {
      splitRef.current.style.left = `${profileLeft}px`;
      splitRef.current.style.visibility = "visible";
    }

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

    const snap = analyzeLiquidity({
      levels: raw,
      viz,
      tick: tickSize,
      lastClose: lastPx,
    });
    if (!snap) return;

    const {
      rows: visible,
      nearS,
      nearR,
      vacuums,
      wallCut,
      srCut,
      peakShow,
      peakRest,
      step,
      mid,
      last,
    } = snap;
    const gamma = Math.min(1.55, Math.max(0.32, viz.gamma));
    const punch = (size: number) => Math.pow(Math.min(1, size / peakRest), gamma);
    const widthOf = (size: number) => {
      const t = Math.pow(Math.min(1, size / peakShow), gamma);
      return Math.max(2.5, profileW * (0.04 + t * 0.96));
    };

    ctx.fillStyle = hexAlpha(theme.chartBg, 0.42 * opacityMul);
    ctx.fillRect(profileLeft, 0, profileW, h);
    ctx.fillStyle = hexAlpha(theme.muted, 0.04 * opacityMul);
    ctx.fillRect(profileLeft, 0, profileW, h);

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

    if (Number.isFinite(snap.bestBid) && Number.isFinite(snap.bestAsk) && snap.bestAsk > snap.bestBid) {
      const yAsk = priceToY(snap.bestAsk);
      const yBid = priceToY(snap.bestBid);
      if (yAsk != null && yBid != null) {
        const y0 = Math.min(yAsk, yBid);
        const zh = Math.max(1, Math.abs(yBid - yAsk));
        ctx.fillStyle = hexAlpha(theme.sense, 0.1 * opacityMul);
        ctx.fillRect(profileLeft, y0, profileW, zh);
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
        }
      }
      drawRows = [...merged.values()];
      drawStep = qStep;
    }

    const byRest = [...drawRows].sort((a, b) => a.rest - b.rest);
    for (const r of byRest) {
      const y = priceToY(r.price);
      const yNext = priceToY(r.price + drawStep);
      if (y == null) continue;
      if (y < -10 || y > h + 10) continue;
      const bandH = Math.max(1.2, yNext != null ? Math.abs(yNext - y) * 0.88 : 3);
      const t = punch(r.rest);
      const isWall = r.rest >= wallCut;
      const isSr = r.rest >= srCut;
      const paint = (size: number, col: string) => {
        if (size <= 0) return;
        const bw = widthOf(size);
        const a = Math.min(
          0.94,
          (0.1 + t * (isSr ? 0.82 : isWall ? 0.7 : 0.42)) * opacityMul
        );
        if (isWall) {
          ctx.fillStyle = hexAlpha(col, 0.12 * opacityMul);
          ctx.fillRect(profileRight - bw - 4, y - bandH * 0.62, bw + 6, bandH * 1.24);
        }
        ctx.fillStyle = hexAlpha(col, a);
        ctx.fillRect(profileRight - bw, y - bandH / 2, bw, Math.max(1.1, bandH * 0.84));
        if (isWall) {
          ctx.fillStyle = hexAlpha(col, Math.min(0.98, (0.5 + t * 0.45) * opacityMul));
          ctx.fillRect(
            profileRight - bw,
            y - Math.max(1, bandH * 0.2),
            Math.min(3.5, bw),
            Math.max(1, bandH * 0.4)
          );
        }
      };
      if (r.bid > 0) paint(r.showBid, theme.up);
      if (r.ask > 0) paint(r.showAsk, theme.down);
    }

    const lastY = last > 0 ? priceToY(last) : priceToY(mid);
    if (lastY != null && lastY >= 0 && lastY <= h) {
      ctx.strokeStyle = hexAlpha(theme.sense, 0.75 * opacityMul);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(profileLeft, lastY + 0.5);
      ctx.lineTo(profileRight, lastY + 0.5);
      ctx.stroke();
    }
  };

  const onProfileSplitDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startFrac = profileGeomRef.current.frac;
    const plotW = Math.max(48, profileGeomRef.current.plotW);
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const onMove = (ev: PointerEvent) => {
      const next = Math.min(0.5, Math.max(0.12, startFrac + (startX - ev.clientX) / plotW));
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
        scaleMargins: { top: 0.06, bottom: 0.2 },
        entireTextOnly: true,
      },
      leftPriceScale: { visible: false },
      timeScale: {
        borderVisible: false,
        timeVisible: true,
        secondsVisible,
        rightOffset: 8,
        barSpacing: 9,
        minBarSpacing: 3,
        fixLeftEdge: false,
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
    const candle = chart.addCandlestickSeries({
      upColor: theme.up,
      downColor: theme.down,
      borderUpColor: theme.up,
      borderDownColor: theme.down,
      wickUpColor: theme.up,
      wickDownColor: theme.down,
      borderVisible: true,
      priceLineVisible: true,
      priceLineColor: hexAlpha(theme.sense, 0.55),
      priceLineWidth: 1,
      priceLineStyle: LineStyle.Dashed,
      lastValueVisible: true,
    });

    const volume = chart.addHistogramSeries({
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
      lastValueVisible: false,
      priceLineVisible: false,
    });
    chart.priceScale("volume").applyOptions({
      scaleMargins: { top: 0.84, bottom: 0 },
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

    chartRef.current = chart;
    seriesRef.current = candle;
    volumeRef.current = volume;
    sma20Ref.current = sma20;
    sma50Ref.current = sma50;
    prevSigRef.current = "";

    const ro = new ResizeObserver((entries) => {
      if (!containerRef.current || !chartRef.current) return;
      const entry = entries[0];
      const w = entry?.contentRect.width ?? containerRef.current.clientWidth;
      const h = fill
        ? Math.max(entry?.contentRect.height ?? containerRef.current.clientHeight, 240)
        : height!;
      chartRef.current.applyOptions({ width: w, height: h });
      drawHeatmap();
    });
    ro.observe(containerRef.current);

    const onVisible = () => drawHeatmap();
    chart.timeScale().subscribeVisibleLogicalRangeChange(onVisible);
    chart.subscribeCrosshairMove(onVisible);

    return () => {
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(onVisible);
      chart.unsubscribeCrosshairMove(onVisible);
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      volumeRef.current = null;
      sma20Ref.current = null;
      sma50Ref.current = null;
      linesRef.current = [];
      themeRef.current = null;
    };
  }, [height, fill, secondsVisible, themeRev]);

  useEffect(() => {
    chartRef.current?.timeScale().applyOptions({
      rightOffset: showHeatmap ? 14 : 8,
    });
    drawHeatmap();
  }, [showHeatmap]);

  useEffect(() => {
    const id = requestAnimationFrame(() => drawHeatmap());
    return () => cancelAnimationFrame(id);
  }, [heatmapLevels, showHeatmap, heatOpacity, bars, heatViz, tick]);

  useEffect(() => {
    if (!seriesRef.current || !volumeRef.current || !chartRef.current) return;
    if (!bars.length) {
      seriesRef.current.setData([]);
      volumeRef.current.setData([]);
      sma20Ref.current?.setData([]);
      sma50Ref.current?.setData([]);
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
    }`;
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
      volumeRef.current.update({
        time: lastBar.time,
        value: last?.volume ?? 0,
        color: isUp ? volUp : volDown,
      });
      if (showMa && sma20Ref.current && sma50Ref.current && unique.length >= 20) {
        const closes = unique.map((c) => ({ time: c.time, value: c.close }));
        const s20 = smaSeries(closes, 20);
        const s50 = smaSeries(closes, 50);
        if (s20.length) sma20Ref.current.update(s20[s20.length - 1]);
        if (s50.length) sma50Ref.current.update(s50[s50.length - 1]);
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
      volumeRef.current.setData(uniqueVol);

      if (showMa && sma20Ref.current && sma50Ref.current) {
        const closes = unique.map((c) => ({ time: c.time, value: c.close }));
        sma20Ref.current.setData(smaSeries(closes, 20));
        sma50Ref.current.setData(smaSeries(closes, 50));
      } else {
        sma20Ref.current?.setData([]);
        sma50Ref.current?.setData([]);
      }

      if (!realtime || !prev) {
        chartRef.current.timeScale().fitContent();
      }
    }

    prevSigRef.current = `${histKey}|${lastSig}`;
  }, [bars, showMa, realtime]);

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
      <div
        ref={containerRef}
        className="price-chart__canvas"
        style={fill ? undefined : { height }}
      />
      <canvas
        ref={heatRef}
        className={`price-chart__heat ${showHeatmap ? "is-on" : ""}`}
        aria-hidden
      />
      <div
        ref={splitRef}
        className={`price-chart__split ${showHeatmap ? "is-on" : ""}`}
        onPointerDown={onProfileSplitDown}
        title="Šířka profilu"
        role="separator"
        aria-orientation="vertical"
        aria-label="Šířka profilu likvidity"
      />
    </div>
  );
}
