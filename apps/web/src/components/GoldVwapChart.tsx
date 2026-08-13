"use client";

import { useEffect, useRef } from "react";
import {
  ColorType,
  CrosshairMode,
  IChartApi,
  ISeriesApi,
  CandlestickData,
  LineStyle,
  Time,
  createChart,
} from "lightweight-charts";
import type { ChartBar } from "@/components/PriceChart";
import { useThemeRevision } from "@/lib/theme";

/** Flat band packing: t, vwap, u0618, l0618, u1618, l1618, u2618, l2618 */
export type MidasAnchor = {
  anchor_ts: string;
  anchor_unix: number;
  points: number;
  band: number[];
};

type Props = {
  bars: ChartBar[];
  anchors: MidasAnchor[];
  showMidas?: boolean;
  showOuterBands?: boolean;
  fillOpacity?: number;
  className?: string;
};

type Theme = {
  text: string;
  muted: string;
  sense: string;
  up: string;
  down: string;
  grid: string;
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
  return Math.floor(new Date(ts).getTime() / 1000) as Time;
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

export function GoldVwapChart({
  bars,
  anchors,
  showMidas = true,
  showOuterBands = true,
  fillOpacity = 0.03,
  className,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const themeRef = useRef<Theme | null>(null);
  const anchorsRef = useRef(anchors);
  const showRef = useRef(showMidas);
  const outerRef = useRef(showOuterBands);
  const fillRef = useRef(fillOpacity);
  const themeRev = useThemeRevision();

  useEffect(() => {
    anchorsRef.current = anchors;
    showRef.current = showMidas;
    outerRef.current = showOuterBands;
    fillRef.current = Math.min(0.12, Math.max(0.01, fillOpacity));
  }, [anchors, showMidas, showOuterBands, fillOpacity]);

  const drawMidas = () => {
    const canvas = overlayRef.current;
    const series = seriesRef.current;
    const chart = chartRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !series || !chart || !wrap) return;

    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    if (w < 8 || h < 8) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
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

    if (!showRef.current) return;
    const list = anchorsRef.current;
    if (!list.length) return;

    const timeScale = chart.timeScale();
    const fillA = fillRef.current;
    const drawOuter = outerRef.current;

    // Soft blue core (0.618) — additive stacking via low alpha
    ctx.fillStyle = `rgba(40, 90, 255, ${fillA})`;

    for (const anchor of list) {
      const band = anchor.band;
      const n = Math.floor(band.length / 8);
      if (n < 2) continue;

      // --- Fill 0.618 polygon ---
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < n; i++) {
        const t = band[i * 8] as Time;
        const u = band[i * 8 + 2];
        const x = timeScale.timeToCoordinate(t);
        const y = series.priceToCoordinate(u);
        if (x == null || y == null) continue;
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
      for (let i = n - 1; i >= 0; i--) {
        const t = band[i * 8] as Time;
        const l = band[i * 8 + 3];
        const x = timeScale.timeToCoordinate(t);
        const y = series.priceToCoordinate(l);
        if (x == null || y == null) continue;
        ctx.lineTo(x, y);
      }
      if (started) {
        ctx.closePath();
        ctx.fill();
      }

      if (!drawOuter) continue;

      // Upper 1.618 / 2.618 (green)
      for (const off of [4, 6]) {
        ctx.beginPath();
        ctx.strokeStyle = off === 4 ? "rgba(61, 206, 122, 0.35)" : "rgba(61, 206, 122, 0.22)";
        ctx.lineWidth = off === 4 ? 1 : 0.85;
        let pen = false;
        for (let i = 0; i < n; i++) {
          const t = band[i * 8] as Time;
          const px = band[i * 8 + off];
          const x = timeScale.timeToCoordinate(t);
          const y = series.priceToCoordinate(px);
          if (x == null || y == null) {
            pen = false;
            continue;
          }
          if (!pen) {
            ctx.moveTo(x, y);
            pen = true;
          } else {
            ctx.lineTo(x, y);
          }
        }
        ctx.stroke();
      }

      // Lower 1.618 / 2.618 (red)
      for (const off of [5, 7]) {
        ctx.beginPath();
        ctx.strokeStyle = off === 5 ? "rgba(224, 90, 138, 0.35)" : "rgba(224, 90, 138, 0.22)";
        ctx.lineWidth = off === 5 ? 1 : 0.85;
        let pen = false;
        for (let i = 0; i < n; i++) {
          const t = band[i * 8] as Time;
          const px = band[i * 8 + off];
          const x = timeScale.timeToCoordinate(t);
          const y = series.priceToCoordinate(px);
          if (x == null || y == null) {
            pen = false;
            continue;
          }
          if (!pen) {
            ctx.moveTo(x, y);
            pen = true;
          } else {
            ctx.lineTo(x, y);
          }
        }
        ctx.stroke();
      }
    }
  };

  useEffect(() => {
    if (!containerRef.current) return;
    const theme = readTheme();
    themeRef.current = theme;

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: Math.max(containerRef.current.clientHeight || 480, 280),
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
        scaleMargins: { top: 0.06, bottom: 0.18 },
        entireTextOnly: true,
      },
      leftPriceScale: { visible: false },
      timeScale: {
        borderVisible: false,
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 6,
        barSpacing: 4,
        minBarSpacing: 1.5,
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
      scaleMargins: { top: 0.86, bottom: 0 },
      borderVisible: false,
    });

    chartRef.current = chart;
    seriesRef.current = candle;
    volumeRef.current = volume;

    const ro = new ResizeObserver((entries) => {
      if (!containerRef.current || !chartRef.current) return;
      const entry = entries[0];
      const ww = entry?.contentRect.width ?? containerRef.current.clientWidth;
      const hh = Math.max(entry?.contentRect.height ?? containerRef.current.clientHeight, 280);
      chartRef.current.applyOptions({ width: ww, height: hh });
      drawMidas();
    });
    ro.observe(containerRef.current);

    const onVisible = () => drawMidas();
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
      themeRef.current = null;
    };
  }, [themeRev]);

  useEffect(() => {
    if (!seriesRef.current || !volumeRef.current || !chartRef.current) return;
    if (!bars.length) {
      seriesRef.current.setData([]);
      volumeRef.current.setData([]);
      return;
    }
    const theme = themeRef.current || readTheme();
    const candleData = bars
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

    const volUp = hexAlpha(theme.up, 0.28);
    const volDown = hexAlpha(theme.down, 0.26);
    const volumeData = bars
      .map((b) => ({
        time: toUnix(b.ts),
        value: b.volume ?? 0,
        color: b.close >= b.open ? volUp : volDown,
      }))
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
    chartRef.current.timeScale().fitContent();
    requestAnimationFrame(() => drawMidas());
  }, [bars]);

  useEffect(() => {
    const id = requestAnimationFrame(() => drawMidas());
    return () => cancelAnimationFrame(id);
  }, [anchors, showMidas, showOuterBands, fillOpacity]);

  if (!bars.length) {
    return <p className="muted text-sm">Graf zatím nemá data.</p>;
  }

  return (
    <div
      ref={wrapRef}
      className={`price-chart price-chart--fill gold-vwap-chart${className ? ` ${className}` : ""}`}
    >
      <div ref={containerRef} className="price-chart__canvas" />
      <canvas
        ref={overlayRef}
        className={`price-chart__heat ${showMidas ? "is-on" : ""}`}
        aria-hidden
      />
    </div>
  );
}
