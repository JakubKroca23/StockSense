"use client";

import { useEffect, useRef } from "react";
import {
  ColorType,
  CrosshairMode,
  IChartApi,
  ISeriesApi,
  CandlestickData,
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
};

type Props = {
  bars: ChartBar[];
  height?: number;
};

function toUnix(ts: string): Time {
  const d = new Date(ts);
  return Math.floor(d.getTime() / 1000) as Time;
}

export function PriceChart({ bars, height = 360 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeRef = useRef<ISeriesApi<"Histogram"> | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const styles = getComputedStyle(document.documentElement);
    const text = styles.getPropertyValue("--text").trim() || "#e8e6e1";
    const muted = styles.getPropertyValue("--muted").trim() || "#9a9590";
    const line = styles.getPropertyValue("--line").trim() || "#3a3834";
    const ok = styles.getPropertyValue("--ok").trim() || "#3d9a6a";
    const danger = styles.getPropertyValue("--danger").trim() || "#d45d4c";
    const accent = styles.getPropertyValue("--accent").trim() || "#c9a227";

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: muted,
      },
      grid: {
        vertLines: { color: line },
        horzLines: { color: line },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: accent, width: 1, style: 2, labelBackgroundColor: accent },
        horzLine: { color: accent, width: 1, style: 2, labelBackgroundColor: accent },
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
      wickUpColor: ok,
      wickDownColor: danger,
    });

    const volume = chart.addHistogramSeries({
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
    });
    chart.priceScale("volume").applyOptions({
      scaleMargins: { top: 0.82, bottom: 0 },
    });

    chartRef.current = chart;
    seriesRef.current = candle;
    volumeRef.current = volume;

    const ro = new ResizeObserver(() => {
      if (!containerRef.current || !chartRef.current) return;
      chartRef.current.applyOptions({ width: containerRef.current.clientWidth });
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      volumeRef.current = null;
    };
  }, [height]);

  useEffect(() => {
    if (!seriesRef.current || !volumeRef.current || !chartRef.current) return;
    if (!bars.length) {
      seriesRef.current.setData([]);
      volumeRef.current.setData([]);
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

    // Deduplicate same timestamp
    const seen = new Set<number>();
    const unique = candleData.filter((d) => {
      const t = Number(d.time);
      if (seen.has(t)) return false;
      seen.add(t);
      return true;
    });

    const styles = getComputedStyle(document.documentElement);
    const ok = styles.getPropertyValue("--ok").trim() || "#3d9a6a";
    const danger = styles.getPropertyValue("--danger").trim() || "#d45d4c";

    const volumeData = bars
      .map((b) => {
        const up = b.close >= b.open;
        return {
          time: toUnix(b.ts),
          value: b.volume ?? 0,
          color: up ? `${ok}99` : `${danger}99`,
        };
      })
      .filter((d) => {
        const t = Number(d.time);
        return seen.has(t);
      })
      .sort((a, b) => Number(a.time) - Number(b.time));

    // Deduplicate volume
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
  }, [bars]);

  function resetZoom() {
    chartRef.current?.timeScale().fitContent();
  }

  if (!bars.length) {
    return <p className="muted text-sm">Graf zatím nemá data.</p>;
  }

  return (
    <div className="price-chart">
      <div className="price-chart__toolbar">
        <span className="muted text-xs">Kolečko = zoom · táhni = posun · dvojklik na osu = reset</span>
        <button type="button" className="btn text-xs px-2 py-1" onClick={resetZoom}>
          Celý rozsah
        </button>
      </div>
      <div ref={containerRef} className="price-chart__canvas" style={{ height }} />
    </div>
  );
}
