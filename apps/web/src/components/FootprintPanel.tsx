"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { DeskPick } from "@/components/DeskPick";
import { DeskWindowHead } from "@/components/DeskWindowHead";
import { useThemeRevision } from "@/lib/theme";
import {
  aggregateProfile,
  alpha,
  buildOrderflow,
  findLevelTouchEndIndex,
  findStackedZoneEndIndex,
  fmtCompact,
  fmtSignedCompact,
  resolveStackedDash,
  resolveOrderflowTheme,
  type FootprintData,
  type OrderflowBar,
  type OrderflowCalcOptions,
  type OrderflowCell,
  type OrderflowSeries,
  type OrderflowSettings,
  type OrderflowTheme,
} from "@/lib/orderflow";

const AXIS_W = 58;
const TIME_H = 20;
const STAT_ROW_H = 16;
const MIN_BAR_W = 24;
const MAX_BAR_W = 240;
const MIN_ROW_H = 5;
const MAX_ROW_H = 44;

type View = {
  /** Pixels panned into history; 0 keeps the newest bar at the right edge. */
  scrollX: number;
  centerKey: number | null;
  follow: boolean;
};

type Hover = {
  x: number;
  y: number;
  barIndex: number;
  key: number | null;
};

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

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

function fmtClock(ms: number, interval: string) {
  if (!Number.isFinite(ms)) return "";
  const d = new Date(ms);
  if (interval === "1d" || interval === "1wk") {
    return d.toLocaleDateString("cs-CZ", { day: "2-digit", month: "2-digit" });
  }
  return d.toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function metrics(w: number, h: number, s: OrderflowSettings) {
  const profileW = s.showProfile ? clamp(s.profileWidth, 40, 220) : 0;
  const statRows =
    (s.showDeltaRow ? 1 : 0) +
    (s.showMaxDeltaRow ? 1 : 0) +
    (s.showMinDeltaRow ? 1 : 0) +
    (s.showVolumeRow ? 1 : 0);
  const cvdH = s.showCvd ? clamp(s.cvdHeight, 28, 180) : 0;
  const footerH = statRows * STAT_ROW_H + cvdH + TIME_H;
  const plotW = Math.max(80, w - AXIS_W - profileW);
  const plotH = Math.max(80, h - footerH);
  return { profileW, statRows, cvdH, footerH, plotW, plotH };
}

export function FootprintPanel({
  data,
  settings,
  onSettingsChange,
  priceDigits = 2,
  interval,
  lookback,
  intervals,
  lookbacks,
  onSelectInterval,
  onSelectLookback,
  settingsPanel,
  onClose,
  onDragStart,
  loading = false,
}: {
  data: FootprintData | null;
  settings: OrderflowSettings;
  onSettingsChange: (patch: Partial<OrderflowSettings>) => void;
  priceDigits?: number;
  interval: string;
  lookback: string;
  intervals: { id: string; label: string }[];
  lookbacks: { id: string; label: string }[];
  onSelectInterval: (id: string) => void;
  onSelectLookback: (id: string) => void;
  settingsPanel?: ReactNode;
  onClose?: () => void;
  onDragStart?: (e: ReactPointerEvent<HTMLElement>) => void;
  loading?: boolean;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<View>({ scrollX: 0, centerKey: null, follow: true });
  const themeRef = useRef<OrderflowTheme | null>(null);
  const themeRevRef = useRef(-1);
  const dragRef = useRef<{ x: number; y: number; scrollX: number; centerKey: number } | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hover, setHover] = useState<Hover | null>(null);
  const [frame, setFrame] = useState(0);
  const [live, setLive] = useState(true);
  const themeRev = useThemeRevision();

  const redraw = useCallback(() => setFrame((n) => n + 1), []);
  /** Mirrors the mutable follow flag into state so the header button can react to it. */
  const setFollow = useCallback((next: boolean) => {
    viewRef.current.follow = next;
    setLive(next);
  }, []);

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

  const series = useMemo(
    () => buildOrderflow(data?.bars ?? [], data?.tick ?? 0.01, calcOpts),
    [data, calcOpts]
  );

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  /** Snap back to the live edge whenever a new bar lands and the user has not panned away. */
  useEffect(() => {
    const view = viewRef.current;
    const last = series.bars[series.bars.length - 1];
    if (!last || !series.step) return;
    if (view.centerKey == null || view.follow) {
      view.scrollX = 0;
      view.centerKey = last.close / series.step;
    }
  }, [series]);

  const zoom = useCallback(
    (e: WheelEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      e.preventDefault();
      const s = settings;
      const view = viewRef.current;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const { plotW, plotH } = metrics(rect.width, rect.height, s);
      const step = e.deltaY > 0 ? 1 / 1.12 : 1.12;

      if (e.ctrlKey || e.metaKey) {
        const rh = s.rowHeight;
        const next = clamp(Math.round(rh * step * 10) / 10, MIN_ROW_H, MAX_ROW_H);
        if (next === rh) return;
        const keyAt = (view.centerKey ?? 0) + (plotH / 2 - y) / rh;
        view.centerKey = keyAt - (plotH / 2 - y) / next;
        setFollow(false);
        onSettingsChange({ rowHeight: next });
        return;
      }
      if (e.shiftKey) {
        view.scrollX = Math.max(0, view.scrollX + (e.deltaY > 0 ? s.barWidth : -s.barWidth));
        setFollow(view.scrollX === 0);
        redraw();
        return;
      }
      const bw = s.barWidth;
      const next = clamp(Math.round(bw * step), MIN_BAR_W, MAX_BAR_W);
      if (next === bw) return;
      const lastIdx = series.bars.length - 1;
      const idxAt = lastIdx + 1 + (x - plotW - view.scrollX) / bw;
      view.scrollX = Math.max(0, x - plotW - (idxAt - lastIdx - 1) * next);
      setFollow(view.scrollX === 0);
      onSettingsChange({ barWidth: next });
    },
    [onSettingsChange, redraw, setFollow, settings, series.bars.length]
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.addEventListener("wheel", zoom, { passive: false });
    return () => canvas.removeEventListener("wheel", zoom);
  }, [zoom]);

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    const view = viewRef.current;
    dragRef.current = {
      x: e.clientX,
      y: e.clientY,
      scrollX: view.scrollX,
      centerKey: view.centerKey ?? 0,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const drag = dragRef.current;
    const view = viewRef.current;

    if (drag) {
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      view.scrollX = Math.max(0, drag.scrollX + dx);
      view.centerKey = drag.centerKey + dy / settings.rowHeight;
      setFollow(view.scrollX === 0);
      redraw();
      return;
    }

    const { plotW, plotH } = metrics(rect.width, rect.height, settings);
    if (x > plotW || y > plotH || !series.bars.length || !series.step) {
      if (hover) setHover(null);
      return;
    }
    const lastIdx = series.bars.length - 1;
    const barIndex = Math.floor(lastIdx + 1 + (x - plotW - view.scrollX) / settings.barWidth);
    if (barIndex < 0 || barIndex > lastIdx) {
      if (hover) setHover(null);
      return;
    }
    const keyTop = (view.centerKey ?? 0) + plotH / (2 * settings.rowHeight);
    const key = Math.round(keyTop - y / settings.rowHeight);
    setHover({ x, y, barIndex, key });
  };

  const endDrag = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (dragRef.current) {
      dragRef.current = null;
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* pointer already released */
      }
    }
  };

  const goLive = useCallback(() => {
    const view = viewRef.current;
    const last = series.bars[series.bars.length - 1];
    view.scrollX = 0;
    setFollow(true);
    if (last && series.step) view.centerKey = last.close / series.step;
    redraw();
  }, [series, redraw, setFollow]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.w < 8 || size.h < 8) return;
    const ctx = sizeCanvas(canvas, size.w, size.h);
    if (!ctx) return;
    if (!themeRef.current || themeRevRef.current !== themeRev) {
      themeRevRef.current = themeRev;
    }
    themeRef.current = resolveOrderflowTheme(settings);
    const theme = themeRef.current;
    drawFootprint(ctx, {
      w: size.w,
      h: size.h,
      theme,
      settings,
      series,
      view: viewRef.current,
      hover,
      priceDigits,
      interval,
      loading,
    });
  }, [size, settings, series, hover, priceDigits, interval, loading, frame, themeRev]);

  const bars = series.bars;
  const last = bars[bars.length - 1] ?? null;
  const hoveredBar = hover ? bars[hover.barIndex] ?? null : null;
  const hoveredCell =
    hoveredBar && hover?.key != null
      ? hoveredBar.cells.find((c) => c.key === hover.key) ?? null
      : null;

  return (
    <section className="fp-panel">
      <DeskWindowHead
        title="Footprint"
        onDragStart={onDragStart}
        onClose={onClose}
        settings={settingsPanel}
        extra={
          <div className="fp-panel__head">
            <div className="desk-win__picks">
              <DeskPick
                label={intervals.find((i) => i.id === interval)?.label ?? interval}
                ariaLabel="Timeframe footprintu"
                value={interval}
                options={intervals}
                onSelect={onSelectInterval}
                className="desk-win__pick"
              />
              <DeskPick
                label={lookbacks.find((l) => l.id === lookback)?.label ?? lookback}
                ariaLabel="Období footprintu"
                value={lookback}
                options={lookbacks}
                onSelect={onSelectLookback}
                className="desk-win__pick"
              />
            </div>
            {last ? (
              <p className="fp-panel__stats muted text-xs">
                <span className={last.delta >= 0 ? "is-up" : "is-down"}>
                  Δ {fmtSignedCompact(last.delta)}
                </span>
                <span>CVD {fmtSignedCompact(last.cvd)}</span>
                <span>
                  {series.bars.length} × {interval}
                </span>
              </p>
            ) : null}
            <button
              type="button"
              className={`desk-win__pick fp-panel__live${live ? " is-active" : ""}`}
              onClick={goLive}
              title="Skočit na živou svíčku"
            >
              Live
            </button>
          </div>
        }
      />
      <div className="fp-panel__body" ref={bodyRef}>
        <canvas
          ref={canvasRef}
          className="fp-panel__canvas"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onPointerLeave={(e) => {
            endDrag(e);
            setHover(null);
          }}
          onDoubleClick={goLive}
        />
        {hoveredBar ? (
          <FootprintTooltip
            bar={hoveredBar}
            cell={hoveredCell}
            x={hover?.x ?? 0}
            y={hover?.y ?? 0}
            width={size.w}
            height={size.h}
            priceDigits={priceDigits}
            interval={interval}
          />
        ) : null}
        {!bars.length ? (
          <p className="fp-panel__empty muted text-sm">
            {loading ? "Načítám footprint…" : "Žádná footprint data."}
          </p>
        ) : null}
      </div>
    </section>
  );
}

function FootprintTooltip({
  bar,
  cell,
  x,
  y,
  width,
  height,
  priceDigits,
  interval,
}: {
  bar: OrderflowBar;
  cell: OrderflowCell | null;
  x: number;
  y: number;
  width: number;
  height: number;
  priceDigits: number;
  interval: string;
}) {
  const flip = x > width - 210;
  const up = y > height - 190;
  return (
    <div
      className="fp-tip"
      style={{
        left: flip ? undefined : x + 14,
        right: flip ? width - x + 14 : undefined,
        top: up ? undefined : y + 14,
        bottom: up ? height - y + 14 : undefined,
      }}
    >
      <p className="fp-tip__time">{fmtClock(bar.timeMs, interval)}</p>
      <dl className="fp-tip__grid">
        <dt>O/C</dt>
        <dd>
          {bar.open.toFixed(priceDigits)} → {bar.close.toFixed(priceDigits)}
        </dd>
        <dt>H/L</dt>
        <dd>
          {bar.high.toFixed(priceDigits)} / {bar.low.toFixed(priceDigits)}
        </dd>
        <dt>Objem</dt>
        <dd>{fmtCompact(bar.volume)}</dd>
        <dt>Delta</dt>
        <dd className={bar.delta >= 0 ? "is-up" : "is-down"}>
          {fmtSignedCompact(bar.delta)} ({bar.deltaPct.toFixed(0)} %)
        </dd>
        <dt>CVD</dt>
        <dd>{fmtSignedCompact(bar.cvd)}</dd>
        <dt>POC</dt>
        <dd>{bar.poc != null ? bar.poc.toFixed(priceDigits) : "—"}</dd>
        {bar.vah != null && bar.val != null ? (
          <>
            <dt>VA</dt>
            <dd>
              {bar.val.toFixed(priceDigits)} – {bar.vah.toFixed(priceDigits)}
            </dd>
          </>
        ) : null}
        {bar.absorption ? (
          <>
            <dt>Absorpce</dt>
            <dd className={bar.absorption === "buy" ? "is-up" : "is-down"}>
              {bar.absorption === "buy" ? "nákupy pohlceny" : "prodeje pohlceny"}
            </dd>
          </>
        ) : null}
      </dl>
      {cell ? (
        <div className="fp-tip__cell">
          <p className="fp-tip__cell-px">{cell.price.toFixed(priceDigits)}</p>
          <p>
            <span className="is-down">bid {fmtCompact(cell.sell)}</span>
            {" × "}
            <span className="is-up">ask {fmtCompact(cell.buy)}</span>
            {" · "}
            <span className={cell.delta >= 0 ? "is-up" : "is-down"}>
              {fmtSignedCompact(cell.delta)}
            </span>
          </p>
          {cell.buyImbalance || cell.sellImbalance || cell.poc || cell.fade ? (
            <p className="fp-tip__flags">
              {cell.buyImbalance ? <span className="is-up">buy imbalance</span> : null}
              {cell.sellImbalance ? <span className="is-down">sell imbalance</span> : null}
              {cell.stacked ? <span>stacked</span> : null}
              {cell.poc ? <span>POC</span> : null}
              {cell.fade ? <span>fade</span> : null}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

type DrawArgs = {
  w: number;
  h: number;
  theme: OrderflowTheme;
  settings: OrderflowSettings;
  series: OrderflowSeries;
  view: View;
  hover: Hover | null;
  priceDigits: number;
  interval: string;
  loading: boolean;
};

function drawFootprint(ctx: CanvasRenderingContext2D, args: DrawArgs) {
  const { w, h, theme, settings: s, series, view, hover, priceDigits, interval } = args;
  const bars = series.bars;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, w, h);
  if (!bars.length || !series.step) return;

  const { profileW, cvdH, plotW, plotH } = metrics(w, h, s);
  const bw = clamp(s.barWidth, MIN_BAR_W, MAX_BAR_W);
  const rh = clamp(s.rowHeight, MIN_ROW_H, MAX_ROW_H);
  const lastIdx = bars.length - 1;

  view.scrollX = clamp(view.scrollX, 0, Math.max(0, bars.length * bw - plotW * 0.5));
  if (view.centerKey == null) view.centerKey = bars[lastIdx].close / series.step;
  const centerKey = view.centerKey;
  const keyTop = centerKey + plotH / (2 * rh);
  const yOf = (key: number) => (keyTop - key) * rh;
  const xOf = (i: number) => plotW - (lastIdx - i + 1) * bw + view.scrollX;

  const first = Math.max(0, Math.ceil(lastIdx - (plotW + view.scrollX) / bw));
  const lastVisible = Math.min(lastIdx, Math.floor(lastIdx - view.scrollX / bw));
  const keyLo = Math.floor(keyTop - plotH / rh) - 1;
  const keyHi = Math.ceil(keyTop) + 1;

  const font = theme.font;
  const globalHeatMax = series.maxCell || 1;
  const usePerBar = s.heatScale === "bar";
  const heatAlpha = clamp(s.heatOpacity, 0, 100) / 100;

  // ---- price grid -------------------------------------------------------
  const labelStep = Math.max(1, Math.ceil(20 / rh));
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, plotW, plotH);
  ctx.clip();
  ctx.strokeStyle = alpha(theme.line, 0.5);
  ctx.lineWidth = 1;
  for (let key = keyLo; key <= keyHi; key += 1) {
    if (key % labelStep !== 0) continue;
    const y = Math.round(yOf(key)) + 0.5;
    if (y < 0 || y > plotH) continue;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(plotW, y);
    ctx.stroke();
  }
  ctx.restore();

  // ---- bars -------------------------------------------------------------
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, plotW, plotH);
  ctx.clip();
  ctx.textBaseline = "middle";

  const cellFont = Math.max(7, Math.min(12, Math.floor(rh * 0.72)));
  const canLabel = s.showText && rh >= 9 && bw >= 34;

  for (let i = first; i <= lastVisible; i += 1) {
    const bar = bars[i];
    const x = xOf(i);
    const innerX = x + 1;
    const innerW = bw - 2;
    if (innerW <= 2) continue;

    // value area band behind the cluster
    if (s.showValueArea && bar.val != null && bar.vah != null) {
      const yTop = yOf(bar.vah / series.step) - rh / 2;
      const yBot = yOf(bar.val / series.step) + rh / 2;
      ctx.fillStyle = alpha(theme.sense, 0.07);
      ctx.fillRect(innerX, yTop, innerW, Math.max(1, yBot - yTop));
    }

    // candle skeleton on the left gutter of the column
    if (s.showCandle) {
      const cx = innerX + 2.5;
      const yHigh = yOf(bar.high / series.step);
      const yLow = yOf(bar.low / series.step);
      const yOpen = yOf(bar.open / series.step);
      const yClose = yOf(bar.close / series.step);
      const up = bar.close >= bar.open;
      ctx.strokeStyle = alpha(up ? theme.up : theme.down, 0.55);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx, yHigh);
      ctx.lineTo(cx, yLow);
      ctx.stroke();
      ctx.fillStyle = alpha(up ? theme.up : theme.down, 0.55);
      ctx.fillRect(cx - 1.5, Math.min(yOpen, yClose), 3, Math.max(1.5, Math.abs(yClose - yOpen)));
    }

    const cellX = innerX + (s.showCandle ? 6 : 0);
    const cellW = innerW - (s.showCandle ? 6 : 0);
    if (cellW <= 2) continue;
    const half = cellW / 2;

    for (const cell of bar.cells) {
      if (cell.key < keyLo || cell.key > keyHi) continue;
      if (cell.volume <= 0 && !cell.poc) continue;
      const yc = yOf(cell.key);
      const yTop = yc - rh / 2;

      // heat background
      const profileCellFill = s.cellMode === "profile" && s.profileStyle === "cells";
      const fillMode = profileCellFill ? s.profileCellMetric : s.heatMode;
      if (fillMode !== "off") {
        const heatMax = usePerBar ? (bar.maxCell || 1) : globalHeatMax;
        const raw = fillMode === "delta" ? Math.abs(cell.delta) : cell.volume;
        const intensity = Math.min(1, raw / heatMax);
        if (intensity > 0.01) {
          const base =
            fillMode === "delta" ? (cell.delta >= 0 ? theme.up : theme.down) : theme.sense;
          ctx.fillStyle = alpha(base, 0.06 + intensity * 0.55 * heatAlpha);
          ctx.fillRect(cellX, yTop, cellW, rh);
        }
      }

      if (s.cellMode === "profile" && s.profileStyle === "bars") {
        const mid = cellX + cellW / 2;
        const maxSide = bar.maxCell > 0 ? bar.maxCell : 1;
        const halfW = cellW / 2;
        const sellW = Math.max(0, (cell.sell / maxSide) * halfW);
        const buyW = Math.max(0, (cell.buy / maxSide) * halfW);
        const h = Math.max(1, rh - 2);
        ctx.fillStyle = alpha(theme.down, 0.75);
        ctx.fillRect(mid - sellW, yTop + 1, sellW, h);
        ctx.fillStyle = alpha(theme.up, 0.75);
        ctx.fillRect(mid, yTop + 1, buyW, h);
      }

      // diagonal imbalance markers
      if (s.showImbalance && (cell.buyImbalance || cell.sellImbalance)) {
        const imbNorm = clamp(s.imbalanceFillOpacity, 0, 100) / 100;
        const imbStack = clamp(s.imbalanceStackedFillOpacity, 0, 100) / 100;
        if (cell.buyImbalance) {
          ctx.fillStyle = alpha(theme.imbalanceBuy, cell.stacked ? imbStack : imbNorm);
          ctx.fillRect(cellX + half, yTop + 0.5, half, rh - 1);
        }
        if (cell.sellImbalance) {
          ctx.fillStyle = alpha(theme.imbalanceSell, cell.stacked ? imbStack : imbNorm);
          ctx.fillRect(cellX, yTop + 0.5, half, rh - 1);
        }
      }

      if (s.showPoc && cell.poc) {
        ctx.strokeStyle = alpha(theme.sense, 0.85);
        ctx.lineWidth = 1;
        ctx.strokeRect(cellX + 0.5, yTop + 0.5, cellW - 1, rh - 1);
      }

      if (s.showFade && cell.fade) {
        ctx.fillStyle = alpha(theme.text, 0.6);
        ctx.beginPath();
        ctx.moveTo(cellX + cellW - 4, yTop + 2);
        ctx.lineTo(cellX + cellW - 1, yTop + 2);
        ctx.lineTo(cellX + cellW - 2.5, yTop + 5.5);
        ctx.closePath();
        ctx.fill();
      }

      if (!canLabel || (s.cellMode === "profile" && s.profileStyle !== "cells")) continue;
      ctx.font = `${cellFont}px ${font}`;
      if (s.cellMode === "bidask") {
        ctx.textAlign = "right";
        ctx.fillStyle = cell.sell > 0 ? alpha(theme.down, 0.95) : alpha(theme.muted, 0.4);
        ctx.fillText(cell.sell > 0 ? fmtCompact(cell.sell) : "·", cellX + half - 3, yc);
        ctx.textAlign = "left";
        ctx.fillStyle = cell.buy > 0 ? alpha(theme.up, 0.95) : alpha(theme.muted, 0.4);
        ctx.fillText(cell.buy > 0 ? fmtCompact(cell.buy) : "·", cellX + half + 3, yc);
      } else if (s.cellMode === "delta") {
        ctx.textAlign = "center";
        ctx.fillStyle = cell.delta === 0 ? alpha(theme.muted, 0.6) : cell.delta > 0 ? theme.up : theme.down;
        ctx.fillText(fmtSignedCompact(cell.delta), cellX + half, yc);
      } else {
        ctx.textAlign = "center";
        ctx.fillStyle = alpha(theme.text, 0.85);
        ctx.fillText(fmtCompact(cell.volume), cellX + half, yc);
      }
    }

    if (s.showAbsorption && bar.absorption) {
      ctx.strokeStyle = alpha(bar.absorption === "buy" ? theme.up : theme.down, 0.75);
      ctx.setLineDash([3, 3]);
      ctx.lineWidth = 1;
      const yHigh = yOf(bar.maxKey) - rh / 2;
      const yLow = yOf(bar.minKey) + rh / 2;
      ctx.strokeRect(innerX + 0.5, yHigh + 0.5, innerW - 1, Math.max(2, yLow - yHigh - 1));
      ctx.setLineDash([]);
    }
  }

  // ---- stacked imbalance zones project forward as S/R -------------------
  if (s.showImbalance && s.showStacked) {
    ctx.setLineDash(resolveStackedDash(s.stackedLineStyle));
    ctx.lineWidth = s.stackedLineWidth;
    for (let i = first; i <= lastVisible; i += 1) {
      const bar = bars[i];
      if (!bar.zones.length) continue;
      const x = xOf(i);
      for (const zone of bar.zones) {
        const color = zone.side === "buy" ? theme.up : theme.down;
        const stopIndex = Math.min(findStackedZoneEndIndex(bars, zone, i), lastVisible + 1);
        const xEnd = stopIndex <= lastVisible ? xOf(stopIndex) : plotW;
        if (xEnd <= x + bw) continue;
        const yTop = yOf(zone.toKey) - rh / 2;
        const yBot = yOf(zone.fromKey) + rh / 2;
        if (yBot < 0 || yTop > plotH) continue;
        ctx.fillStyle = alpha(color, Math.max(0, Math.min(1, s.stackedFillOpacity / 100)));
        ctx.fillRect(x + bw, yTop, Math.max(0, xEnd - x - bw), Math.max(1, yBot - yTop));
        ctx.strokeStyle = alpha(color, Math.max(0, Math.min(1, s.stackedLineOpacity / 100)));
        ctx.beginPath();
        ctx.moveTo(x + bw, Math.round(yTop) + 0.5);
        ctx.lineTo(xEnd, Math.round(yTop) + 0.5);
        ctx.moveTo(x + bw, Math.round(yBot) + 0.5);
        ctx.lineTo(xEnd, Math.round(yBot) + 0.5);
        ctx.stroke();
      }
    }
    ctx.setLineDash([]);
  }

  if (s.showPoc && s.extendPoc) {
    ctx.setLineDash(resolveStackedDash(s.pocLineStyle));
    ctx.lineWidth = s.pocLineWidth;
    ctx.strokeStyle = alpha(theme.sense, Math.max(0, Math.min(1, s.pocLineOpacity / 100)));
    for (let i = first; i <= lastVisible; i += 1) {
      const bar = bars[i];
      if (bar.poc == null) continue;
      const stopIndex = Math.min(findLevelTouchEndIndex(bars, bar.poc, i), lastVisible + 1);
      const x = xOf(i);
      const xEnd = stopIndex <= lastVisible ? xOf(stopIndex) : plotW;
      if (xEnd <= x + bw) continue;
      const y = yOf(bar.poc / series.step);
      if (y < 0 || y > plotH) continue;
      const lineY = Math.round(y) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x + bw, lineY);
      ctx.lineTo(xEnd, lineY);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }
  ctx.restore();

  // ---- visible-range volume profile ------------------------------------
  if (profileW > 0) {
    const profile = aggregateProfile(
      bars,
      first,
      lastVisible,
      series.step,
      series.digits,
      s.valueAreaPct
    );
    const x0 = plotW;
    const maxW = profileW - 8;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, 0, profileW, plotH);
    ctx.clip();
    ctx.fillStyle = alpha(theme.bgSoft, 0.4);
    ctx.fillRect(x0, 0, profileW, plotH);
    if (profile.val != null && profile.vah != null) {
      const yTop = yOf(profile.vah / series.step) - rh / 2;
      const yBot = yOf(profile.val / series.step) + rh / 2;
      ctx.fillStyle = alpha(theme.sense, 0.09);
      ctx.fillRect(x0, yTop, profileW, Math.max(1, yBot - yTop));
    }
    if (profile.maxVolume > 0) {
      for (const row of profile.rows) {
        if (row.key < keyLo || row.key > keyHi) continue;
        const yTop = yOf(row.key) - rh / 2 + 0.5;
        const barH = Math.max(1, rh - 1);
        const total = (row.volume / profile.maxVolume) * maxW;
        const sellW = row.volume > 0 ? (row.sell / row.volume) * total : 0;
        ctx.fillStyle = alpha(theme.down, 0.55);
        ctx.fillRect(x0 + 4, yTop, sellW, barH);
        ctx.fillStyle = alpha(theme.up, 0.55);
        ctx.fillRect(x0 + 4 + sellW, yTop, Math.max(0, total - sellW), barH);
      }
    }
    if (profile.poc != null) {
      const y = Math.round(yOf(profile.poc / series.step)) + 0.5;
      ctx.strokeStyle = alpha(theme.sense, 0.9);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(x0 + profileW, y);
      ctx.stroke();
    }
    ctx.restore();
    ctx.strokeStyle = alpha(theme.line, 0.9);
    ctx.beginPath();
    ctx.moveTo(x0 + 0.5, 0);
    ctx.lineTo(x0 + 0.5, plotH);
    ctx.stroke();
  }

  // ---- price axis -------------------------------------------------------
  const axisX = w - AXIS_W;
  ctx.fillStyle = alpha(theme.bgElevated, 0.85);
  ctx.fillRect(axisX, 0, AXIS_W, plotH);
  ctx.strokeStyle = alpha(theme.line, 0.9);
  ctx.beginPath();
  ctx.moveTo(axisX + 0.5, 0);
  ctx.lineTo(axisX + 0.5, h);
  ctx.stroke();
  ctx.font = `10px ${font}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = alpha(theme.muted, 0.9);
  for (let key = keyLo; key <= keyHi; key += 1) {
    if (key % labelStep !== 0) continue;
    const y = yOf(key);
    if (y < 8 || y > plotH - 4) continue;
    ctx.fillText((key * series.step).toFixed(priceDigits), axisX + 5, y);
  }

  const lastBar = bars[lastIdx];
  const maxCellDelta = (bar: OrderflowBar) =>
    bar.cells.reduce((max, cell) => Math.max(max, cell.delta), 0);
  const minCellDelta = (bar: OrderflowBar) =>
    bar.cells.reduce((min, cell) => Math.min(min, cell.delta), 0);
  const maxAbsCvd = bars.reduce((max, bar) => Math.max(max, Math.abs(bar.cvd)), 0);
  const lastY = yOf(lastBar.close / series.step);
  if (lastY >= 0 && lastY <= plotH) {
    const up = lastBar.close >= lastBar.open;
    ctx.fillStyle = up ? theme.up : theme.down;
    ctx.fillRect(axisX + 1, lastY - 7, AXIS_W - 2, 14);
    ctx.fillStyle = theme.bg;
    ctx.font = `600 10px ${font}`;
    ctx.fillText(lastBar.close.toFixed(priceDigits), axisX + 5, lastY);
  }

  // ---- footer: delta / volume rows + CVD --------------------------------
  let footY = plotH;
  ctx.textBaseline = "middle";
  ctx.font = `10px ${font}`;

  const drawStatRow = (
    label: string,
    value: (bar: OrderflowBar) => string,
    color: (bar: OrderflowBar) => string,
    tint: (bar: OrderflowBar) => string | null
  ) => {
    ctx.fillStyle = alpha(theme.bgSoft, 0.5);
    ctx.fillRect(0, footY, plotW + profileW, STAT_ROW_H);
    ctx.strokeStyle = alpha(theme.line, 0.6);
    ctx.beginPath();
    ctx.moveTo(0, footY + 0.5);
    ctx.lineTo(plotW + profileW, footY + 0.5);
    ctx.stroke();
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, footY, plotW, STAT_ROW_H);
    ctx.clip();
    ctx.textAlign = "center";
    for (let i = first; i <= lastVisible; i += 1) {
      const bar = bars[i];
      const x = xOf(i);
      const shade = tint(bar);
      if (shade) {
        ctx.fillStyle = shade;
        ctx.fillRect(x + 1, footY + 1, bw - 2, STAT_ROW_H - 2);
      }
      if (bw < 28) continue;
      ctx.fillStyle = color(bar);
      ctx.fillText(value(bar), x + bw / 2, footY + STAT_ROW_H / 2);
    }
    ctx.restore();
    ctx.textAlign = "left";
    ctx.fillStyle = alpha(theme.muted, 0.9);
    ctx.fillText(label, axisX + 5, footY + STAT_ROW_H / 2);
    footY += STAT_ROW_H;
  };

  if (s.showDeltaRow) {
    drawStatRow(
      "Δ",
      (bar) => fmtSignedCompact(bar.delta),
      (bar) => (bar.delta >= 0 ? theme.up : theme.down),
      (bar) =>
        series.maxAbsDelta > 0
          ? alpha(
              bar.delta >= 0 ? theme.up : theme.down,
              0.1 + (Math.abs(bar.delta) / series.maxAbsDelta) * 0.3
            )
          : null
    );
  }
  if (s.showMaxDeltaRow) {
    drawStatRow(
      "Δ max",
      (bar) => fmtSignedCompact(maxCellDelta(bar)),
      () => theme.up,
      (bar) =>
        series.maxAbsDelta > 0
          ? alpha(theme.up, 0.08 + (Math.abs(maxCellDelta(bar)) / series.maxAbsDelta) * 0.3)
          : null
    );
  }
  if (s.showMinDeltaRow) {
    drawStatRow(
      "Δ min",
      (bar) => fmtSignedCompact(minCellDelta(bar)),
      () => theme.down,
      (bar) =>
        series.maxAbsDelta > 0
          ? alpha(theme.down, 0.08 + (Math.abs(minCellDelta(bar)) / series.maxAbsDelta) * 0.3)
          : null
    );
  }
  if (s.showVolumeRow) {
    drawStatRow(
      "Vol",
      (bar) => fmtCompact(bar.volume),
      () => alpha(theme.text, 0.85),
      (bar) =>
        series.maxBarVolume > 0
          ? alpha(theme.muted, 0.06 + (bar.volume / series.maxBarVolume) * 0.22)
          : null
    );
  }

  if (cvdH > 0) {
    const top = footY;
    ctx.fillStyle = alpha(theme.bgSoft, 0.35);
    ctx.fillRect(0, top, plotW + profileW, cvdH);
    ctx.strokeStyle = alpha(theme.line, 0.6);
    ctx.beginPath();
    ctx.moveTo(0, top + 0.5);
    ctx.lineTo(plotW + profileW, top + 0.5);
    ctx.stroke();

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, top, plotW, cvdH);
    ctx.clip();
    for (let i = first; i <= lastVisible; i += 1) {
      const bar = bars[i];
      const x = xOf(i);
      const intensity = maxAbsCvd > 0 ? Math.min(1, Math.abs(bar.cvd) / maxAbsCvd) : 0;
      const base = bar.cvd >= 0 ? theme.up : theme.down;
      ctx.fillStyle = alpha(base, 0.08 + intensity * 0.42);
      ctx.fillRect(x + 1, top + 1, Math.max(1, bw - 2), Math.max(1, cvdH - 2));
      if (bw >= 28) {
        ctx.textAlign = "center";
        ctx.fillStyle = Math.abs(bar.cvd) > 0 ? alpha(theme.text, 0.92) : alpha(theme.muted, 0.8);
        ctx.fillText(fmtSignedCompact(bar.cvd), x + bw / 2, top + cvdH / 2);
      }
    }
    ctx.restore();

    ctx.textAlign = "left";
    ctx.fillStyle = alpha(theme.muted, 0.9);
    ctx.font = `10px ${font}`;
    ctx.fillText("CVD", axisX + 5, top + 9);
    ctx.fillText(fmtSignedCompact(bars[lastIdx].cvd), axisX + 5, top + 22);
    footY += cvdH;
  }

  // ---- time axis --------------------------------------------------------
  ctx.fillStyle = alpha(theme.bgElevated, 0.85);
  ctx.fillRect(0, footY, w, TIME_H);
  ctx.strokeStyle = alpha(theme.line, 0.9);
  ctx.beginPath();
  ctx.moveTo(0, footY + 0.5);
  ctx.lineTo(w, footY + 0.5);
  ctx.stroke();
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, footY, plotW, TIME_H);
  ctx.clip();
  ctx.textAlign = "center";
  ctx.fillStyle = alpha(theme.muted, 0.95);
  ctx.font = `10px ${font}`;
  const timeEvery = Math.max(1, Math.ceil(58 / bw));
  for (let i = first; i <= lastVisible; i += 1) {
    if (i % timeEvery !== 0) continue;
    ctx.fillText(fmtClock(bars[i].timeMs, interval), xOf(i) + bw / 2, footY + TIME_H / 2);
  }
  ctx.restore();

  // ---- crosshair --------------------------------------------------------
  if (hover && hover.barIndex >= first && hover.barIndex <= lastVisible) {
    const x = xOf(hover.barIndex);
    ctx.fillStyle = alpha(theme.sense, 0.08);
    ctx.fillRect(x, 0, bw, plotH);
    if (hover.key != null) {
      const y = Math.round(yOf(hover.key)) + 0.5;
      ctx.strokeStyle = alpha(theme.sense, 0.5);
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(plotW, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = alpha(theme.sense, 0.9);
      ctx.fillRect(axisX + 1, y - 7, AXIS_W - 2, 14);
      ctx.fillStyle = theme.bg;
      ctx.font = `600 10px ${font}`;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText((hover.key * series.step).toFixed(priceDigits), axisX + 5, y);
    }
  }
}
