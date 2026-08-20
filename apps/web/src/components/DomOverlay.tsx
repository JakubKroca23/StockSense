"use client";

import { useEffect, useMemo, useRef } from "react";
import type { IChartApi, ISeriesApi } from "lightweight-charts";
import type { OrderBookData } from "@/components/OrderBookPanel";
import {
  DepthTracker,
  alpha,
  fmtCompact,
  readOrderflowTheme,
  sessionVolumeAtPrice,
  type DepthSnapshot,
  type DomSettings,
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
  /** Fill the plot with rolling book history (dedicated heatmap chart). */
  fillHeat?: boolean;
  /** Extra space on the right (volume profile column). */
  rightInset?: number;
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
  if (settings.showVolume) {
    const vap = sessionVolumeAtPrice(footprint?.bars, step);
    for (const [key, traded] of vap) {
      const prev = levels.get(key) ?? { key, price: key * step, bid: 0, ask: 0, buy: 0, sell: 0 };
      levels.set(key, {
        ...prev,
        buy: prev.buy + traded.buy,
        sell: prev.sell + traded.sell,
      });
    }
  }
  return [...levels.values()].sort((a, b) => b.price - a.price);
}

export function DomOverlay({
  chart,
  series,
  wrap,
  book,
  footprint,
  settings,
  fillHeat = false,
  rightInset = 0,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef(0);
  const trackerRef = useRef<DepthTracker | null>(null);
  const themeRef = useRef<OrderflowTheme | null>(null);
  const themeRevRef = useRef(-1);
  const themeRev = useThemeRevision();
  const rows = useMemo(
    () => (book ? buildOverlayRows(book, footprint, settings) : []),
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
        series,
        rows,
        trackerRef.current?.history(Date.now(), Math.max(20_000, settings.heatSeconds * 1000)) ?? [],
        settings,
        themeRef.current,
        w,
        h,
        Math.max(1e-9, book.tick * Math.max(1, settings.tickGroup)),
        fillHeat,
        rightInset
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
  }, [book, chart, fillHeat, rightInset, rows, series, settings, themeRev, wrap]);

  return <canvas ref={canvasRef} className="dom-overlay" style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 14 }} />;
}

function rowBand(series: ISeriesApi<"Candlestick">, price: number, step: number) {
  const y = series.priceToCoordinate(price);
  const yTop = series.priceToCoordinate(price + step / 2);
  const yBot = series.priceToCoordinate(price - step / 2);
  if (y == null || yTop == null || yBot == null) return null;
  const top = Math.min(yTop, yBot);
  const height = Math.max(1, Math.abs(yBot - yTop) - 1);
  return { y, top, height };
}

function drawDomOverlay(
  ctx: CanvasRenderingContext2D,
  series: ISeriesApi<"Candlestick">,
  rows: OverlayRow[],
  snaps: DepthSnapshot[],
  settings: DomSettings,
  theme: OrderflowTheme,
  w: number,
  h: number,
  step: number,
  fillHeat: boolean,
  rightInset: number
) {
  ctx.clearRect(0, 0, w, h);
  if (!rows.length) return;
  const showVol = settings.showVolume;
  const colN = showVol ? 4 : 2;
  const gap = 3;
  const colW = Math.max(28, Math.min(52, (w * 0.26) / colN));
  const totalW = colN * colW + (colN - 1) * gap;
  const axisPad = 62 + Math.max(0, rightInset);
  const ladderLeft = w - axisPad - totalW - 4;
  const sellX = showVol ? ladderLeft : 0;
  const bidX = showVol ? sellX + colW + gap : ladderLeft;
  const askX = bidX + colW + gap;
  const buyX = askX + colW + gap;
  const maxDepth = rows.reduce((acc, row) => Math.max(acc, row.bid, row.ask), 0) || 1;
  const maxTraded = rows.reduce((acc, row) => Math.max(acc, row.buy, row.sell), 0) || 1;
  const maxSnapDepth =
    snaps.reduce((acc, snap) => {
      let local = acc;
      for (const size of snap.bids.values()) local = Math.max(local, size);
      for (const size of snap.asks.values()) local = Math.max(local, size);
      return local;
    }, 0) || 1;

  ctx.font = `9px ${theme.font}`;
  ctx.textBaseline = "middle";

  if (settings.showHeatmap && snaps.length > 1) {
    const right = Math.max(12, ladderLeft - 6);
    const left = fillHeat ? 4 : Math.max(4, right - Math.max(40, settings.heatWidth));
    const plotW = Math.max(12, right - left);
    const heatColW = Math.max(1, plotW / Math.max(1, snaps.length));
    snaps.forEach((snap, idx) => {
      const x = left + idx * heatColW;
      for (const row of rows) {
        const band = rowBand(series, row.price, step);
        if (!band || band.top > h + 12 || band.top + band.height < -12) continue;
        const bid = snap.bids.get(row.key) ?? 0;
        const ask = snap.asks.get(row.key) ?? 0;
        const size = Math.max(bid, ask);
        if (size <= 0) continue;
        const intensity = Math.min(1, Math.sqrt(size / maxSnapDepth));
        ctx.fillStyle = alpha(bid >= ask ? theme.up : theme.down, 0.05 + intensity * (fillHeat ? 0.55 : 0.32));
        ctx.fillRect(x, band.top, heatColW + 0.5, band.height);
      }
    });
  }

  ctx.fillStyle = alpha(theme.bgSoft, 0.38);
  ctx.fillRect(ladderLeft - 2, 0, totalW + 4, h);
  ctx.strokeStyle = alpha(theme.line, 0.45);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(Math.round(ladderLeft) - 1.5, 0);
  ctx.lineTo(Math.round(ladderLeft) - 1.5, h);
  ctx.stroke();
  const splits = showVol ? [sellX + colW, bidX + colW, askX + colW] : [bidX + colW];
  ctx.strokeStyle = alpha(theme.line, 0.28);
  for (const x of splits) {
    ctx.beginPath();
    ctx.moveTo(Math.round(x + gap / 2) + 0.5, 0);
    ctx.lineTo(Math.round(x + gap / 2) + 0.5, h);
    ctx.stroke();
  }

  ctx.fillStyle = alpha(theme.muted, 0.85);
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  if (showVol) ctx.fillText("Sell", sellX + colW / 2, 4);
  ctx.fillText("Bid", bidX + colW / 2, 4);
  ctx.fillText("Ask", askX + colW / 2, 4);
  if (showVol) ctx.fillText("Buy", buyX + colW / 2, 4);
  ctx.textBaseline = "middle";

  const barAlpha = 0.62;
  const showNums = settings.showDepthBars && colW >= 36;

  for (const row of rows) {
    const band = rowBand(series, row.price, step);
    if (!band || band.top > h + 20 || band.top + band.height < -20) continue;
    const { y, top, height } = band;
    const bidW = Math.min(colW, (row.bid / maxDepth) * colW);
    const askW = Math.min(colW, (row.ask / maxDepth) * colW);

    if (row.bid > 0) {
      ctx.fillStyle = alpha(theme.up, barAlpha);
      ctx.fillRect(bidX + colW - bidW, top, bidW, height);
    }
    if (row.ask > 0) {
      ctx.fillStyle = alpha(theme.down, barAlpha);
      ctx.fillRect(askX, top, askW, height);
    }

    if (showVol) {
      const sellW = Math.min(colW, (row.sell / maxTraded) * colW);
      const buyW = Math.min(colW, (row.buy / maxTraded) * colW);
      if (row.sell > 0) {
        ctx.fillStyle = alpha(theme.down, barAlpha);
        ctx.fillRect(sellX + colW - sellW, top, sellW, height);
      }
      if (row.buy > 0) {
        ctx.fillStyle = alpha(theme.up, barAlpha);
        ctx.fillRect(buyX, top, buyW, height);
      }
    }

    if (showNums && height >= 8) {
      ctx.font = `9px ${theme.font}`;
      if (row.bid > 0) {
        ctx.textAlign = "right";
        ctx.fillStyle = theme.text;
        ctx.fillText(fmtCompact(row.bid), bidX + colW - 3, y);
      }
      if (row.ask > 0) {
        ctx.textAlign = "left";
        ctx.fillStyle = theme.text;
        ctx.fillText(fmtCompact(row.ask), askX + 3, y);
      }
      if (showVol && row.sell > 0) {
        ctx.textAlign = "right";
        ctx.fillStyle = theme.text;
        ctx.fillText(fmtCompact(row.sell), sellX + colW - 3, y);
      }
      if (showVol && row.buy > 0) {
        ctx.textAlign = "left";
        ctx.fillStyle = theme.text;
        ctx.fillText(fmtCompact(row.buy), buyX + 3, y);
      }
    }
  }
}
