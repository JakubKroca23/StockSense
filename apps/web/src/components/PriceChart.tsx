"use client";

import { useEffect, useRef } from "react";
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

/** One order-book snapshot column for Bookmap-style heatmap overlay. */
export type HeatmapColumn = {
  ts: number;
  levels: { price: number; bid: number; ask: number }[];
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
  /** Bookmap-style liquidity heatmap columns (newest last). */
  heatmap?: HeatmapColumn[];
  showHeatmap?: boolean;
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
  heatmap = [],
  showHeatmap = false,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const heatRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const sma20Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const sma50Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const linesRef = useRef<IPriceLine[]>([]);
  const themeRef = useRef<Theme | null>(null);
  const prevSigRef = useRef<string>("");
  const heatmapRef = useRef<HeatmapColumn[]>(heatmap);
  const showHeatRef = useRef(showHeatmap);
  const fill = height == null;

  heatmapRef.current = heatmap;
  showHeatRef.current = showHeatmap;

  const drawHeatmap = () => {
    const canvas = heatRef.current;
    const series = seriesRef.current;
    const chart = chartRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !series || !chart || !wrap) return;

    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    if (!showHeatRef.current) return;
    const cols = heatmapRef.current;
    if (!cols.length) return;

    const theme = themeRef.current || readTheme();
    const colW = 5;
    const maxCols = Math.max(8, Math.min(cols.length, Math.floor((w * 0.42) / colW)));
    const visible = cols.slice(-maxCols);
    let maxSize = 0;
    for (const col of visible) {
      for (const lvl of col.levels) {
        maxSize = Math.max(maxSize, lvl.bid, lvl.ask);
      }
    }
    if (maxSize <= 0) return;

    const rightPad = 8;
    visible.forEach((col, i) => {
      const x = w - rightPad - (visible.length - i) * colW;
      for (const lvl of col.levels) {
        const y = series.priceToCoordinate(lvl.price);
        if (y == null) continue;
        const bidA = Math.min(0.72, (lvl.bid / maxSize) * 0.72);
        const askA = Math.min(0.72, (lvl.ask / maxSize) * 0.72);
        const cellH = Math.max(2, Math.min(8, h * 0.012));
        if (bidA > 0.04) {
          ctx.fillStyle = hexAlpha(theme.up, bidA);
          ctx.fillRect(x, y - cellH / 2, colW - 1, cellH);
        }
        if (askA > 0.04) {
          ctx.fillStyle = hexAlpha(theme.down, askA);
          ctx.fillRect(x, y - cellH / 2, colW - 1, cellH);
        }
      }
    });
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
        rightOffset: showHeatmap ? 18 : 6,
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
  }, [height, fill, secondsVisible, showHeatmap]);

  useEffect(() => {
    drawHeatmap();
  }, [heatmap, showHeatmap, bars]);

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
    </div>
  );
}
