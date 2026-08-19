"use client";

import { useEffect, useMemo, useRef } from "react";
import type { IChartApi, Time } from "lightweight-charts";
import {
  buildOrderflow,
  alpha,
  fmtCompact,
  fmtSignedCompact,
  FP_STAT_ROW_H,
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
  wrap: HTMLDivElement | null;
  data: FootprintData | null;
  settings: OrderflowSettings;
  height: number;
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

export function FootprintFooter({ chart, wrap, data, settings, height }: Props) {
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
    if (!chart || !wrap || height < 8) return;

    const paint = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const w = wrap.clientWidth;
      if (w < 8) return;
      const ctx = sizeCanvas(canvas, w, height);
      if (!ctx) return;

      if (!themeRef.current || themeRevRef.current !== themeRev) {
        themeRef.current = resolveOrderflowTheme(settings);
        themeRevRef.current = themeRev;
      } else {
        themeRef.current = resolveOrderflowTheme(settings);
      }

      drawFooter(ctx, chart, ofSeries, settings, themeRef.current, w, height);
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
  }, [chart, wrap, ofSeries, settings, themeRev, height]);

  if (height < 8) return null;

  return (
    <canvas
      ref={canvasRef}
      className="fp-footer"
      style={{
        display: "block",
        width: "100%",
        height,
        pointerEvents: "none",
        flexShrink: 0,
      }}
    />
  );
}

function drawFooter(
  ctx: CanvasRenderingContext2D,
  chart: IChartApi,
  ofSeries: OrderflowSeries,
  settings: OrderflowSettings,
  theme: OrderflowTheme,
  w: number,
  h: number
) {
  ctx.clearRect(0, 0, w, h);
  const bars = ofSeries.bars;
  if (!bars.length) return;
  const maxCellDelta = (bar: OrderflowBar) =>
    bar.cells.reduce((max, cell) => Math.max(max, cell.delta), 0);
  const minCellDelta = (bar: OrderflowBar) =>
    bar.cells.reduce((min, cell) => Math.min(min, cell.delta), 0);
  const maxAbsCvd = bars.reduce((max, bar) => Math.max(max, Math.abs(bar.cvd)), 0);

  const ts = chart.timeScale();
  const spacing = Math.max(3, ts.options().barSpacing ?? 9);
  const font = theme.font;
  const labelW = 42;

  const visible: { bar: OrderflowBar; x0: number; barW: number }[] = [];
  for (const bar of bars) {
    const unixTime = Math.floor(bar.timeMs / 1000) as unknown as Time;
    const barX = ts.timeToCoordinate(unixTime);
    if (barX == null) continue;
    const halfBar = spacing / 2;
    const x0 = barX - halfBar;
    const barW = spacing;
    if (x0 + barW < 0 || x0 > w) continue;
    visible.push({ bar, x0, barW });
  }
  if (!visible.length) return;

  ctx.fillStyle = alpha(theme.bgElevated, 0.92);
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = alpha(theme.line, 0.85);
  ctx.beginPath();
  ctx.moveTo(0, 0.5);
  ctx.lineTo(w, 0.5);
  ctx.stroke();

  let y = 0;
  const plotW = Math.max(0, w - labelW);

  const drawStatRow = (
    label: string,
    value: (bar: OrderflowBar) => string,
    color: (bar: OrderflowBar) => string,
    tint: (bar: OrderflowBar) => string | null
  ) => {
    ctx.fillStyle = alpha(theme.bgSoft, 0.55);
    ctx.fillRect(0, y, w, FP_STAT_ROW_H);
    ctx.strokeStyle = alpha(theme.line, 0.55);
    ctx.beginPath();
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(w, y + 0.5);
    ctx.stroke();

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, y, plotW, FP_STAT_ROW_H);
    ctx.clip();
    ctx.textBaseline = "middle";
    ctx.font = `600 10px ${font}`;
    ctx.textAlign = "center";
    for (const { bar, x0, barW } of visible) {
      const shade = tint(bar);
      if (shade) {
        ctx.fillStyle = shade;
        ctx.fillRect(x0 + 1, y + 1, barW - 2, FP_STAT_ROW_H - 2);
      }
      if (barW < 22) continue;
      ctx.fillStyle = color(bar);
      ctx.fillText(value(bar), x0 + barW / 2, y + FP_STAT_ROW_H / 2);
    }
    ctx.restore();

    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.font = `700 10px ${font}`;
    ctx.fillStyle = alpha(theme.muted, 0.95);
    ctx.fillText(label, w - labelW + 6, y + FP_STAT_ROW_H / 2);
    y += FP_STAT_ROW_H;
  };

  if (settings.showDeltaRow) {
    drawStatRow(
      "Δ",
      (bar) => fmtSignedCompact(bar.delta),
      (bar) => (bar.delta >= 0 ? theme.up : theme.down),
      (bar) =>
        ofSeries.maxAbsDelta > 0
          ? alpha(
              bar.delta >= 0 ? theme.up : theme.down,
              0.1 + (Math.abs(bar.delta) / ofSeries.maxAbsDelta) * 0.32
            )
          : null
    );
  }

  if (settings.showMaxDeltaRow) {
    drawStatRow(
      "Δ max",
      (bar) => fmtSignedCompact(maxCellDelta(bar)),
      () => theme.up,
      (bar) =>
        ofSeries.maxAbsDelta > 0
          ? alpha(theme.up, 0.08 + (Math.abs(maxCellDelta(bar)) / ofSeries.maxAbsDelta) * 0.32)
          : null
    );
  }

  if (settings.showMinDeltaRow) {
    drawStatRow(
      "Δ min",
      (bar) => fmtSignedCompact(minCellDelta(bar)),
      () => theme.down,
      (bar) =>
        ofSeries.maxAbsDelta > 0
          ? alpha(theme.down, 0.08 + (Math.abs(minCellDelta(bar)) / ofSeries.maxAbsDelta) * 0.32)
          : null
    );
  }

  if (settings.showVolumeRow) {
    drawStatRow(
      "Vol",
      (bar) => fmtCompact(bar.volume),
      () => alpha(theme.text, 0.9),
      (bar) =>
        ofSeries.maxBarVolume > 0
          ? alpha(theme.muted, 0.06 + (bar.volume / ofSeries.maxBarVolume) * 0.24)
          : null
    );
  }

  if (settings.showCvd) {
    const cvdH = h - y;
    if (cvdH < 8) return;

    ctx.fillStyle = alpha(theme.bgSoft, 0.45);
    ctx.fillRect(0, y, w, cvdH);
    ctx.strokeStyle = alpha(theme.line, 0.55);
    ctx.beginPath();
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(w, y + 0.5);
    ctx.stroke();

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, y, plotW, cvdH);
    ctx.clip();
    for (const { bar, x0, barW } of visible) {
      const intensity =
        maxAbsCvd > 0 ? Math.min(1, Math.abs(bar.cvd) / maxAbsCvd) : 0;
      const base = bar.cvd >= 0 ? theme.up : theme.down;
      ctx.fillStyle = alpha(base, 0.08 + intensity * 0.42);
      ctx.fillRect(x0 + 1, y + 1, Math.max(1, barW - 2), Math.max(1, cvdH - 2));
      if (barW >= 22) {
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.font = `600 10px ${font}`;
        ctx.fillStyle = Math.abs(bar.cvd) > 0 ? alpha(theme.text, 0.92) : alpha(theme.muted, 0.8);
        ctx.fillText(fmtSignedCompact(bar.cvd), x0 + barW / 2, y + cvdH / 2);
      }
    }
    ctx.restore();

    const lastBar = visible[visible.length - 1].bar;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.font = `700 10px ${font}`;
    ctx.fillStyle = alpha(theme.muted, 0.95);
    ctx.fillText("CVD", w - labelW + 6, y + 4);
    ctx.font = `600 10px ${font}`;
    ctx.fillStyle = alpha(theme.text, 0.9);
    ctx.fillText(fmtSignedCompact(lastBar.cvd), w - labelW + 6, y + 16);
  }
}
