"use client";

import { useEffect, useMemo, useRef } from "react";
import type { IChartApi, ISeriesApi, Time } from "lightweight-charts";
import {
  buildOrderflow,
  alpha,
  clusterProfileMetric,
  clusterShowsText,
  clusterSlots,
  drawAbsorptionMark,
  drawCurrentPriceRow,
  drawFadeMark,
  drawImbalanceDot,
  findLevelTouchEndIndex,
  findStackedZoneEndIndex,
  fmtCompact,
  fmtSignedCompact,
  imbalanceCellFill,
  isBidAskCluster,
  isDeltaCluster,
  profileBarRects,
  profileSlots,
  resolveCandlePosition,
  resolveProfileSide,
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

function barUnix(ts: string) {
  const s = ts.trim();
  const hasTz = /[zZ]|[+-]\d{2}:?\d{2}$/.test(s);
  return Math.floor(new Date(hasTz ? s : `${s}Z`).getTime() / 1000);
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
      stacked: settings.showStacked || settings.imbalanceHighlight === "stacked",
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
      settings.imbalanceHighlight,
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
    const unixTime = barUnix(bar.ts) as unknown as Time;
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
            ? ts.timeToCoordinate(barUnix(stopBar.ts) as unknown as Time)
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
          ? ts.timeToCoordinate(barUnix(stopBar.ts) as unknown as Time)
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
    const candlePos = resolveCandlePosition(settings);
    const slots = clusterSlots(innerX, innerW, candlePos);
    const profSide = resolveProfileSide(settings);
    const maxSide = bar.maxCell > 0 ? bar.maxCell : 1;
    const maxDelta = Math.max(...bar.cells.map((c) => Math.abs(c.delta)), 1e-9);
    const metric = clusterProfileMetric(settings);

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

    if (slots.candleW > 0) {
      const cx = slots.candleX + slots.candleW / 2;
      const yHigh = series.priceToCoordinate(bar.high);
      const yLow = series.priceToCoordinate(bar.low);
      const yOpen = series.priceToCoordinate(bar.open);
      const yClose = series.priceToCoordinate(bar.close);
      if (yHigh != null && yLow != null && yOpen != null && yClose != null) {
        const up = bar.close >= bar.open;
        ctx.strokeStyle = alpha(up ? theme.candleUp : theme.candleDown, 0.85);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(cx, yHigh);
        ctx.lineTo(cx, yLow);
        ctx.stroke();
        ctx.fillStyle = alpha(up ? theme.candleUp : theme.candleDown, 0.8);
        const bodyTop = Math.min(yOpen, yClose);
        const bodyH = Math.max(1, Math.abs(yClose - yOpen));
        const bodyW = Math.max(2, Math.min(6, slots.candleW - 1));
        ctx.fillRect(cx - bodyW / 2, bodyTop, bodyW, bodyH);
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
        const raw = fillMode === "delta" ? Math.abs(cell.delta) : cell.volume;
        const intensity = Math.min(1, raw / heatMax);
        if (intensity > 0.01) {
          const base =
            fillMode === "delta" ? (cell.delta >= 0 ? theme.up : theme.down) : theme.sense;
          ctx.fillStyle = alpha(base, 0.06 + intensity * 0.55 * heatAlpha);
          ctx.fillRect(slots.sellX, cellY, slots.sellW, cellH);
          ctx.fillRect(slots.buyX, cellY, slots.buyW, cellH);
        }
      }

      const h = Math.max(1, cellH - 1);
      for (const strip of profileSlots(slots, profSide)) {
        if (cell.volume <= 0 && !(metric === "delta" && cell.delta !== 0)) continue;
        for (const rect of profileBarRects(strip, cell, metric, maxSide, maxDelta)) {
          ctx.fillStyle = alpha(rect.side === "buy" ? theme.up : theme.down, 0.72);
          ctx.fillRect(rect.x, cellY + 0.5, rect.w, h);
        }
      }

      if (
        settings.showImbalance &&
        imbalanceCellFill(settings, cell) &&
        (cell.buyImbalance || cell.sellImbalance)
      ) {
        const imbNorm = Math.max(0.55, Math.min(1, settings.imbalanceFillOpacity / 100 + 0.45));
        const imbStack = Math.max(0.7, Math.min(1, settings.imbalanceStackedFillOpacity / 100 + 0.35));
        if (cell.buyImbalance) {
          drawImbalanceDot(
            ctx,
            slots,
            cellY,
            cellH,
            "buy",
            alpha(theme.imbalanceBuy, cell.stacked ? imbStack : imbNorm),
            Boolean(cell.stacked)
          );
        }
        if (cell.sellImbalance) {
          drawImbalanceDot(
            ctx,
            slots,
            cellY,
            cellH,
            "sell",
            alpha(theme.imbalanceSell, cell.stacked ? imbStack : imbNorm),
            Boolean(cell.stacked)
          );
        }
      }

      if (settings.showPoc && cell.poc) {
        ctx.strokeStyle = alpha(theme.sense, 0.85);
        ctx.lineWidth = 1;
        ctx.strokeRect(slots.sellX + 0.5, cellY + 0.5, Math.max(1, slots.sellW + slots.buyW + slots.candleW - 1), Math.max(1, cellH - 1));
      }

      if (settings.showFade && cell.fade) {
        drawFadeMark(
          ctx,
          slots,
          cellY,
          cellH,
          cell.key === bar.minKey ? "sell" : "buy",
          cell.key === bar.minKey ? theme.down : theme.up
        );
      }

      if (clusterShowsText(settings) && cellH >= 4) {
        if (isBidAskCluster(settings.cellMode)) {
          drawBidAskLabel(ctx, theme, cell, slots.sellX, slots.sellW, slots.buyX, slots.buyW, cellY2, cellH, font);
        } else {
          drawCellLabel(ctx, settings, theme, cell, slots.sellX, cellY2, slots.sellW + slots.candleW + slots.buyW, cellH, font);
        }
      }
    }

    if (settings.showAbsorption && bar.absorption) {
      const yH = series.priceToCoordinate(bar.high);
      const yL = series.priceToCoordinate(bar.low);
      if (yH != null && yL != null) {
        const top = Math.min(yH, yL);
        const bot = Math.max(yH, yL);
        drawAbsorptionMark(
          ctx,
          innerX + 0.5,
          top + 0.5,
          innerW - 1,
          Math.max(4, bot - top - 1),
          bar.absorption === "buy" ? theme.up : theme.down
        );
      }
    }
  }

  const lastBar = bars[bars.length - 1];
  if (lastBar) {
    const yClose = series.priceToCoordinate(lastBar.close);
    const yHi = series.priceToCoordinate(lastBar.close + step / 2);
    const yLo = series.priceToCoordinate(lastBar.close - step / 2);
    if (yClose != null && yHi != null && yLo != null && yClose >= 0 && yClose <= plotH) {
      drawCurrentPriceRow(
        ctx,
        yClose,
        Math.max(3, Math.abs(yHi - yLo)),
        w,
        lastBar.close >= lastBar.open ? theme.up : theme.down
      );
    }
  }
}

function drawBidAskLabel(
  ctx: CanvasRenderingContext2D,
  theme: OrderflowTheme,
  cell: { buy: number; sell: number },
  sellX: number,
  sellW: number,
  buyX: number,
  buyW: number,
  y: number,
  cellH: number,
  font: string
) {
  const cellFont = Math.max(6, Math.min(11, Math.floor(cellH * 0.75)));
  ctx.font = `${cellFont}px ${font}`;
  ctx.textBaseline = "middle";
  if (sellW >= 12) {
    ctx.textAlign = "right";
    ctx.fillStyle = cell.sell > 0 ? theme.fontSell : alpha(theme.muted, 0.35);
    ctx.fillText(cell.sell > 0 ? fmtCompact(cell.sell) : "·", sellX + sellW - 2, y);
  }
  if (buyW >= 12) {
    ctx.textAlign = "left";
    ctx.fillStyle = cell.buy > 0 ? theme.fontBuy : alpha(theme.muted, 0.35);
    ctx.fillText(cell.buy > 0 ? fmtCompact(cell.buy) : "·", buyX + 2, y);
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

  if (narrow || isDeltaCluster(settings.cellMode)) {
    if (isBidAskCluster(settings.cellMode) && narrow) {
      ctx.textAlign = "center";
      ctx.fillStyle = cell.delta === 0 ? alpha(theme.muted, 0.55) : cell.delta > 0 ? theme.fontBuy : theme.fontSell;
      ctx.fillText(fmtSignedCompact(cell.delta), cellX + cellW / 2, y);
      return;
    }
    if (settings.cellMode === "volume" || (isBidAskCluster(settings.cellMode) && narrow)) {
      ctx.textAlign = "center";
      ctx.fillStyle = theme.text;
      ctx.fillText(fmtCompact(cell.volume), cellX + cellW / 2, y);
      return;
    }
    if (isDeltaCluster(settings.cellMode)) {
      ctx.textAlign = "center";
      ctx.fillStyle = cell.delta === 0 ? alpha(theme.muted, 0.55) : cell.delta > 0 ? theme.fontBuy : theme.fontSell;
      ctx.fillText(fmtSignedCompact(cell.delta), cellX + cellW / 2, y);
      return;
    }
  }

  if (isBidAskCluster(settings.cellMode)) {
    const half = cellW / 2;
    ctx.textAlign = "right";
    ctx.fillStyle = cell.sell > 0 ? theme.fontSell : alpha(theme.muted, 0.35);
    ctx.fillText(cell.sell > 0 ? fmtCompact(cell.sell) : "·", cellX + half - 2, y);
    ctx.textAlign = "left";
    ctx.fillStyle = cell.buy > 0 ? theme.fontBuy : alpha(theme.muted, 0.35);
    ctx.fillText(cell.buy > 0 ? fmtCompact(cell.buy) : "·", cellX + half + 2, y);
    return;
  }

  ctx.textAlign = "center";
  ctx.fillStyle = theme.text;
  ctx.fillText(fmtCompact(cell.volume), cellX + cellW / 2, y);
}
