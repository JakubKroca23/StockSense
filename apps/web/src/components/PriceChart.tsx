"use client";

import { useEffect, useRef, useState, type MutableRefObject } from "react";
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
import { ChartDrawOverlay } from "@/components/ChartDrawOverlay";
import { applyIndicator, type ChartDrawing, type DrawTool, type OhlcvBar } from "@/lib/chart";

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
  footprint: boolean;
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
  footprint: false,
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
  /** Bottom volume histogram. */
  showVolume?: boolean;
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

function priceBottom(volume: boolean, rsi: boolean): number {
  return (volume ? 0.18 : 0.06) + (rsi ? 0.16 : 0);
}

function volumeMargins(volume: boolean): { top: number; bottom: number } {
  return volume ? { top: 0.84, bottom: 0 } : { top: 1, bottom: 0 };
}

function candleLook(
  theme: Theme,
  viz: ChartVizSettings,
) {
  const hide = viz.style === "line";
  const hollow = viz.style === "hollow";
  return {
    upColor: hide || hollow ? "rgba(0,0,0,0)" : theme.up,
    downColor: hide || hollow ? "rgba(0,0,0,0)" : theme.down,
    borderUpColor: hide ? "rgba(0,0,0,0)" : theme.up,
    borderDownColor: hide ? "rgba(0,0,0,0)" : theme.down,
    wickUpColor: theme.up,
    wickDownColor: theme.down,
    wickVisible: !hide && viz.wicks,
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
  showVolume = true,
  chartViz,
  drawTool = "none",
  drawings = [],
  onDrawingsChange,
  chartApiRef,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
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
  const fill = height == null;
  const themeRev = useThemeRevision();
  const [chartTick, setChartTick] = useState(0);

  const viz: ChartVizSettings = {
    ...DEFAULT_CHART_VIZ,
    sma20: showMa,
    sma50: showMa,
    ...chartViz,
    volume: showVolume,
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
        scaleMargins: { top: 0.06, bottom: priceBottom(viz.volume, false) },
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
    const look = candleLook(theme, viz);
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
      scaleMargins: volumeMargins(viz.volume),
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
    });
    if (wrapRef.current) ro.observe(wrapRef.current);
    ro.observe(containerRef.current);

    return () => {
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
          bottom: priceBottom(viz.volume, viz.rsi),
        },
      },
    });
    series.applyOptions(candleLook(theme, viz));
    volumeRef.current?.applyOptions({ visible: viz.volume });
    chart.priceScale("volume").applyOptions({
      scaleMargins: volumeMargins(viz.volume),
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
  ]);

  useEffect(() => {
    chartRef.current?.timeScale().applyOptions({
      barSpacing: viz.barSpacing,
      minBarSpacing: 3,
    });
  }, [viz.barSpacing]);

  useEffect(() => {
    chartRef.current?.timeScale().applyOptions({
      fixRightEdge: false,
    });
  }, [viz.rightOffset]);

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

      if (!prev) {
        const ts = chartRef.current.timeScale();
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
        <ChartDrawOverlay
          chart={chartTick ? chartRef.current : null}
          series={chartTick ? seriesRef.current : null}
          wrap={mainRef.current}
          tool={drawTool}
          drawings={drawings}
          onChange={onDrawingsChange || (() => undefined)}
        />
      </div>
    </div>
  );
}
