"use client";

import { Tip, HomeData, actionLabel } from "@/lib/types";
import Link from "next/link";

const PALETTE = ["#5dde8a", "#ff6b7a", "#f0c14a", "#6ea8ff"];

type Slice = { key: string; label: string; value: number; color: string };

function buildSlices(
  rows: { key: string; label: string; value: number }[],
  colors = PALETTE
): Slice[] {
  const positive = rows.filter((r) => r.value > 0);
  return positive.map((r, i) => ({
    ...r,
    color: colors[i % colors.length],
  }));
}

function Donut({
  slices,
  size = 160,
  thickness = 22,
  centerLabel,
  centerSub,
}: {
  slices: Slice[];
  size?: number;
  thickness?: number;
  centerLabel: string;
  centerSub?: string;
}) {
  const total = slices.reduce((s, x) => s + x.value, 0) || 1;
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;

  return (
    <div className="home-donut">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--line)"
          strokeWidth={thickness}
          opacity={0.45}
        />
        {slices.map((slice) => {
          const len = (slice.value / total) * c;
          const el = (
            <circle
              key={slice.key}
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={slice.color}
              strokeWidth={thickness}
              strokeDasharray={`${len} ${c - len}`}
              strokeDashoffset={-offset}
              strokeLinecap="butt"
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
            />
          );
          offset += len;
          return el;
        })}
      </svg>
      <div className="home-donut__center">
        <div className="home-donut__value">{centerLabel}</div>
        {centerSub && <div className="home-donut__sub">{centerSub}</div>}
      </div>
    </div>
  );
}

function Legend({ slices, total }: { slices: Slice[]; total: number }) {
  return (
    <ul className="home-legend">
      {slices.map((s) => {
        const pct = total > 0 ? (s.value / total) * 100 : 0;
        return (
          <li key={s.key}>
            <span className="home-legend__swatch" style={{ background: s.color }} />
            <span className="home-legend__label">{s.label}</span>
            <span className="home-legend__pct">{pct.toFixed(0)}%</span>
          </li>
        );
      })}
    </ul>
  );
}

function TipActionsDonut({ tips }: { tips: Tip[] }) {
  const order = ["long", "short", "hold", "sell"] as const;
  const counts: Record<string, number> = Object.fromEntries(order.map((k) => [k, 0]));
  for (const t of tips) {
    counts[t.action] = (counts[t.action] || 0) + 1;
  }
  const colors = ["#5dde8a", "#ff6b7a", "#f0c14a", "#6ea8ff"];
  const slices = buildSlices(
    order.map((key) => ({
      key,
      label: actionLabel[key],
      value: counts[key] || 0,
    })),
    colors
  );
  const total = slices.reduce((s, x) => s + x.value, 0);

  if (!total) {
    return <p className="muted text-sm">Zatím žádné tipy.</p>;
  }

  return (
    <div className="home-chart-block">
      <Donut slices={slices} centerLabel={String(total)} centerSub="tipů" size={148} />
      <Legend slices={slices} total={total} />
    </div>
  );
}

export function HomeOverview({
  tips,
  alertsUnread,
  briefingCs,
  briefingTitle,
  briefingAt,
  tipStats,
  onGenerateBriefing,
  briefingBusy,
}: {
  tips: Tip[];
  alertsUnread: number;
  briefingCs?: string | null;
  briefingTitle?: string | null;
  briefingAt?: string | null;
  tipStats?: HomeData["tip_stats"];
  onGenerateBriefing?: () => void;
  briefingBusy?: boolean;
}) {
  const hitPct =
    tipStats?.hit_rate != null ? `${(tipStats.hit_rate * 100).toFixed(0)}%` : "—";

  return (
    <section className="home-overview rise space-y-4">
      <div className="card p-4 sm:p-5 home-briefing">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <h3 className="home-chart-title">Sense briefing</h3>
          <div className="flex flex-wrap gap-2">
            {onGenerateBriefing && (
              <button
                type="button"
                className="btn btn-primary text-xs px-2 py-1"
                disabled={briefingBusy}
                onClick={onGenerateBriefing}
              >
                {briefingBusy ? "Generuji…" : "Vygenerovat teď"}
              </button>
            )}
          </div>
        </div>
        {briefingAt && (
          <p className="muted text-xs mb-2">
            Poslední běh: {new Date(briefingAt).toLocaleString("cs-CZ")}
            {briefingTitle ? ` · ${briefingTitle}` : ""}
          </p>
        )}
        {!briefingAt && !briefingCs && (
          <p className="muted text-sm mb-2">Zatím žádný denní Sense — vygeneruj teď nebo počkej na cron 8:30.</p>
        )}
        {briefingCs ? (
          <p className="home-briefing__text">{briefingCs}</p>
        ) : (
          !briefingBusy && <p className="muted text-sm">Briefing bude tady po úspěšném reportu.</p>
        )}
      </div>

      <div className="home-kpi-grid home-kpi-grid--tips">
        <div className="home-kpi">
          <div className="home-kpi__label">Hit-rate tipů</div>
          <Link href="/tips" className="home-kpi__value block hover:opacity-90">
            {hitPct}
            <span className="home-kpi__suffix">
              {tipStats?.total
                ? `${tipStats.hits}/${tipStats.total}${
                    tipStats.tp_hits != null || tipStats.sl_hits != null
                      ? ` · TP ${tipStats.tp_hits ?? 0}/SL ${tipStats.sl_hits ?? 0}`
                      : ""
                  }`
                : "dej feedback"}
            </span>
          </Link>
        </div>
        <div className="home-kpi">
          <div className="home-kpi__label">Tipy / alerty</div>
          <div className="home-kpi__value">
            {tips.length}
            <span className="home-kpi__suffix">
              {alertsUnread > 0 ? `${alertsUnread} nových` : "dnes"}
            </span>
          </div>
        </div>
      </div>

      <div className="card p-4 sm:p-5">
        <h3 className="home-chart-title">Tipy podle akce</h3>
        <div className="mt-3">
          <TipActionsDonut tips={tips} />
        </div>
      </div>
    </section>
  );
}
