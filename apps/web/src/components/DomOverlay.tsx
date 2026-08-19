"use client";

import { useEffect, useMemo, useRef } from "react";
import type { IChartApi, ISeriesApi } from "lightweight-charts";
import type { OrderBookData } from "@/components/OrderBookPanel";
import {
  DepthTracker,
  alpha,
  fmtCompact,
  readOrderflowTheme,
  type DomSettings,
  type DepthSnapshot,
  type FootprintData,
  type OrderflowTheme,
} from "@/lib/orderflow";
import { useThemeRevision } from "@/lib/theme";

type Props = {
  chart: IChartApi | null;
  series: ISeriesApi<"Candlestick"> | null;
  wrap: HTMLDivElement | null;
  book: OrderBookData | null;
  footprint: FootprintData | null;
  settings: DomSettings;
  priceDigits?: number;
};

type OverlayRow = {
  key: number;
  price: number;
  bid: number;
  ask: number;
  buy: number;
  sell: number;
};

function sizeCanvas(canvas: HTMLCanvasElement, w: number, h: number) {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const cw = Math.max(1, Math.floor(w * dpr));
  const ch = Math.max(1, Math.floor(h * dpr));
  if (canvas.width !== cw || canvas.height !== ch) {
    canvas.width = cw;
    canvas.height = ch;
  }
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  const ctx = canvas.getContext("2d");
  if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

function buildOverlayRows(book: OrderBookData, footprint: FootprintData | null, settings: DomSettings): OverlayRow[] {
  const step = Math.max(1e-9, book.tick * Math.max(1, settings.tickGroup));
  const levels = new Map<number, OverlayRow>();
  const put = (price: number, patch: Partial<OverlayRow>) => {
    const key = Math.round(price / step);
    const base = levels.get(key) ?? { key, price: key * step, bid: 0, ask: 0, buy: 0, sell: 0 };
    const next = { ...base, ...patch };
    levels.set(key, next);
  };
  for (const level of book.bids) {
    put(level.price, { bid: (levels.get(Math.round(level.price / step))?.bid ?? 0) + level.amount });
  }
  for (const level of book.asks) {
    put(level.price, { ask: (levels.get(Math.round(level.price / step))?.ask ?? 0) + level.amount });
  }
  for (const bar of footprint?.bars ?? []) {
    for (const level of bar.levels) {
      const key = Math.round(level.price / step);
      const prev = levels.get(key) ?? { key, price: key * step, bid: 0, ask: 0, buy: 0, sell: 0 };
      levels.set(key, {
        ...prev,
        buy: prev.buy + level.buy,
        sell: prev.sell + level.sell,
      });
    }
  }
  return [...levels.values()].sort((a, b) => b.price - a.price);
}

export function DomOverlay({ chart, series, wrap, book, footprint, settings, priceDigits = 2 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef(0);
  const trackerRef = useRef<DepthTracker | null>(null);
  const themeRef = useRef<OrderflowTheme | null>(null);
  const themeRevRef = useRef(-1);
  const themeRev = useThemeRevision();
  const rows = useMemo(
    () => (book ? buildOverlayRows(book, settings.showVolume ? footprint : null, settings) : []),
    [book, footprint, settings]
  );

  useEffect(() => {
    if (!book) return;
    const tracker = trackerRef.current ?? new DepthTracker();
    trackerRef.current = tracker;
    const step = Math.max(1e-9, book.tick * Math.max(1, settings.tickGroup));
    tracker.configure(step);
    tracker.pushBook(book, Date.now(), Math.max(20_000, settings.heatSeconds * 1000));
  }, [book, settings.tickGroup, settings.heatSeconds]);

  useEffect(() => {
    if (!chart || !series || !wrap || !book) return;
    const paint = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      if (w < 8 || h < 8) return;
      const ctx = sizeCanvas(canvas, w, h);
      if (!ctx) return;
      if (!themeRef.current || themeRevRef.current !== themeRev) {
        themeRef.current = readOrderflowTheme();
        themeRevRef.current = themeRev;
      }
      drawDomOverlay(
        ctx,
        chart,
        series,
        rows,
        trackerRef.current?.history(Date.now(), Math.max(20_000, settings.heatSeconds * 1000)) ?? [],
        settings,
        themeRef.current,
        w,
        h,
        priceDigits
      );
    };
    const schedule = () => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(paint);
    };
    schedule();
    const onRange = () => schedule();
    chart.timeScale().subscribeVisibleLogicalRangeChange(onRange);
    chart.subscribeCrosshairMove(onRange);
    const ro = new ResizeObserver(schedule);
    ro.observe(wrap);
    return () => {
      cancelAnimationFrame(rafRef.current);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRange);
      chart.unsubscribeCrosshairMove(onRange);
      ro.disconnect();
    };
  }, [book, chart, priceDigits, rows, series, settings, themeRev, wrap]);

  return <canvas ref={canvasRef} className="dom-overlay" style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 14 }} />;
}

function drawDomOverlay(
  ctx: CanvasRenderingContext2D,
  chart: IChartApi,
  series: ISeriesApi<"Candlestick">,
  rows: OverlayRow[],
  snaps: DepthSnapshot[],
  settings: DomSettings,
  theme: OrderflowTheme,
  w: number,
  h: number,
  priceDigits: number
) {
  ctx.clearRect(0, 0, w, h);
  if (!rows.length) return;
  const axisPad = 62;
  const laneW = Math.max(56, Math.min(110, w * 0.13));
  const askX = w - axisPad - laneW;
  const bidX = askX - laneW - 8;
  const maxDepth = rows.reduce((acc, row) => Math.max(acc, row.bid, row.ask), 0) || 1;
  const maxTraded = rows.reduce((acc, row) => Math.max(acc, row.buy, row.sell), 0) || 1;
  const maxSnapDepth =
    snaps.reduce((acc, snap) => {
      let local = acc;
      for (const size of snap.bids.values()) local = Math.max(local, size);
      for (const size of snap.asks.values()) local = Math.max(local, size);
      return local;
    }, 0) || 1;

  ctx.font = `10px ${theme.font}`;
  ctx.textBaseline = "middle";

  if (settings.showHeatmap && snaps.length > 1) {
    const left = 4;
    const right = bidX - 8;
    const plotW = Math.max(12, right - left);
    const colW = Math.max(1, plotW / Math.max(1, snaps.length));
    snaps.forEach((snap, idx) => {
      const x =
        chart.timeScale().timeToCoordinate(Math.floor(snap.t / 1000) as never) ??
        left + idx * colW;
      for (const row of rows) {
        const y = series.priceToCoordinate(row.price);
        if (y == null || y < -12 || y > h + 12) continue;
        const bandH = Math.max(2, Math.min(16, settings.rowHeight * 0.7));
        const top = y - bandH / 2;
        const bid = snap.bids.get(row.key) ?? 0;
        const ask = snap.asks.get(row.key) ?? 0;
        const size = Math.max(bid, ask);
        if (size <= 0) continue;
        const intensity = Math.min(1, Math.sqrt(size / maxSnapDepth));
        ctx.fillStyle = alpha(bid >= ask ? theme.up : theme.down, 0.03 + intensity * 0.32);
        ctx.fillRect(x - colW / 2, top, colW + 0.5, bandH);
      }
    });
  }

  for (const row of rows) {
    const y = series.priceToCoordinate(row.price);
    if (y == null || y < -20 || y > h + 20) continue;
    const bandH = Math.max(2, Math.min(16, settings.rowHeight * 0.7));
    const top = y - bandH / 2;
    const bidW = Math.min(laneW, (row.bid / maxDepth) * laneW);
    const askW = Math.min(laneW, (row.ask / maxDepth) * laneW);

    if (row.bid > 0) {
      ctx.fillStyle = alpha(theme.up, 0.12);
      ctx.fillRect(bidX + laneW - bidW, top, bidW, bandH);
      ctx.strokeStyle = alpha(theme.up, 0.35);
      ctx.beginPath();
      ctx.moveTo(bidX, Math.round(y) + 0.5);
      ctx.lineTo(bidX + laneW, Math.round(y) + 0.5);
      ctx.stroke();
    }
    if (row.ask > 0) {
      ctx.fillStyle = alpha(theme.down, 0.12);
      ctx.fillRect(askX, top, askW, bandH);
      ctx.strokeStyle = alpha(theme.down, 0.35);
      ctx.beginPath();
      ctx.moveTo(askX, Math.round(y) + 0.5);
      ctx.lineTo(askX + laneW, Math.round(y) + 0.5);
      ctx.stroke();
    }

    if (settings.showVolume && (row.buy > 0 || row.sell > 0)) {
      const sellW = Math.min(laneW, (row.sell / maxTraded) * laneW);
      const buyW = Math.min(laneW, (row.buy / maxTraded) * laneW);
      ctx.fillStyle = alpha(theme.down, 0.18);
      ctx.fillRect(bidX + laneW - sellW, top + 1, sellW, Math.max(1, bandH - 2));
      ctx.fillStyle = alpha(theme.up, 0.18);
      ctx.fillRect(askX, top + 1, buyW, Math.max(1, bandH - 2));
    }

    if (settings.showDepthBars) {
      if (laneW >= 72) {
        ctx.textAlign = "right";
        ctx.fillStyle = alpha(theme.text, 0.8);
        if (row.bid > 0) ctx.fillText(fmtCompact(settings.showCumulative ? row.bid : row.bid), bidX + laneW - 4, y);
        ctx.textAlign = "left";
        if (row.ask > 0) ctx.fillText(fmtCompact(settings.showCumulative ? row.ask : row.ask), askX + 4, y);
      }
    }
  }

  const mid = rows.find((row) => row.bid > 0 && row.ask > 0) ?? rows[Math.floor(rows.length / 2)] ?? null;
  if (mid) {
    const y = series.priceToCoordinate(mid.price);
    if (y != null && y >= 0 && y <= h) {
      ctx.fillStyle = alpha(theme.bgElevated, 0.85);
      ctx.fillRect(askX - 4, y - 8, laneW * 2 + 12, 16);
      ctx.strokeStyle = alpha(theme.line, 0.7);
      ctx.strokeRect(askX - 3.5, y - 7.5, laneW * 2 + 11, 15);
      ctx.textAlign = "center";
      ctx.fillStyle = alpha(theme.text, 0.92);
      ctx.fillText(mid.price.toFixed(priceDigits), askX + laneW - 1, y);
    }
  }
}
