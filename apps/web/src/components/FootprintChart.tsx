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
  stackedImbalanceZones,
  unfinishedAuction,
  lowVolumeNodes,
  type FootprintViewMode,
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

export type FpVizSettings = {
  numbers: boolean;
  poc: boolean;
  lvn: boolean;
  wicks: boolean;
  unfinished: boolean;
  /** Cluster cell mode. */
  view: FootprintViewMode;
  /** Group adjacent ticks: 1 = native, 2 / 5 = coarser cells. */
  tickGroup: 1 | 2 | 5;
  /** Contrast curve for buy/sell fill (lower = punchier). */
  gamma: number;
  /** Overall cell fill 0–1. */
  fill: number;
  /** Normalize histogram to this candle vs whole session. */
  scale: "candle" | "session";
  /** Width-based volume histogram inside the candle (not only opacity). */
  histogram: boolean;
  buyColor: string;
  sellColor: string;
  pocColor: string;
  lvnColor: string;
  uaColor: string;
  /** Highlight stacked imbalance when one side ≥ this × the other. 0 = off. */
  imbalance: number;
  /** Min consecutive imbalanced ticks to mark a stack. */
  imbalanceStack: number;
};

export const DEFAULT_FP_VIZ: FpVizSettings = {
  numbers: true,
  poc: true,
  lvn: true,
  wicks: true,
  unfinished: true,
  view: "bidAsk",
  tickGroup: 1,
  gamma: 0.55,
  fill: 0.88,
  scale: "candle",
  histogram: true,
  buyColor: "#5dde8a",
  sellColor: "#e05a8a",
  pocColor: "#5dde8a",
  lvnColor: "#6ec8ff",
  uaColor: "#ffe066",
  imbalance: 3,
  imbalanceStack: 3,
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

function barLevelDeltaRange(bar: FootprintBar): { max: number; min: number } {
  if (!bar.levels?.length) return { max: bar.delta, min: bar.delta };
  let max = -Infinity;
  let min = Infinity;
  for (const lvl of bar.levels) {
    const d = (lvl.buy || 0) - (lvl.sell || 0);
    if (d > max) max = d;
    if (d < min) min = d;
  }
  if (!Number.isFinite(max)) return { max: bar.delta, min: bar.delta };
  return { max, min };
}

type VolumeStatsTheme = {
  text: string;
  muted: string;
  up: string;
  down: string;
  font: string;
  bgElevated: string;
};

/** Labels on the bottom volume histogram: volume, CVD, max/min delta. */
export function drawVolumeBarStats(
  ctx: CanvasRenderingContext2D,
  chart: IChartApi,
  data: FootprintData | null,
  ohlcv: { ts: string; volume?: number }[],
  clipRight: number,
  h: number,
  theme: VolumeStatsTheme,
  alignTimes?: number[]
) {
  const volTop = Math.round(h * 0.84);
  const bandH = h - volTop;
  if (bandH < 26 || clipRight < 24) return;

  const byTs = new Map<number, { vol: number; cvd: number; max: number; min: number; delta: number }>();
  let cvd = 0;
  let sessVol = 0;
  let sessMax = -Infinity;
  let sessMin = Infinity;
  const fpBars = data?.bars?.length
    ? [...data.bars].sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime())
    : [];
  for (const bar of fpBars) {
    cvd += bar.delta || 0;
    sessVol += bar.volume || 0;
    const range = barLevelDeltaRange(bar);
    if (bar.delta > sessMax) sessMax = bar.delta;
    if (bar.delta < sessMin) sessMin = bar.delta;
    byTs.set(Number(toUnix(bar.ts)), {
      vol: bar.volume,
      cvd,
      max: range.max,
      min: range.min,
      delta: bar.delta,
    });
  }
  if (!fpBars.length) {
    for (const b of ohlcv) {
      sessVol += b.volume || 0;
    }
  }

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, volTop, clipRight, bandH);
  ctx.clip();

  const spacing = chart.timeScale().options().barSpacing || 9;
  const colW = Math.max(4, spacing * 0.88);
  const showAll = colW >= 34;
  const showCvd = colW >= 22;
  const showVol = colW >= 13;
  const fs = colW >= 40 ? 9 : colW >= 22 ? 8 : 7;
  ctx.font = `700 ${fs}px ${theme.font}`;
  ctx.textBaseline = "top";
  ctx.textAlign = "center";
  ctx.shadowColor = "rgba(0,0,0,0.85)";
  ctx.shadowBlur = 3;

  const paintCol = (ts: string, fallbackVol: number) => {
    if (!showVol) return;
    const x = timeCoordinate(chart, ts, alignTimes);
    if (x == null) return;
    const left = x - colW / 2;
    if (left > clipRight || left + colW < 0) return;
    const key = Number(toUnix(ts));
    const st = byTs.get(key);
    const vol = st?.vol ?? fallbackVol;
    const mid = left + Math.min(colW, clipRight - left) / 2;
    let y = volTop + 3;
    const line = (text: string, color: string) => {
      ctx.fillStyle = color;
      ctx.fillText(text, mid, y);
      y += fs + 1;
    };
    line(fmtV(vol), theme.text);
    if (st && showCvd) line(fmtDelta(st.cvd), st.cvd >= 0 ? theme.up : theme.down);
    if (st && showAll) {
      line(fmtDelta(st.max), theme.up);
      line(fmtDelta(st.min), theme.down);
    }
  };

  if (fpBars.length) {
    for (const bar of fpBars) paintCol(bar.ts, bar.volume);
  } else {
    for (const b of ohlcv) paintCol(b.ts, b.volume ?? 0);
  }

  const bits: { t: string; c: string }[] = [{ t: `Vol ${fmtV(sessVol)}`, c: theme.text }];
  if (fpBars.length) {
    bits.push({ t: `CVD ${fmtDelta(cvd)}`, c: cvd >= 0 ? theme.up : theme.down });
    if (Number.isFinite(sessMax)) bits.push({ t: `MaxΔ ${fmtDelta(sessMax)}`, c: theme.up });
    if (Number.isFinite(sessMin)) bits.push({ t: `MinΔ ${fmtDelta(sessMin)}`, c: theme.down });
  }
  ctx.shadowBlur = 0;
  ctx.font = `700 9px ${theme.font}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const padX = 8;
  const gap = 12;
  const textW = bits.reduce((w, b, i) => w + ctx.measureText(b.t).width + (i ? gap : 0), 0);
  const tw = Math.min(clipRight - 8, textW + padX * 2);
  const ly = h - 11;
  ctx.fillStyle = hexAlpha(theme.bgElevated, 0.82);
  ctx.fillRect(4, ly - 8, tw, 16);
  let lx = 4 + padX;
  for (const bit of bits) {
    ctx.fillStyle = bit.c;
    ctx.fillText(bit.t, lx, ly);
    lx += ctx.measureText(bit.t).width + gap;
  }

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
  alignTimes?: number[]
) {
  const bars = data.bars;
  if (!bars.length) return;
  const tick = (data.tick || 0.01) * viz.tickGroup;
  const spacing = chart.timeScale().options().barSpacing || 9;
  const colW = Math.max(4, spacing * 0.9);
  const showText = viz.numbers && colW >= 14;
  const stroke = Math.max(1.1, Math.min(3.4, colW * 0.05 + 0.75));
  const gamma = Math.min(1.45, Math.max(0.28, viz.gamma ?? 0.55));
  const fill = Math.min(1, Math.max(0.2, viz.fill ?? 0.88));
  const hist = viz.histogram !== false;
  const perCandle = (viz.scale || "candle") === "candle";
  const buyCol = viz.buyColor || theme.up;
  const sellCol = viz.sellColor || theme.down;
  const pocCol = viz.pocColor || theme.sense;
  const lvnCol = viz.lvnColor || "#6ec8ff";
  const uaCol = viz.uaColor || "#ffe066";
  const imb = viz.imbalance > 0 ? viz.imbalance : 0;
  const stackMin = Math.max(1, Math.round(viz.imbalanceStack || 1));
  const view = viz.view || "bidAsk";

  let sessionPeak = 0;
  const grouped = bars.map((b) => {
    const wire = groupLevels(b.levels, data.tick || 0.01, viz.tickGroup);
    const levels = wire.map(fromWireLevel);
    let poc = b.poc;
    let localPeak = 0;
    if (levels.length) {
      let best = levels[0];
      for (const lvl of levels) {
        if (lvl.totalVolume > best.totalVolume) best = lvl;
      }
      poc = best.price;
    }
    const zones = imb > 0 ? stackedImbalanceZones(levels, tick, imb, stackMin) : [];
    const imbAt = new Map<number, "ask" | "bid">();
    for (const z of zones) {
      for (const p of z.prices) imbAt.set(p, z.side);
    }
    const ua = viz.unfinished
      ? unfinishedAuction({ high: b.high, low: b.low, levels })
      : { high: false, low: false };
    const lvn = viz.lvn !== false ? new Set(lowVolumeNodes(levels)) : new Set<number>();
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
    for (const lvl of levels) {
      if (view === "volume") localPeak = Math.max(localPeak, lvl.totalVolume);
      else if (view === "delta") localPeak = Math.max(localPeak, Math.abs(lvl.delta));
      else localPeak = Math.max(localPeak, lvl.askVolume, lvl.bidVolume, lvl.totalVolume);
    }
    sessionPeak = Math.max(sessionPeak, localPeak);
    return { bar: b, levels, poc, imbAt, ua, lvn, hiP, loP, localPeak };
  });
  if (sessionPeak <= 0) return;

  ctx.textBaseline = "middle";

  const cellBox = (price: number) => {
    const y = series.priceToCoordinate(price);
    const y2 = series.priceToCoordinate(price - tick);
    if (y == null) return null;
    const yBot = y2 == null ? y + 4 : y2;
    const top = Math.min(y, yBot);
    const bot = Math.max(y, yBot);
    return { top, bot, cellH: Math.max(1.2, bot - top - 0.4) };
  };

  for (const { bar, levels, poc, imbAt, ua, lvn, hiP, loP, localPeak } of grouped) {
    const x = timeCoordinate(chart, bar.ts, alignTimes);
    if (x == null) continue;
    const left = x - colW / 2;
    if (left > clipRight || left + colW < 0) continue;
    const cellW = Math.min(colW, Math.max(4, clipRight - left));
    const midX = left + cellW / 2;
    const half = cellW / 2;
    const peak = Math.max(1e-12, perCandle ? localPeak : sessionPeak);

    for (const lvl of levels) {
      const box = cellBox(lvl.price);
      if (!box || box.top > h || box.bot < 0) continue;
      const { top, cellH } = box;

      ctx.fillStyle = "rgba(0,0,0,0.28)";
      ctx.fillRect(left, top, cellW, cellH);

      if (view === "volume") {
        const t = Math.pow(lvl.totalVolume / peak, gamma);
        const bw = hist ? Math.max(1.5, cellW * t) : Math.max(2, cellW * (0.12 + t * 0.88));
        ctx.fillStyle = hexAlpha(lvl.delta >= 0 ? buyCol : sellCol, fill * (0.22 + 0.78 * t));
        ctx.fillRect(hist ? left : midX - bw / 2, top, bw, cellH);
      } else if (view === "delta") {
        const t = Math.pow(Math.abs(lvl.delta) / peak, gamma);
        const bw = hist ? Math.max(1.5, half * t) : Math.max(2, half * (0.1 + t * 0.9));
        ctx.fillStyle = hexAlpha(lvl.delta >= 0 ? buyCol : sellCol, fill * (0.22 + 0.78 * t));
        if (lvl.delta >= 0) ctx.fillRect(midX, top, bw, cellH);
        else ctx.fillRect(midX - bw, top, bw, cellH);
      } else if (hist) {
        const buyT = Math.pow(lvl.askVolume / peak, gamma);
        const sellT = Math.pow(lvl.bidVolume / peak, gamma);
        ctx.fillStyle = hexAlpha(sellCol, fill * (0.28 + 0.72 * sellT));
        ctx.fillRect(midX - Math.max(0, half * sellT), top, Math.max(0, half * sellT), cellH);
        ctx.fillStyle = hexAlpha(buyCol, fill * (0.28 + 0.72 * buyT));
        ctx.fillRect(midX, top, Math.max(0, half * buyT), cellH);
      } else {
        ctx.fillStyle = hexAlpha(sellCol, fill * (0.12 + 0.78 * Math.pow(lvl.bidVolume / peak, gamma)));
        ctx.fillRect(left, top, half, cellH);
        ctx.fillStyle = hexAlpha(buyCol, fill * (0.12 + 0.78 * Math.pow(lvl.askVolume / peak, gamma)));
        ctx.fillRect(midX, top, half, cellH);
      }

      const stackSide = imbAt.get(lvl.price);
      if (stackSide) {
        ctx.strokeStyle = hexAlpha(stackSide === "ask" ? buyCol : sellCol, 0.95);
        ctx.lineWidth = stroke;
        ctx.strokeRect(
          stackSide === "ask" ? midX + 0.5 : left + 0.5,
          top + 0.5,
          half - 1,
          cellH - 1
        );
        ctx.fillStyle = hexAlpha(stackSide === "ask" ? buyCol : sellCol, 0.18);
        ctx.fillRect(
          stackSide === "ask" ? midX : left,
          top,
          Math.max(2, Math.min(7, cellW * 0.08)),
          cellH
        );
      }

      if (viz.poc && poc != null && Math.abs(lvl.price - poc) < tick / 2) {
        ctx.strokeStyle = hexAlpha(pocCol, 0.95);
        ctx.lineWidth = stroke;
        ctx.strokeRect(left + 0.5, top + 0.5, cellW - 1, cellH - 1);
      }

      if (lvn.has(lvl.price)) {
        ctx.setLineDash([Math.max(3, stroke * 2), Math.max(2, stroke)]);
        ctx.strokeStyle = hexAlpha(lvnCol, 0.95);
        ctx.lineWidth = stroke;
        ctx.strokeRect(left + 1, top + 1, cellW - 2, cellH - 2);
        ctx.setLineDash([]);
        ctx.fillStyle = hexAlpha(lvnCol, 0.16);
        ctx.fillRect(left, top, cellW, cellH);
      }

      const isUa =
        (ua.high && Math.abs(lvl.price - hiP) < tick / 2) ||
        (ua.low && Math.abs(lvl.price - loP) < tick / 2);
      if (isUa) {
        ctx.fillStyle = hexAlpha(uaCol, 0.28);
        ctx.fillRect(left, top, cellW, cellH);
        ctx.strokeStyle = uaCol;
        ctx.lineWidth = stroke + 0.6;
        ctx.strokeRect(left + 0.5, top + 0.5, cellW - 1, cellH - 1);
      }

      const fontPx = Math.max(
        7,
        Math.min(22, Math.min(colW * (view === "bidAsk" ? 0.2 : 0.28), cellH * 0.72))
      );
      if (showText && cellH >= fontPx + 1) {
        ctx.font = `650 ${fontPx}px ${theme.font}`;
        ctx.shadowColor = "rgba(0,0,0,0.92)";
        ctx.shadowBlur = Math.max(2, fontPx * 0.28);
        ctx.fillStyle = hexAlpha(theme.text, 0.96);
        const pad = Math.max(2, fontPx * 0.28);
        const write = (n: number, align: CanvasTextAlign, x: number) => {
          if (!(n > 0)) return;
          ctx.textAlign = align;
          ctx.fillText(fmtV(n), x, top + cellH / 2);
        };
        if (view === "volume") {
          write(lvl.totalVolume, "center", midX);
        } else if (view === "delta") {
          if (Math.abs(lvl.delta) > 0) {
            ctx.textAlign = "center";
            const sign = lvl.delta > 0 ? "+" : "−";
            ctx.fillText(`${sign}${fmtV(Math.abs(lvl.delta))}`, midX, top + cellH / 2);
          }
        } else if (colW >= 20) {
          write(lvl.bidVolume, "right", midX - pad);
          write(lvl.askVolume, "left", midX + pad);
        } else {
          write(lvl.totalVolume, "center", midX);
        }
        ctx.shadowBlur = 0;
        ctx.shadowColor = "transparent";
      }
    }

    if (ua.high || ua.low) {
      const mark = (price: number, up: boolean) => {
        const y = series.priceToCoordinate(price);
        if (y == null) return;
        const size = Math.max(8, Math.min(22, colW * 0.4));
        const dir = up ? 1 : -1;
        const base = y + dir * size;
        ctx.beginPath();
        ctx.moveTo(midX, y);
        ctx.lineTo(midX - size * 0.9, base);
        ctx.lineTo(midX + size * 0.9, base);
        ctx.closePath();
        ctx.fillStyle = uaCol;
        ctx.fill();
        ctx.strokeStyle = "#0a0a0a";
        ctx.lineWidth = Math.max(1.2, stroke * 0.7);
        ctx.stroke();
        ctx.strokeStyle = uaCol;
        ctx.lineWidth = stroke + 0.6;
        ctx.beginPath();
        ctx.moveTo(left + 1, y + 0.5);
        ctx.lineTo(left + cellW - 1, y + 0.5);
        ctx.stroke();
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
    drawFootprintOnChart(ctx, chart, series, snap, vizRef.current, w, h, w - 68, readTheme());
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
