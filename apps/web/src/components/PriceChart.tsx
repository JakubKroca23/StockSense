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

/** Live order-book liquidity level for heatmap overlay (no history). */
export type HeatmapLevel = {
  price: number;
  bid: number;
  ask: number;
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
  const heatLevelsRef = useRef<HeatmapLevel[]>(heatmapLevels);
  const showHeatRef = useRef(showHeatmap);
  const heatOpacityRef = useRef(heatOpacity);
  const fill = height == null;

  heatLevelsRef.current = heatmapLevels;
  showHeatRef.current = showHeatmap;
  heatOpacityRef.current = Math.min(1, Math.max(0.1, heatOpacity));

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

    if (!showHeatRef.current) return;
    const raw = heatLevelsRef.current;
    if (!raw.length) return;

    const theme = themeRef.current || readTheme();
    const opacityMul = heatOpacityRef.current;
    const isNarrow =
      w < 720 ||
      (typeof window !== "undefined" && window.matchMedia("(max-width: 1099px)").matches);
    // Keep clear of right price labels
    const leftPad = 2;
    const rightPad = isNarrow ? 54 : 68;
    const plotW = Math.max(48, w - leftPad - rightPad);
    // Wide volume-profile lane (liquidity must read clearly)
    const profileW = isNarrow
      ? Math.max(88, Math.min(plotW * 0.42, 170))
      : Math.max(120, Math.min(plotW * 0.48, 240));
    const profileRight = leftPad + plotW;
    const profileLeft = profileRight - profileW;

    type Side = { price: number; size: number; side: "bid" | "ask" };
    const sides: Side[] = [];
    for (const lvl of raw) {
      if (lvl.bid > 0) sides.push({ price: lvl.price, size: lvl.bid, side: "bid" });
      if (lvl.ask > 0) sides.push({ price: lvl.price, size: lvl.ask, side: "ask" });
    }
    if (!sides.length) return;

    const sizes = sides.map((s) => s.size).sort((a, b) => a - b);
    const pct = (p: number) =>
      sizes[Math.min(sizes.length - 1, Math.floor(sizes.length * p))] || sizes[sizes.length - 1];
    const maxSize = sizes[sizes.length - 1];
    const noiseFloor = Math.max(pct(0.4) * 0.7, maxSize * 0.015);
    const lineCut = pct(0.72);
    const wallCut = pct(0.88);
    const srCut = pct(0.96);
    const visible = sides.filter((s) => s.size >= noiseFloor);
    if (!visible.length) return;

    const topP = series.coordinateToPrice(0);
    const botP = series.coordinateToPrice(h);
    const priceToY = (price: number): number | null => {
      const y = series.priceToCoordinate(price);
      if (y != null) return y;
      if (topP == null || botP == null || topP === botP) return null;
      return ((topP - price) / (topP - botP)) * h;
    };

    // Coarser bins → merge nearby book levels into readable profile rows
    const targetRows = isNarrow ? 40 : 55;
    const rowH = Math.max(3.4, Math.min(9.5, h / targetRows));
    type Bucket = { y: number; bid: number; ask: number; price: number };
    const buckets = new Map<number, Bucket>();
    for (const s of visible) {
      const y = priceToY(s.price);
      if (y == null || y < -8 || y > h + 8) continue;
      const key = Math.round(y / rowH);
      const cur = buckets.get(key) || {
        y: key * rowH,
        bid: 0,
        ask: 0,
        price: s.price,
      };
      if (s.side === "bid") cur.bid += s.size;
      else cur.ask += s.size;
      const sideMax = Math.max(cur.bid, cur.ask);
      if (s.size >= sideMax * 0.55) cur.price = s.price;
      buckets.set(key, cur);
    }

    // Absorb weak neighbor bins into stronger adjacent liquidity
    const sortedKeys = [...buckets.keys()].sort((a, b) => a - b);
    const merged = new Map<number, Bucket>();
    for (const key of sortedKeys) {
      const cur = buckets.get(key)!;
      const total = cur.bid + cur.ask;
      const prev = merged.get(key - 1);
      const prevTotal = prev ? prev.bid + prev.ask : 0;
      if (prev && total < prevTotal * 0.28) {
        prev.bid += cur.bid;
        prev.ask += cur.ask;
        if (total >= Math.max(prev.bid, prev.ask) * 0.35) prev.price = cur.price;
        continue;
      }
      merged.set(key, { ...cur });
    }

    const rows = [...merged.values()];
    if (!rows.length) return;

    let peak = 0;
    for (const r of rows) peak = Math.max(peak, r.bid, r.ask);
    if (peak <= 0) return;

    const strength = (size: number) => Math.pow(size / peak, 0.55);
    const widthOf = (size: number) => {
      const t = strength(size);
      return Math.max(4, profileW * (0.1 + t * 0.9));
    };
    // Line thickness across candles scales with order size
    const lineThickness = (size: number) => {
      const t = strength(size);
      return 0.45 + t * t * (isNarrow ? 5.2 : 6.5);
    };
    const lineAlpha = (size: number) => {
      const t = strength(size);
      return Math.min(0.92, (0.12 + t * 0.72) * opacityMul);
    };

    // Soft lane backdrop
    ctx.fillStyle = hexAlpha(theme.muted, 0.07 * opacityMul);
    ctx.fillRect(profileLeft, 0, profileW, h);
    ctx.strokeStyle = hexAlpha(theme.muted, 0.16 * opacityMul);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(profileLeft + 0.5, 0);
    ctx.lineTo(profileLeft + 0.5, h);
    ctx.stroke();

    // Draw weaker full-chart guides first, then strong walls on top
    const bySize = [...rows].sort(
      (a, b) => Math.max(a.bid, a.ask) - Math.max(b.bid, b.ask)
    );

    for (const r of bySize) {
      const y = r.y;
      if (y < -6 || y > h + 6) continue;
      const wallSize = Math.max(r.bid, r.ask);
      if (wallSize < lineCut) continue;
      const color = r.bid >= r.ask ? theme.up : theme.down;
      const th = lineThickness(wallSize);
      const a = lineAlpha(wallSize);
      // Full span across candles + into profile tip
      ctx.fillStyle = hexAlpha(color, a * (wallSize >= srCut ? 1 : wallSize >= wallCut ? 0.85 : 0.55));
      ctx.fillRect(leftPad, y - th / 2, Math.max(0, profileRight - leftPad), th);
    }

    // Profile bars on top of guides
    for (const r of rows) {
      const y = r.y;
      if (y < -4 || y > h + 4) continue;
      const barH = Math.max(2.2, rowH * 0.82);

      const paint = (size: number, color: string) => {
        if (size < noiseFloor) return;
        const bw = widthOf(size);
        const isWall = size >= wallCut;
        const isSr = size >= srCut;
        const aBase = 0.28 + strength(size) * 0.58;
        const a = Math.min(0.94, aBase * opacityMul * (isSr ? 1.12 : isWall ? 1.05 : 1));
        ctx.fillStyle = hexAlpha(color, a);
        ctx.fillRect(profileRight - bw, y - barH / 2, bw, barH);

        if (isWall) {
          const tipH = Math.max(1.1, Math.min(barH, 2 + strength(size) * 3));
          ctx.fillStyle = hexAlpha(color, Math.min(0.96, (isSr ? 0.9 : 0.62) * opacityMul));
          ctx.fillRect(profileRight - bw, y - tipH / 2, Math.min(5, bw), tipH);
        }
      };

      if (r.bid > 0) paint(r.bid, theme.up);
      if (r.ask > 0) paint(r.ask, theme.down);
    }
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
  }, [height, fill, secondsVisible]);

  useEffect(() => {
    chartRef.current?.timeScale().applyOptions({
      rightOffset: showHeatmap ? 14 : 8,
    });
    drawHeatmap();
  }, [showHeatmap]);

  useEffect(() => {
    const id = requestAnimationFrame(() => drawHeatmap());
    return () => cancelAnimationFrame(id);
  }, [heatmapLevels, showHeatmap, heatOpacity, bars]);

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
