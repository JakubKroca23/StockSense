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

export type FpVizSettings = {
  numbers: boolean;
  poc: boolean;
  wicks: boolean;
  /** Group adjacent ticks: 1 = native, 2 / 5 = coarser cells. */
  tickGroup: 1 | 2 | 5;
  /** Contrast curve for buy/sell fill (lower = punchier). */
  gamma: number;
  /** Highlight stacked imbalance when one side ≥ this × the other. 0 = off. */
  imbalance: number;
};

export const DEFAULT_FP_VIZ: FpVizSettings = {
  numbers: true,
  poc: true,
  wicks: true,
  tickGroup: 1,
  gamma: 0.7,
  imbalance: 3,
};

function groupLevels(levels: FootprintLevel[], tick: number, n: number): FootprintLevel[] {
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
  return Math.floor(new Date(ts).getTime() / 1000) as Time;
}

function fmtV(n: number) {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  if (n >= 10) return n.toFixed(0);
  if (n >= 1) return n.toFixed(1);
  return n.toFixed(2);
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
    const settings = vizRef.current;
    const bars = snap.bars;
    if (!bars.length) return;
    const theme = readTheme();
    const tick = (snap.tick || 0.01) * settings.tickGroup;
    const spacing = chart.timeScale().options().barSpacing || 16;
    const colW = Math.max(6, spacing * 0.92);
    const showText = settings.numbers && colW >= 34;
    const rightPad = 68;
    const gamma = Math.min(1.4, Math.max(0.35, settings.gamma));
    const imb = settings.imbalance > 0 ? settings.imbalance : 0;

    let peak = 0;
    const grouped = bars.map((b) => {
      const levels = groupLevels(b.levels, snap.tick || 0.01, settings.tickGroup);
      let poc = b.poc;
      if (settings.tickGroup > 1 && levels.length) {
        let best = levels[0];
        let vol = best.buy + best.sell;
        for (const lvl of levels) {
          const v = lvl.buy + lvl.sell;
          if (v > vol) {
            vol = v;
            best = lvl;
          }
        }
        poc = best.price;
      }
      for (const lvl of levels) peak = Math.max(peak, lvl.buy, lvl.sell);
      return { bar: b, levels, poc };
    });
    if (peak <= 0) return;

    ctx.font = `650 ${Math.max(9, Math.min(11, colW * 0.28))}px ${theme.font}`;
    ctx.textBaseline = "middle";

    for (const { bar, levels, poc } of grouped) {
      const x = chart.timeScale().timeToCoordinate(toUnix(bar.ts));
      if (x == null) continue;
      const left = x - colW / 2;
      if (left > w - rightPad || left + colW < 0) continue;
      const cellW = Math.min(colW, Math.max(6, w - rightPad - left));
      const midX = left + cellW / 2;

      for (const lvl of levels) {
        const y = series.priceToCoordinate(lvl.price);
        const y2 = series.priceToCoordinate(lvl.price - tick);
        if (y == null) continue;
        const yBot = y2 == null ? y + 4 : y2;
        const top = Math.min(y, yBot);
        const bot = Math.max(y, yBot);
        const cellH = Math.max(1.2, bot - top - 0.4);
        if (top > h || bot < 0) continue;

        const buyA = 0.12 + 0.78 * Math.pow(lvl.buy / peak, gamma);
        const sellA = 0.12 + 0.78 * Math.pow(lvl.sell / peak, gamma);
        const half = cellW / 2;
        ctx.fillStyle = hexAlpha(theme.down, sellA);
        ctx.fillRect(left, top, half, cellH);
        ctx.fillStyle = hexAlpha(theme.up, buyA);
        ctx.fillRect(midX, top, half, cellH);

        if (imb > 0) {
          const stackedBuy = lvl.sell > 0 && lvl.buy >= lvl.sell * imb;
          const stackedSell = lvl.buy > 0 && lvl.sell >= lvl.buy * imb;
          if (stackedBuy || stackedSell) {
            ctx.strokeStyle = hexAlpha(stackedBuy ? theme.up : theme.down, 0.9);
            ctx.lineWidth = 1.4;
            ctx.strokeRect(
              stackedBuy ? midX + 0.5 : left + 0.5,
              top + 0.5,
              half - 1,
              cellH - 1
            );
          }
        }

        if (settings.poc && poc != null && Math.abs(lvl.price - poc) < tick / 2) {
          ctx.strokeStyle = hexAlpha(theme.sense, 0.85);
          ctx.lineWidth = 1.2;
          ctx.strokeRect(left + 0.5, top + 0.5, cellW - 1, cellH - 1);
        }

        if (showText && cellH >= 9) {
          ctx.fillStyle = hexAlpha(theme.text, 0.88);
          ctx.textAlign = "right";
          ctx.fillText(fmtV(lvl.sell), midX - 3, top + cellH / 2);
          ctx.textAlign = "left";
          ctx.fillText(fmtV(lvl.buy), midX + 3, top + cellH / 2);
        }
      }
    }
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
        scaleMargins: { top: 0.04, bottom: 0.06 },
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
