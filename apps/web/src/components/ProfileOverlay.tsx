"use client";

import { useEffect, useMemo, useRef } from "react";
import type { IChartApi, ISeriesApi, Time } from "lightweight-charts";
import type { ChartBar } from "@/components/PriceChart";
import {
  aggregateProfile,
  alpha,
  buildOrderflow,
  buildTpoProfile,
  formatSessionLabel,
  isPeriodicProfile,
  profileUsesRightColumn,
  readOrderflowTheme,
  splitProfileSessions,
  type FootprintData,
  type OrderflowSeries,
  type OrderflowSettings,
  type OrderflowTheme,
  type ProfileRange,
  type VolumeProfileSettings,
} from "@/lib/orderflow";
import { useThemeRevision } from "@/lib/theme";

type Props = {
  chart: IChartApi | null;
  series: ISeriesApi<"Candlestick"> | null;
  wrap: HTMLDivElement | null;
  bars: ChartBar[];
  footprint: FootprintData | null;
  settings: VolumeProfileSettings;
  /** Dedicated TPO chart — letters and TPO tick size stay on footprint settings. */
  tpoSettings?: OrderflowSettings;
  priceDigits?: number;
  /** Histogram on the right of a candle/footprint chart — skip TPO letters. */
  overlay?: boolean;
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

export function ProfileOverlay({
  chart,
  series,
  wrap,
  bars,
  footprint,
  settings,
  tpoSettings,
  priceDigits = 2,
  overlay = false,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef(0);
  const themeRef = useRef<OrderflowTheme | null>(null);
  const themeRevRef = useRef(-1);
  const themeRev = useThemeRevision();

  const vpStep = Math.max(
    1e-9,
    (footprint?.tick && footprint.tick > 0 ? footprint.tick : 0.01) * Math.max(1, settings.tickGroup)
  );
  const tpoStep = Math.max(
    1e-9,
    (footprint?.tick && footprint.tick > 0 ? footprint.tick : 0.01) *
      Math.max(1, tpoSettings?.tickGroup ?? settings.tickGroup)
  );

  const tpo = useMemo(() => {
    const src = footprint?.bars?.length
      ? footprint.bars.map((bar) => ({
          ts: bar.ts,
          high: bar.high,
          low: bar.low,
          volume: bar.volume,
          levels: bar.levels,
        }))
      : bars.map((bar) => ({
          ts: bar.ts,
          high: bar.high,
          low: bar.low,
          volume: bar.volume,
        }));
    return buildTpoProfile(src, overlay ? vpStep : tpoStep, tpoSettings?.tpoBlockMinutes ?? 30);
  }, [bars, footprint, overlay, tpoSettings?.tpoBlockMinutes, tpoStep, vpStep]);

  const volumeProfile = useMemo(() => {
    if (!footprint?.bars?.length) return null;
    if (!overlay && !settings.showHistogram) return null;
    const seriesData = buildOrderflow(footprint.bars, footprint.tick, {
      tickGroup: settings.tickGroup,
      imbalance: false,
      imbalanceRatio: 300,
      imbalanceMinVolume: 0,
      stacked: false,
      stackedMin: 2,
      fade: false,
      absorption: false,
      absorptionRatio: 0.35,
      valueArea: true,
      valueAreaPct: settings.valueAreaPct,
    });
    if (!seriesData.bars.length) return null;
    return seriesData;
  }, [footprint, overlay, settings]);

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
        themeRef.current = readOrderflowTheme();
        themeRevRef.current = themeRev;
      }
      drawProfile(
        ctx,
        chart,
        series,
        tpo,
        volumeProfile,
        settings,
        themeRef.current,
        w,
        h,
        priceDigits,
        tpoSettings,
        overlay
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
  }, [chart, overlay, priceDigits, series, settings, themeRev, tpo, tpoSettings, volumeProfile, wrap]);

  return (
    <canvas
      ref={canvasRef}
      className="profile-overlay"
      style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 14 }}
    />
  );
}

function timeMsToX(
  ts: { timeToCoordinate: (time: Time) => number | null },
  timeMs: number,
  bars: { timeMs: number }[]
): number | null {
  const direct = ts.timeToCoordinate(Math.floor(timeMs / 1000) as Time);
  if (direct != null) return direct;
  if (!bars.length) return null;
  if (bars.length === 1) return ts.timeToCoordinate(Math.floor(bars[0].timeMs / 1000) as Time);
  let lo = 0;
  let hi = bars.length - 1;
  if (timeMs <= bars[0].timeMs) {
    hi = 1;
  } else if (timeMs >= bars[hi].timeMs) {
    lo = hi - 1;
  } else {
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (bars[mid].timeMs <= timeMs) lo = mid;
      else hi = mid;
    }
  }
  const x0 = ts.timeToCoordinate(Math.floor(bars[lo].timeMs / 1000) as Time);
  const x1 = ts.timeToCoordinate(Math.floor(bars[hi].timeMs / 1000) as Time);
  if (x0 == null || x1 == null) return x0 ?? x1;
  const dt = bars[hi].timeMs - bars[lo].timeMs;
  if (!(dt > 0)) return x0;
  return x0 + ((x1 - x0) / dt) * (timeMs - bars[lo].timeMs);
}
  const v = custom?.trim();
  return v ? v : fallback;
}

type VpPaint = { up: string; down: string; poc: string; va: string };

function vpPaint(settings: VolumeProfileSettings, theme: OrderflowTheme): VpPaint {
  return {
    up: pickColor(settings.upColor, theme.up),
    down: pickColor(settings.downColor, theme.down),
    poc: pickColor(settings.pocColor, theme.sense),
    va: pickColor(settings.vaColor, theme.sense),
  };
}

function drawProfile(
  ctx: CanvasRenderingContext2D,
  chart: IChartApi,
  series: ISeriesApi<"Candlestick">,
  tpo: ReturnType<typeof buildTpoProfile>,
  volumeSeries: OrderflowSeries | null,
  settings: VolumeProfileSettings,
  theme: OrderflowTheme,
  w: number,
  h: number,
  priceDigits: number,
  tpoSettings: OrderflowSettings | undefined,
  overlay: boolean
) {
  ctx.clearRect(0, 0, w, h);
  const axisPad = 62;
  const rangeMode = settings.profileRange ?? "visible";
  const periodic = isPeriodicProfile(rangeMode);
  const showRight = (overlay || settings.showHistogram) && profileUsesRightColumn(rangeMode);
  const vpW = showRight ? Math.max(48, Math.min(settings.profileWidth, w * 0.22)) : 0;
  const plotRight = w - axisPad - vpW - (vpW ? 6 : 0);
  const ts = chart.timeScale();
  const range = ts.getVisibleLogicalRange();
  const yOfTpo = (key: number) => series.priceToCoordinate(key * tpo.step);
  const paint = vpPaint(settings, theme);

  if (periodic && volumeSeries?.bars.length && (overlay || settings.showHistogram)) {
    drawSessionProfiles(
      ctx,
      chart,
      series,
      volumeSeries,
      settings,
      theme,
      paint,
      h,
      priceDigits,
      rangeMode
    );
  }

  let from = 0;
  let to = (volumeSeries?.bars.length ?? 1) - 1;
  if (rangeMode !== "all" && range && volumeSeries?.bars.length) {
    from = Math.max(0, Math.floor(range.from));
    to = Math.min(volumeSeries.bars.length - 1, Math.ceil(range.to));
  }
  const volumeProfile =
    !periodic && volumeSeries && volumeSeries.bars.length
      ? aggregateProfile(
          volumeSeries.bars,
          from,
          to,
          volumeSeries.step,
          volumeSeries.digits,
          settings.valueAreaPct
        )
      : null;

  if (!overlay && tpoSettings?.showValueArea && tpo.vahKey != null && tpo.valKey != null) {
    const yTop = yOfTpo(tpo.vahKey);
    const yBot = yOfTpo(tpo.valKey);
    if (yTop != null && yBot != null) {
      const top = Math.min(yTop, yBot);
      const bot = Math.max(yTop, yBot);
      ctx.fillStyle = alpha(theme.sense, 0.07);
      ctx.fillRect(0, top, plotRight, Math.max(1, bot - top));
      ctx.strokeStyle = alpha(theme.sense, 0.28);
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(0, Math.round(yTop) + 0.5);
      ctx.lineTo(plotRight, Math.round(yTop) + 0.5);
      ctx.moveTo(0, Math.round(yBot) + 0.5);
      ctx.lineTo(plotRight, Math.round(yBot) + 0.5);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  if (!overlay && tpoSettings?.showTpo && tpo.periods.length) {
    const letterW = Math.max(8, Math.min(16, (tpoSettings.rowHeight ?? 15) - 1));
    const letterH = Math.max(8, Math.min(16, tpoSettings.rowHeight ?? 15));
    ctx.font = `600 ${Math.max(8, letterH - 4)}px ${theme.font}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    for (const period of tpo.periods) {
      const x0 =
        ts.timeToCoordinate(Math.floor(period.startMs / 1000) as Time) ??
        ts.timeToCoordinate(Math.floor(period.endMs / 1000) as Time);
      if (x0 == null || x0 < -40 || x0 > plotRight + 40) continue;
      const x1 =
        ts.timeToCoordinate(Math.floor(period.endMs / 1000) as Time) ?? x0 + letterW;
      const colW = Math.max(letterW, Math.min(28, Math.abs(x1 - x0) || letterW));
      const x = x0;
      for (const key of period.keys) {
        const y = yOfTpo(key);
        if (y == null || y < -12 || y > h + 12) continue;
        const poc = key === tpo.pocKey;
        const inVa =
          tpo.vahKey != null && tpo.valKey != null && key <= Math.max(tpo.vahKey, tpo.valKey) && key >= Math.min(tpo.vahKey, tpo.valKey);
        ctx.fillStyle = poc
          ? alpha(theme.sense, 0.88)
          : inVa
            ? alpha(theme.up, 0.22)
            : alpha(theme.bgElevated, 0.72);
        ctx.fillRect(x, y - letterH / 2, colW - 1, letterH - 1);
        ctx.fillStyle = poc ? theme.bg : alpha(theme.text, 0.88);
        if (colW >= 10) ctx.fillText(period.letter, x + (colW - 1) / 2, y);
      }
    }
  }

  if (!overlay && tpoSettings?.showPoc && tpo.pocKey != null) {
    const y = yOfTpo(tpo.pocKey);
    if (y != null) {
      ctx.strokeStyle = alpha(theme.sense, 0.85);
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(0, Math.round(y) + 0.5);
      ctx.lineTo(plotRight, Math.round(y) + 0.5);
      ctx.stroke();
    }
  }

  if (vpW > 0) {
    const x0 = plotRight + 4;
    ctx.fillStyle = alpha(theme.bgSoft, 0.45);
    ctx.fillRect(x0, 0, vpW, h);
    ctx.strokeStyle = alpha(theme.line, 0.7);
    ctx.beginPath();
    ctx.moveTo(x0 + 0.5, 0);
    ctx.lineTo(x0 + 0.5, h);
    ctx.stroke();

    const rows =
      volumeProfile && volumeProfile.maxVolume > 0
        ? volumeProfile.rows.map((row) => ({
            key: row.key,
            price: row.price,
            buy: row.buy,
            sell: row.sell,
            volume: row.volume,
            max: volumeProfile.maxVolume,
          }))
        : [...tpo.counts.entries()].map(([key, count]) => ({
            key,
            price: key * tpo.step,
            buy: count,
            sell: 0,
            volume: count,
            max: tpo.maxTpo || 1,
          }));
    const max = rows.reduce((acc, row) => Math.max(acc, row.volume), 0) || 1;
    const maxW = vpW - 10;
    const bandH = Math.max(2, Math.min(14, settings.rowHeight * 0.7));

    if (settings.showValueArea && volumeProfile?.vah != null && volumeProfile.val != null) {
      const yTop = series.priceToCoordinate(volumeProfile.vah);
      const yBot = series.priceToCoordinate(volumeProfile.val);
      if (yTop != null && yBot != null) {
        ctx.fillStyle = alpha(paint.va, 0.1);
        ctx.fillRect(x0, Math.min(yTop, yBot), vpW, Math.abs(yBot - yTop));
      }
    }

    for (const row of rows) {
      const y = series.priceToCoordinate(row.price);
      if (y == null || y < -12 || y > h + 12) continue;
      const total = (row.volume / max) * maxW;
      const sellW = row.volume > 0 ? (row.sell / row.volume) * total : 0;
      ctx.fillStyle = alpha(paint.down, 0.5);
      ctx.fillRect(x0 + 5, y - bandH / 2, sellW, bandH);
      ctx.fillStyle = alpha(paint.up, 0.55);
      ctx.fillRect(x0 + 5 + sellW, y - bandH / 2, Math.max(0, total - sellW), bandH);
    }

    const pocPrice =
      settings.showPoc
        ? volumeProfile?.poc ?? (tpo.pocKey != null ? tpo.pocKey * tpo.step : null)
        : null;
    if (pocPrice != null) {
      const y = series.priceToCoordinate(pocPrice);
      if (y != null) {
        ctx.strokeStyle = alpha(paint.poc, 0.95);
        ctx.beginPath();
        ctx.moveTo(x0, Math.round(y) + 0.5);
        ctx.lineTo(x0 + vpW, Math.round(y) + 0.5);
        ctx.stroke();
        ctx.fillStyle = alpha(theme.text, 0.8);
        ctx.font = `10px ${theme.font}`;
        ctx.textAlign = "left";
        ctx.textBaseline = "bottom";
        ctx.fillText("POC", x0 + 6, y - 2);
      }
    }

    ctx.fillStyle = alpha(theme.muted, 0.85);
    ctx.font = `10px ${theme.font}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText("VP", x0 + vpW / 2, 4);
    if (pocPrice != null) {
      ctx.textAlign = "left";
      ctx.fillText(pocPrice.toFixed(priceDigits), x0 + 6, h - 16);
    }
  }
}

function drawSessionProfiles(
  ctx: CanvasRenderingContext2D,
  chart: IChartApi,
  series: ISeriesApi<"Candlestick">,
  volumeSeries: OrderflowSeries,
  settings: VolumeProfileSettings,
  theme: OrderflowTheme,
  paint: VpPaint,
  h: number,
  priceDigits: number,
  rangeMode: ProfileRange
) {
  const ts = chart.timeScale();
  const vis = ts.getVisibleLogicalRange();
  const visFrom = vis ? Math.floor(vis.from) : 0;
  const visTo = vis ? Math.ceil(vis.to) : volumeSeries.bars.length - 1;
  const sessions = splitProfileSessions(
    volumeSeries.bars,
    rangeMode,
    settings.profileSessionMinutes
  );
  const bandH = Math.max(2, Math.min(14, settings.rowHeight * 0.7));
  let drawn = 0;
  for (const session of sessions) {
    if (session.to < visFrom - 2 || session.from > visTo + 2) continue;
    if (drawn >= 80) break;
    const left = timeMsToX(ts, session.startMs, volumeSeries.bars);
    const right = timeMsToX(ts, session.endMs, volumeSeries.bars);
    if (left == null && right == null) continue;
    const sessionLeft = left ?? (right as number) - 24;
    const sessionRight = right ?? (left as number) + 24;
    const span = sessionRight - sessionLeft;
    if (span < 10) continue;
    const profile = aggregateProfile(
      volumeSeries.bars,
      session.from,
      session.to,
      volumeSeries.step,
      volumeSeries.digits,
      settings.valueAreaPct
    );
    if (!profile.rows.length || profile.maxVolume <= 0) continue;
    drawn += 1;
    const alignRight = (settings.profileAlign ?? "right") === "right";
    const colW = Math.max(12, Math.min(settings.profileWidth, span - 2));
    const x0 = alignRight ? sessionRight - colW : sessionLeft;
    ctx.fillStyle = alpha(theme.bgSoft, 0.22);
    ctx.fillRect(x0, 0, colW, h);
    ctx.strokeStyle = alpha(theme.line, 0.4);
    ctx.beginPath();
    ctx.moveTo(Math.round(sessionLeft) + 0.5, 0);
    ctx.lineTo(Math.round(sessionLeft) + 0.5, h);
    ctx.moveTo(Math.round(sessionRight) + 0.5, 0);
    ctx.lineTo(Math.round(sessionRight) + 0.5, h);
    ctx.stroke();

    if (settings.showValueArea && profile.vah != null && profile.val != null) {
      const yTop = series.priceToCoordinate(profile.vah);
      const yBot = series.priceToCoordinate(profile.val);
      if (yTop != null && yBot != null) {
        ctx.fillStyle = alpha(paint.va, 0.08);
        ctx.fillRect(x0, Math.min(yTop, yBot), colW, Math.abs(yBot - yTop));
      }
    }

    const maxW = colW - 6;
    for (const row of profile.rows) {
      const y = series.priceToCoordinate(row.price);
      if (y == null || y < -12 || y > h + 12) continue;
      const total = (row.volume / profile.maxVolume) * maxW;
      const sellW = row.volume > 0 ? (row.sell / row.volume) * total : 0;
      const origin = alignRight ? x0 + colW - 3 - total : x0 + 3;
      ctx.fillStyle = alpha(paint.down, 0.42);
      ctx.fillRect(origin, y - bandH / 2, sellW, bandH);
      ctx.fillStyle = alpha(paint.up, 0.5);
      ctx.fillRect(origin + sellW, y - bandH / 2, Math.max(0, total - sellW), bandH);
    }

    if (settings.showPoc && profile.poc != null) {
      const y = series.priceToCoordinate(profile.poc);
      if (y != null) {
        ctx.strokeStyle = alpha(paint.poc, 0.85);
        ctx.beginPath();
        ctx.moveTo(x0, Math.round(y) + 0.5);
        ctx.lineTo(x0 + colW, Math.round(y) + 0.5);
        ctx.stroke();
        if (colW >= 40) {
          ctx.fillStyle = alpha(theme.text, 0.75);
          ctx.font = `10px ${theme.font}`;
          ctx.textAlign = alignRight ? "right" : "left";
          ctx.textBaseline = "bottom";
          ctx.fillText(
            profile.poc.toFixed(priceDigits),
            alignRight ? x0 + colW - 4 : x0 + 4,
            y - 2
          );
        }
      }
    }

    if (colW >= 28) {
      ctx.fillStyle = alpha(theme.muted, 0.8);
      ctx.font = `10px ${theme.font}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(formatSessionLabel(session.startMs, rangeMode), x0 + colW / 2, 4);
    }
  }
}
