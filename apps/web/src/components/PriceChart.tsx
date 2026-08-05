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

type Props = {
  bars: ChartBar[];
  /** Fixed px height, or omit to fill parent (`.price-chart--fill`). */
  height?: number;
  levels?: ChartLevel[];
  className?: string;
  /** Overlay SMA20 / SMA50 on candles. */
  showMa?: boolean;
};

function toUnix(ts: string): Time {
  const d = new Date(ts);
  return Math.floor(d.getTime() / 1000) as Time;
}

function hexAlpha(hex: string, alpha: number): string {
  const h = hex.replace("#", "").trim();
  if (h.length !== 6) return hex;
  const a = Math.round(Math.min(1, Math.max(0, alpha)) * 255)
    .toString(16)
    .padStart(2, "0");
  return `#${h}${a}`;
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

export function PriceChart({ bars, height, levels = [], className, showMa = true }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const sma20Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const sma50Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const linesRef = useRef<IPriceLine[]>([]);
  const fill = height == null;

  useEffect(() => {
    if (!containerRef.current) return;

    const styles = getComputedStyle(document.documentElement);
    const muted = styles.getPropertyValue("--muted").trim() || "#93a0b8";
    const line = styles.getPropertyValue("--line").trim() || "#243049";
    const ok = styles.getPropertyValue("--ok").trim() || "#5dde8a";
    const danger = styles.getPropertyValue("--danger").trim() || "#ff6b7a";
    const sense = styles.getPropertyValue("--sense").trim() || "#5dde8a";
    const bgSoft = styles.getPropertyValue("--bg-soft").trim() || "#182238";

    const initialH = fill
      ? Math.max(containerRef.current.clientHeight || 480, 240)
      : height;

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: initialH,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: muted,
      },
      grid: {
        vertLines: { color: hexAlpha(line, 0.55) },
        horzLines: { color: hexAlpha(line, 0.55) },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: hexAlpha(sense, 0.55),
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: bgSoft,
        },
        horzLine: {
          color: hexAlpha(sense, 0.55),
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: bgSoft,
        },
      },
      rightPriceScale: {
        borderColor: line,
        scaleMargins: { top: 0.08, bottom: 0.22 },
      },
      timeScale: {
        borderColor: line,
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 4,
        barSpacing: 8,
        minBarSpacing: 2,
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

    const candle = chart.addCandlestickSeries({
      upColor: ok,
      downColor: danger,
      borderUpColor: ok,
      borderDownColor: danger,
      wickUpColor: hexAlpha(ok, 0.85),
      wickDownColor: hexAlpha(danger, 0.85),
    });

    const volume = chart.addHistogramSeries({
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
    });
    chart.priceScale("volume").applyOptions({
      scaleMargins: { top: 0.82, bottom: 0 },
    });

    const accent2 = styles.getPropertyValue("--accent-2").trim() || "#6ea8ff";
    const warn = styles.getPropertyValue("--warn").trim() || "#f0c14a";
    const sma20 = chart.addLineSeries({
      color: hexAlpha(accent2, 0.85),
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    const sma50 = chart.addLineSeries({
      color: hexAlpha(warn, 0.85),
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });

    chartRef.current = chart;
    seriesRef.current = candle;
    volumeRef.current = volume;
    sma20Ref.current = sma20;
    sma50Ref.current = sma50;

    const ro = new ResizeObserver((entries) => {
      if (!containerRef.current || !chartRef.current) return;
      const entry = entries[0];
      const w = entry?.contentRect.width ?? containerRef.current.clientWidth;
      const h = fill
        ? Math.max(entry?.contentRect.height ?? containerRef.current.clientHeight, 240)
        : height!;
      chartRef.current.applyOptions({ width: w, height: h });
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      volumeRef.current = null;
      sma20Ref.current = null;
      sma50Ref.current = null;
      linesRef.current = [];
    };
  }, [height, fill]);

  useEffect(() => {
    if (!seriesRef.current || !volumeRef.current || !chartRef.current) return;
    if (!bars.length) {
      seriesRef.current.setData([]);
      volumeRef.current.setData([]);
      sma20Ref.current?.setData([]);
      sma50Ref.current?.setData([]);
      return;
    }

    const candleData: CandlestickData[] = bars
      .filter((b) => b.open != null && b.high != null && b.low != null && b.close != null)
      .map((b) => ({
        time: toUnix(b.ts),
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
      }))
      .sort((a, b) => Number(a.time) - Number(b.time));

    const seen = new Set<number>();
    const unique = candleData.filter((d) => {
      const t = Number(d.time);
      if (seen.has(t)) return false;
      seen.add(t);
      return true;
    });

    const styles = getComputedStyle(document.documentElement);
    const ok = styles.getPropertyValue("--ok").trim() || "#5dde8a";
    const danger = styles.getPropertyValue("--danger").trim() || "#ff6b7a";

    const volumeData = bars
      .map((b) => {
        const up = b.close >= b.open;
        return {
          time: toUnix(b.ts),
          value: b.volume ?? 0,
          color: up ? hexAlpha(ok, 0.35) : hexAlpha(danger, 0.35),
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

    chartRef.current.timeScale().fitContent();
  }, [bars, showMa]);

  useEffect(() => {
    if (!seriesRef.current) return;

    for (const line of linesRef.current) {
      seriesRef.current.removePriceLine(line);
    }
    linesRef.current = [];

    const styles = getComputedStyle(document.documentElement);
    const accent2 = styles.getPropertyValue("--accent-2").trim() || "#6ea8ff";
    const warn = styles.getPropertyValue("--warn").trim() || "#f0c14a";
    const sense = styles.getPropertyValue("--sense").trim() || "#5dde8a";
    const danger = styles.getPropertyValue("--danger").trim() || "#ff6b7a";

    const palette = [accent2, warn, sense, danger];

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
        lineWidth: 2,
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
    <div className={`price-chart${fill ? " price-chart--fill" : ""}${className ? ` ${className}` : ""}`}>
      <div
        ref={containerRef}
        className="price-chart__canvas"
        style={fill ? undefined : { height }}
      />
    </div>
  );
}
