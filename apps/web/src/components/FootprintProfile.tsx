"use client";

import { useEffect, useMemo, useRef } from "react";
import { useThemeRevision } from "@/lib/theme";
import {
  aggregateFootprint,
  fmtV,
  DEFAULT_FP_VIZ,
  type FootprintData,
  type FpVizSettings,
} from "@/components/FootprintChart";

function hexAlpha(hex: string, alpha: number): string {
  const raw = hex.replace("#", "").trim();
  if (raw.length !== 6) return hex;
  const a = Math.round(Math.min(1, Math.max(0, alpha)) * 255)
    .toString(16)
    .padStart(2, "0");
  return `#${raw}${a}`;
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
    chartBg: g("--chart-bg", "#060a12"),
    font: g("--font-body", '"IBM Plex Sans", sans-serif'),
  };
}

function fmtSigned(n: number) {
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  return `${sign}${fmtV(Math.abs(n))}`;
}

export function FootprintProfile({
  data,
  viz,
  priceDigits = 2,
}: {
  data: FootprintData;
  viz?: Partial<FpVizSettings>;
  priceDigits?: number;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const themeRev = useThemeRevision();
  const settings = { ...DEFAULT_FP_VIZ, ...viz };
  const profile = useMemo(
    () => aggregateFootprint(data, settings.tickGroup),
    [data, settings.tickGroup]
  );

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const draw = () => {
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
      const theme = readTheme();
      const rows = profile.rows;
      if (!rows.length) return;

      const leftPad = 8;
      const rightPad = 62;
      const plotW = Math.max(24, w - leftPad - rightPad);
      const midX = leftPad + plotW / 2;
      const lo = rows[0].price;
      const hi = rows[rows.length - 1].price;
      const span = Math.max(profile.tick, hi - lo);
      const priceToY = (px: number) => ((hi - px) / span) * (h - 8) + 4;
      let peak = 0;
      for (const r of rows) peak = Math.max(peak, r.buy, r.sell, r.vol);
      if (peak <= 0) return;
      const gamma = Math.min(1.4, Math.max(0.35, settings.gamma));
      const maxBar = plotW / 2 - 4;

      if (profile.val != null && profile.vah != null) {
        const yHi = priceToY(profile.vah);
        const yLo = priceToY(profile.val);
        const y0 = Math.min(yHi, yLo);
        ctx.fillStyle = hexAlpha(theme.sense, 0.08);
        ctx.fillRect(leftPad, y0, plotW, Math.max(2, Math.abs(yLo - yHi)));
      }

      ctx.strokeStyle = hexAlpha(theme.muted, 0.28);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(midX + 0.5, 0);
      ctx.lineTo(midX + 0.5, h);
      ctx.stroke();

      ctx.font = `650 10px ${theme.font}`;
      ctx.textBaseline = "middle";
      const labelEvery = Math.max(1, Math.ceil(rows.length / Math.max(4, h / 22)));

      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const y = priceToY(r.price);
        const y2 = priceToY(r.price - profile.tick);
        const bandH = Math.max(1.2, Math.abs(y2 - y) * 0.88);
        const buyW = Math.max(1, maxBar * Math.pow(r.buy / peak, gamma));
        const sellW = Math.max(1, maxBar * Math.pow(r.sell / peak, gamma));
        ctx.fillStyle = hexAlpha(theme.down, 0.18 + 0.72 * Math.pow(r.sell / peak, gamma));
        ctx.fillRect(midX - sellW, y - bandH / 2, sellW, bandH);
        ctx.fillStyle = hexAlpha(theme.up, 0.18 + 0.72 * Math.pow(r.buy / peak, gamma));
        ctx.fillRect(midX, y - bandH / 2, buyW, bandH);
        if (settings.poc && profile.poc != null && Math.abs(r.price - profile.poc) < profile.tick / 2) {
          ctx.strokeStyle = hexAlpha(theme.sense, 0.9);
          ctx.lineWidth = 1.3;
          ctx.strokeRect(leftPad + 0.5, y - bandH / 2, plotW - 1, bandH);
        }
        if (i % labelEvery === 0 || r.price === profile.poc) {
          ctx.fillStyle = hexAlpha(theme.muted, r.price === profile.poc ? 0.95 : 0.7);
          ctx.textAlign = "left";
          ctx.fillText(
            r.price.toLocaleString("en-US", {
              minimumFractionDigits: priceDigits,
              maximumFractionDigits: priceDigits,
            }),
            leftPad + plotW + 6,
            y
          );
        }
      }

      const sparkH = 28;
      const sparkY = h - sparkH - 4;
      const deltas: number[] = [];
      let run = 0;
      for (const bar of [...data.bars].sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts))) {
        run += bar.delta || 0;
        deltas.push(run);
      }
      if (deltas.length > 1) {
        let mn = deltas[0];
        let mx = deltas[0];
        for (const v of deltas) {
          mn = Math.min(mn, v);
          mx = Math.max(mx, v);
        }
        const spanCvd = Math.max(1e-9, mx - mn);
        ctx.fillStyle = hexAlpha(theme.chartBg, 0.55);
        ctx.fillRect(leftPad, sparkY, plotW, sparkH);
        ctx.beginPath();
        ctx.strokeStyle = hexAlpha(deltas[deltas.length - 1] >= 0 ? theme.up : theme.down, 0.9);
        ctx.lineWidth = 1.4;
        deltas.forEach((v, i) => {
          const x = leftPad + (i / (deltas.length - 1)) * plotW;
          const y = sparkY + sparkH - 3 - ((v - mn) / spanCvd) * (sparkH - 6);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.stroke();
      }
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [profile, settings.gamma, settings.poc, priceDigits, themeRev, data.bars]);

  if (!data.bars.length) {
    return (
      <div className="fp-profile muted p-6 text-sm">
        Žádná footprint data za zvolené období. Pokud běží sběr tradů, profil se objeví za chvíli.
      </div>
    );
  }

  return (
    <div className="fp-profile">
      <div className="fp-profile__stats">
        <span>
          Vol <b>{fmtV(profile.volume)}</b>
        </span>
        <span className="is-up">
          Buy <b>{fmtV(profile.buy)}</b>
        </span>
        <span className="is-down">
          Sell <b>{fmtV(profile.sell)}</b>
        </span>
        <span className={profile.delta >= 0 ? "is-up" : "is-down"}>
          Δ <b>{fmtSigned(profile.delta)}</b>
        </span>
        <span className={profile.cvd >= 0 ? "is-up" : "is-down"}>
          CVD <b>{fmtSigned(profile.cvd)}</b>
        </span>
        <span>
          POC{" "}
          <b>
            {profile.poc == null
              ? "—"
              : profile.poc.toLocaleString("en-US", {
                  minimumFractionDigits: priceDigits,
                  maximumFractionDigits: priceDigits,
                })}
          </b>
        </span>
        <span>
          VA{" "}
          <b>
            {profile.val == null || profile.vah == null
              ? "—"
              : `${profile.val.toLocaleString("en-US", {
                  minimumFractionDigits: priceDigits,
                  maximumFractionDigits: priceDigits,
                })}–${profile.vah.toLocaleString("en-US", {
                  minimumFractionDigits: priceDigits,
                  maximumFractionDigits: priceDigits,
                })}`}
          </b>
        </span>
      </div>
      <div ref={wrapRef} className="fp-profile__stage">
        <canvas ref={canvasRef} aria-hidden />
      </div>
    </div>
  );
}
