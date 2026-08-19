"use client";

import { useEffect, useMemo, useRef } from "react";
import type { IChartApi, ISeriesApi, Time } from "lightweight-charts";
import {
  buildOrderflow,
  alpha,
  findLevelTouchEndIndex,
  findStackedZoneEndIndex,
  fmtCompact,
  fmtSignedCompact,
  resolveStackedDash,
  resolveOrderflowTheme,
  type FootprintData,
  type OrderflowBar,
  type OrderflowCalcOptions,
  type OrderflowSeries,
  type OrderflowSettings,
  type OrderflowTheme,
} from "@/lib/orderflow";
import { useThemeRevision } from "@/lib/theme";

type Props = {
  chart: IChartApi | null;
  series: ISeriesApi<"Candlestick"> | null;
  wrap: HTMLDivElement | null;
  data: FootprintData | null;
  settings: OrderflowSettings;
  priceDigits?: number;
  footerH?: number;
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

export function FootprintOverlay({ chart, series, wrap, data, settings, priceDigits = 2, footerH = 0 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const themeRef = useRef<OrderflowTheme | null>(null);
  const themeRevRef = useRef(-1);
  const themeRev = useThemeRevision();
  const rafRef = useRef(0);

  const calcOpts = useMemo<OrderflowCalcOptions>(
    () => ({
      tickGroup: settings.tickGroup,
      imbalance: settings.showImbalance,
      imbalanceRatio: settings.imbalanceRatio,
      imbalanceMinVolume: settings.imbalanceMinVolume,
      stacked: settings.showStacked,
      stackedMin: settings.stackedMin,
      fade: settings.showFade,
      absorption: settings.showAbsorption,
      absorptionRatio: settings.absorptionRatio,
      valueArea: settings.showValueArea,
      valueAreaPct: settings.valueAreaPct,
    }),
    [
      settings.tickGroup,
      settings.showImbalance,
      settings.imbalanceRatio,
      settings.imbalanceMinVolume,
      settings.showStacked,
      settings.stackedMin,
      settings.showFade,
      settings.showAbsorption,
      settings.absorptionRatio,
      settings.showValueArea,
      settings.valueAreaPct,
    ]
  );

  const ofSeries = useMemo(
    () => buildOrderflow(data?.bars ?? [], data?.tick ?? 0.01, calcOpts),
    [data, calcOpts]
  );

  useEffect(() => {
    if (!chart || !series || !wrap) return;

    const paint = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      if (w < 8 || h < 8) return;
      const ctx = sizeCanvas(canvas, w, h);
      if (!ctx) return;

      if (!themeRef.current || themeRevRef.current !== themeRev) {
        themeRevRef.current = themeRev;
      }
      themeRef.current = resolveOrderflowTheme(settings);

      drawClusters(ctx, chart, series, ofSeries, settings, themeRef.current, w, h, footerH);
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
  }, [chart, series, wrap, ofSeries, settings, themeRev, footerH]);

  return (
    <canvas
      ref={canvasRef}
      className="fp-overlay"
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        pointerEvents: "none",
        zIndex: 15,
      }}
    />
  );
}

function drawClusters(
  ctx: CanvasRenderingContext2D,
  chart: IChartApi,
  series: ISeriesApi<"Candlestick">,
  ofSeries: OrderflowSeries,
  settings: OrderflowSettings,
  theme: OrderflowTheme,
  w: number,
  h: number,
  footerH: number
) {
  ctx.clearRect(0, 0, w, h);
  const plotH = Math.max(0, h - footerH);
  const bars = ofSeries.bars;
  if (!bars.length || !ofSeries.step) return;

  const ts = chart.timeScale();
  if (!ts.getVisibleLogicalRange()) return;

  const step = ofSeries.step;
  const globalHeatMax = ofSeries.maxCell || 1;
  const heatAlpha = Math.max(0, Math.min(1, settings.heatOpacity / 100));
  const usePerBar = settings.heatScale === "bar";
  const font = theme.font;
  const spacing = Math.max(3, ts.options().barSpacing ?? 9);

  const visible: { bar: OrderflowBar; index: number; x0: number; barW: number }[] = [];

  for (let index = 0; index < bars.length; index += 1) {
    const bar = bars[index];
    const unixTime = Math.floor(bar.timeMs / 1000) as unknown as Time;
    const barX = ts.timeToCoordinate(unixTime);
    if (barX == null) continue;

    const halfBar = spacing / 2;
    const x0 = barX - halfBar;
    const barW = spacing;
    if (x0 + barW < 0 || x0 > w) continue;
    visible.push({ bar, index, x0, barW });
  }

  // Stacked imbalance zones projected forward
  if (settings.showImbalance && settings.showStacked) {
    ctx.setLineDash(resolveStackedDash(settings.stackedLineStyle));
    ctx.lineWidth = settings.stackedLineWidth;
    for (const { bar, x0, barW } of visible) {
      if (!bar.zones.length) continue;
      for (const zone of bar.zones) {
        const color = zone.side === "buy" ? theme.up : theme.down;
        const stopIndex = findStackedZoneEndIndex(bars, zone, zone.barIndex);
        const stopBar = stopIndex < bars.length ? bars[stopIndex] : null;
        const stopCoord =
          stopBar != null
            ? ts.timeToCoordinate(Math.floor(stopBar.timeMs / 1000) as unknown as Time)
            : null;
        const xEnd = stopCoord != null ? stopCoord - spacing / 2 : w;
        if (xEnd <= x0 + barW) continue;
        const yTop = series.priceToCoordinate(zone.toKey * step);
        const yBot = series.priceToCoordinate(zone.fromKey * step);
        if (yTop == null || yBot == null) continue;
        const top = Math.min(yTop, yBot);
        const bot = Math.max(yTop, yBot);
        if (bot < 0 || top > plotH) continue;
        ctx.fillStyle = alpha(color, Math.max(0, Math.min(1, settings.stackedFillOpacity / 100)));
        ctx.fillRect(x0 + barW, top, Math.max(0, xEnd - x0 - barW), Math.max(1, bot - top));
        ctx.strokeStyle = alpha(color, Math.max(0, Math.min(1, settings.stackedLineOpacity / 100)));
        ctx.beginPath();
        ctx.moveTo(x0 + barW, Math.round(top) + 0.5);
        ctx.lineTo(xEnd, Math.round(top) + 0.5);
        ctx.moveTo(x0 + barW, Math.round(bot) + 0.5);
        ctx.lineTo(xEnd, Math.round(bot) + 0.5);
        ctx.stroke();
      }
    }
    ctx.setLineDash([]);
  }

  if (settings.showPoc && settings.extendPoc) {
    ctx.setLineDash(resolveStackedDash(settings.pocLineStyle));
    ctx.lineWidth = settings.pocLineWidth;
    for (const { bar, index, x0, barW } of visible) {
      if (bar.poc == null) continue;
      const stopIndex = findLevelTouchEndIndex(bars, bar.poc, index);
      const stopBar = stopIndex < bars.length ? bars[stopIndex] : null;
      const stopCoord =
        stopBar != null
          ? ts.timeToCoordinate(Math.floor(stopBar.timeMs / 1000) as unknown as Time)
          : null;
      const xEnd = stopCoord != null ? stopCoord - spacing / 2 : w;
      if (xEnd <= x0 + barW) continue;
      const y = series.priceToCoordinate(bar.poc);
      if (y == null || y < 0 || y > plotH) continue;
      const lineY = Math.round(y) + 0.5;
      ctx.strokeStyle = alpha(theme.sense, Math.max(0, Math.min(1, settings.pocLineOpacity / 100)));
      ctx.beginPath();
      ctx.moveTo(x0 + barW, lineY);
      ctx.lineTo(xEnd, lineY);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  for (const { bar, x0, barW } of visible) {
    const innerX = x0 + 1;
    const innerW = Math.max(1, barW - 2);
    const candleGutter = settings.showCandle ? Math.min(5, Math.max(2, innerW * 0.18)) : 0;
    const cellX = innerX + candleGutter;
    const cellW = Math.max(1, innerW - candleGutter);

    if (settings.showValueArea && bar.val != null && bar.vah != null) {
      const yVah = series.priceToCoordinate(bar.vah);
      const yVal = series.priceToCoordinate(bar.val);
      if (yVah != null && yVal != null) {
        const top = Math.min(yVah, yVal);
        const bot = Math.max(yVah, yVal);
        ctx.fillStyle = alpha(theme.sense, 0.06);
        ctx.fillRect(innerX, top, innerW, Math.max(1, bot - top));
      }
    }

    if (settings.showCandle && candleGutter > 0) {
      const cx = innerX + candleGutter / 2;
      const yHigh = series.priceToCoordinate(bar.high);
      const yLow = series.priceToCoordinate(bar.low);
      const yOpen = series.priceToCoordinate(bar.open);
      const yClose = series.priceToCoordinate(bar.close);
      if (yHigh != null && yLow != null && yOpen != null && yClose != null) {
        const up = bar.close >= bar.open;
        ctx.strokeStyle = alpha(up ? theme.up : theme.down, 0.7);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(cx, yHigh);
        ctx.lineTo(cx, yLow);
        ctx.stroke();
        ctx.fillStyle = alpha(up ? theme.up : theme.down, 0.65);
        const bodyTop = Math.min(yOpen, yClose);
        const bodyH = Math.max(1, Math.abs(yClose - yOpen));
        ctx.fillRect(cx - 1, bodyTop, 2, bodyH);
      }
    }

    for (const cell of bar.cells) {
      const priceTop = cell.price + step / 2;
      const priceBot = cell.price - step / 2;
      const yTop = series.priceToCoordinate(priceTop);
      const yBot = series.priceToCoordinate(priceBot);
      if (yTop == null || yBot == null) continue;
      const cellY = Math.min(yTop, yBot);
      const cellH = Math.max(1, Math.abs(yBot - yTop));
      const cellY2 = (yTop + yBot) / 2;

      if (cellY > plotH || cellY + cellH < 0) continue;
      if (cell.volume <= 0 && !cell.poc) continue;

      const profileCellFill = settings.cellMode === "profile" && settings.profileStyle === "cells";
      const fillMode = profileCellFill ? settings.profileCellMetric : settings.heatMode;
      if (fillMode !== "off" && cell.volume > 0) {
        const heatMax = usePerBar ? (bar.maxCell || 1) : globalHeatMax;
        const raw =
          fillMode === "delta"
            ? Math.abs(cell.delta)
            : cell.volume;
        const intensity = Math.min(1, raw / heatMax);
        if (intensity > 0.01) {
          const base =
            fillMode === "delta"
              ? cell.delta >= 0
                ? theme.up
                : theme.down
              : theme.sense;
          ctx.fillStyle = alpha(base, 0.06 + intensity * 0.55 * heatAlpha);
          ctx.fillRect(cellX, cellY, cellW, cellH);
        }
      }

      if (settings.cellMode === "profile" && settings.profileStyle === "bars" && cell.volume > 0) {
        const mid = cellX + cellW / 2;
        const maxSide = bar.maxCell > 0 ? bar.maxCell : 1;
        const halfW = cellW / 2;
        const sellW = Math.max(0, (cell.sell / maxSide) * halfW);
        const buyW = Math.max(0, (cell.buy / maxSide) * halfW);
        const h = Math.max(1, cellH - 1);
        ctx.fillStyle = alpha(theme.down, 0.65);
        ctx.fillRect(mid - sellW, cellY + 0.5, sellW, h);
        ctx.fillStyle = alpha(theme.up, 0.65);
        ctx.fillRect(mid, cellY + 0.5, buyW, h);
      }

      if (settings.showImbalance && (cell.buyImbalance || cell.sellImbalance)) {
        const imbNorm = Math.max(0, Math.min(1, settings.imbalanceFillOpacity / 100));
        const imbStack = Math.max(0, Math.min(1, settings.imbalanceStackedFillOpacity / 100));
        const half = cellW / 2;
        if (cell.buyImbalance) {
          ctx.fillStyle = alpha(theme.imbalanceBuy, cell.stacked ? imbStack : imbNorm);
          ctx.fillRect(cellX + half, cellY + 0.5, half, Math.max(1, cellH - 1));
        }
        if (cell.sellImbalance) {
          ctx.fillStyle = alpha(theme.imbalanceSell, cell.stacked ? imbStack : imbNorm);
          ctx.fillRect(cellX, cellY + 0.5, half, Math.max(1, cellH - 1));
        }
      }

      if (settings.showPoc && cell.poc) {
        ctx.strokeStyle = alpha(theme.sense, 0.85);
        ctx.lineWidth = 1;
        ctx.strokeRect(cellX + 0.5, cellY + 0.5, Math.max(1, cellW - 1), Math.max(1, cellH - 1));
      }

      if (settings.showFade && cell.fade) {
        ctx.fillStyle = alpha(theme.text, 0.75);
        ctx.beginPath();
        ctx.moveTo(cellX + cellW - 2, cellY + 1);
        ctx.lineTo(cellX + cellW, cellY + 1);
        ctx.lineTo(cellX + cellW - 1, cellY + 4);
        ctx.closePath();
        ctx.fill();
      }

      if (
        settings.showText &&
        (settings.cellMode !== "profile" || settings.profileStyle === "cells") &&
        cellH >= 4
      ) {
        drawCellLabel(ctx, settings, theme, cell, cellX, cellY2, cellW, cellH, font);
      }
    }

    if (settings.showAbsorption && bar.absorption) {
      const yH = series.priceToCoordinate(bar.high);
      const yL = series.priceToCoordinate(bar.low);
      if (yH != null && yL != null) {
        const top = Math.min(yH, yL);
        const bot = Math.max(yH, yL);
        ctx.strokeStyle = alpha(bar.absorption === "buy" ? theme.up : theme.down, 0.75);
        ctx.setLineDash([3, 3]);
        ctx.lineWidth = 1;
        ctx.strokeRect(innerX + 0.5, top + 0.5, innerW - 1, Math.max(2, bot - top - 1));
        ctx.setLineDash([]);
      }
    }
  }
}

function drawCellLabel(
  ctx: CanvasRenderingContext2D,
  settings: OrderflowSettings,
  theme: OrderflowTheme,
  cell: { buy: number; sell: number; delta: number; volume: number },
  cellX: number,
  y: number,
  cellW: number,
  cellH: number,
  font: string
) {
  const narrow = cellW < 28;
  const cellFont = Math.max(6, Math.min(11, Math.floor(cellH * 0.75)));
  ctx.font = `${cellFont}px ${font}`;
  ctx.textBaseline = "middle";

  if (narrow || settings.cellMode === "delta") {
    if (settings.cellMode === "bidask" && narrow) {
      ctx.textAlign = "center";
      ctx.fillStyle =
        cell.delta === 0 ? alpha(theme.muted, 0.55) : cell.delta > 0 ? theme.up : theme.down;
      ctx.fillText(fmtSignedCompact(cell.delta), cellX + cellW / 2, y);
      return;
    }
    if (settings.cellMode === "volume" || (settings.cellMode === "bidask" && narrow)) {
      ctx.textAlign = "center";
      ctx.fillStyle = alpha(theme.text, 0.85);
      ctx.fillText(fmtCompact(cell.volume), cellX + cellW / 2, y);
      return;
    }
    if (settings.cellMode === "delta") {
      ctx.textAlign = "center";
      ctx.fillStyle =
        cell.delta === 0 ? alpha(theme.muted, 0.55) : cell.delta > 0 ? theme.up : theme.down;
      ctx.fillText(fmtSignedCompact(cell.delta), cellX + cellW / 2, y);
      return;
    }
  }

  if (settings.cellMode === "bidask") {
    const half = cellW / 2;
    ctx.textAlign = "right";
    ctx.fillStyle = cell.sell > 0 ? alpha(theme.down, 0.95) : alpha(theme.muted, 0.35);
    ctx.fillText(cell.sell > 0 ? fmtCompact(cell.sell) : "·", cellX + half - 2, y);
    ctx.textAlign = "left";
    ctx.fillStyle = cell.buy > 0 ? alpha(theme.up, 0.95) : alpha(theme.muted, 0.35);
    ctx.fillText(cell.buy > 0 ? fmtCompact(cell.buy) : "·", cellX + half + 2, y);
    return;
  }

  ctx.textAlign = "center";
  ctx.fillStyle = alpha(theme.text, 0.85);
  ctx.fillText(fmtCompact(cell.volume), cellX + cellW / 2, y);
}
