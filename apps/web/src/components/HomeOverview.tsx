"use client";

import { PortfolioPosition, Tip, HomeData } from "@/lib/types";
import Link from "next/link";

const PALETTE = ["#5dde8a", "#6ea8ff", "#f0c14a", "#ff6b7a", "#9b8cff", "#4fd1c5", "#f6ad55"];

const ASSET_LABEL: Record<string, string> = {
  stock: "Akcie",
  etf: "ETF",
  crypto: "Crypto",
  commodity: "Komodity",
  index: "Indexy",
  other: "Ostatní",
};

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

function PnlBars({ positions }: { positions: PortfolioPosition[] }) {
  const rows = positions
    .map((p) => ({
      symbol: p.instrument.symbol,
      pnl: p.pnl ?? 0,
      pct: p.pnl_pct ?? 0,
    }))
    .sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl))
    .slice(0, 8);

  const maxAbs = Math.max(...rows.map((r) => Math.abs(r.pnl)), 1);

  if (!rows.length) {
    return <p className="muted text-sm">Žádné pozice pro PnL graf.</p>;
  }

  return (
    <div className="home-pnl-bars">
      {rows.map((r) => {
        const width = Math.max(4, (Math.abs(r.pnl) / maxAbs) * 100);
        const positive = r.pnl >= 0;
        return (
          <div key={r.symbol} className="home-pnl-bars__row">
            <span className="home-pnl-bars__sym">{r.symbol}</span>
            <div className="home-pnl-bars__track">
              <div
                className={`home-pnl-bars__fill ${positive ? "is-up" : "is-down"}`}
                style={{ width: `${width}%` }}
              />
            </div>
            <span className={positive ? "text-[var(--ok)]" : "text-[var(--danger)]"}>
              {positive ? "+" : ""}
              {r.pct.toFixed(1)}%
            </span>
          </div>
        );
      })}
    </div>
  );
}

function TipActionsDonut({ tips }: { tips: Tip[] }) {
  const counts: Record<string, number> = {};
  for (const t of tips) {
    counts[t.action] = (counts[t.action] || 0) + 1;
  }
  const labels: Record<string, string> = {
    buy: "Nákup",
    sell: "Prodej",
    hold: "Držet",
    trade: "Trade",
  };
  const colors = ["#5dde8a", "#ff6b7a", "#6ea8ff", "#f0c14a"];
  const slices = buildSlices(
    Object.entries(counts).map(([key, value]) => ({
      key,
      label: labels[key] || key,
      value,
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

function EquitySpark({
  points,
}: {
  points: { as_of: string; total_value: number; pnl: number; pnl_pct?: number | null }[];
}) {
  if (points.length < 2) {
    return <p className="muted text-sm">Equity křivka se naplní po denních snapshotech (cron 21:05).</p>;
  }
  const vals = points.map((p) => p.total_value);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = Math.max(max - min, 1);
  const w = 320;
  const h = 90;
  const path = points
    .map((p, i) => {
      const x = (i / (points.length - 1)) * w;
      const y = h - ((p.total_value - min) / span) * (h - 8) - 4;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const last = points[points.length - 1];
  const up = (last.pnl ?? 0) >= 0;

  return (
    <div className="home-equity">
      <svg viewBox={`0 0 ${w} ${h}`} className="home-equity__svg" preserveAspectRatio="none">
        <path d={path} fill="none" stroke={up ? "var(--ok)" : "var(--danger)"} strokeWidth="2.2" />
      </svg>
      <div className="home-equity__meta">
        <span>{points[0].as_of}</span>
        <span className={up ? "text-[var(--ok)]" : "text-[var(--danger)]"}>
          {last.total_value.toLocaleString("cs-CZ", { maximumFractionDigits: 0 })}
          {last.pnl_pct != null ? ` (${last.pnl_pct >= 0 ? "+" : ""}${last.pnl_pct.toFixed(1)}%)` : ""}
        </span>
        <span>{last.as_of}</span>
      </div>
    </div>
  );
}

export function HomeOverview({
  portfolio,
  tips,
  alertsUnread,
  briefingCs,
  briefingTitle,
  briefingAt,
  tipStats,
  equity,
  onGenerateBriefing,
  briefingBusy,
}: {
  portfolio: PortfolioPosition[];
  tips: Tip[];
  alertsUnread: number;
  briefingCs?: string | null;
  briefingTitle?: string | null;
  briefingAt?: string | null;
  tipStats?: HomeData["tip_stats"];
  equity?: HomeData["equity"];
  onGenerateBriefing?: () => void;
  briefingBusy?: boolean;
}) {
  const values = portfolio.map((p) => ({
    p,
    mv: p.market_value ?? Number(p.quantity) * Number(p.avg_cost || 0),
    pnl: p.pnl ?? 0,
  }));
  const totalMv = values.reduce((s, x) => s + (x.mv || 0), 0);
  const totalPnl = values.reduce((s, x) => s + x.pnl, 0);
  const totalCost = values.reduce(
    (s, x) => s + Number(x.p.quantity) * Number(x.p.avg_cost || 0),
    0
  );
  const pnlPct = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0;

  const byClass = new Map<string, number>();
  for (const { p, mv } of values) {
    const cls = p.instrument.asset_class || "other";
    byClass.set(cls, (byClass.get(cls) || 0) + (mv || 0));
  }
  const classSlices = buildSlices(
    [...byClass.entries()].map(([key, value]) => ({
      key,
      label: ASSET_LABEL[key] || key,
      value,
    }))
  );

  const bySymbol = buildSlices(
    values
      .map(({ p, mv }) => ({
        key: p.instrument.symbol,
        label: p.instrument.symbol,
        value: mv || 0,
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6)
  );

  const winners = values.filter((x) => x.pnl > 0).length;
  const losers = values.filter((x) => x.pnl < 0).length;
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

      <div className="home-kpi-grid">
        <div className="home-kpi">
          <div className="home-kpi__label">Hodnota</div>
          <div className="home-kpi__value">{totalMv.toLocaleString("cs-CZ", { maximumFractionDigits: 0 })}</div>
        </div>
        <div className="home-kpi">
          <div className="home-kpi__label">PnL</div>
          <div className={`home-kpi__value ${totalPnl >= 0 ? "is-up" : "is-down"}`}>
            {totalPnl >= 0 ? "+" : ""}
            {totalPnl.toLocaleString("cs-CZ", { maximumFractionDigits: 0 })}
            <span className="home-kpi__suffix">({pnlPct >= 0 ? "+" : ""}
            {pnlPct.toFixed(1)}%)</span>
          </div>
        </div>
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
              {alertsUnread > 0 ? `${alertsUnread} nových` : `${winners}↑ ${losers}↓`}
            </span>
          </div>
        </div>
      </div>

      <div className="card p-4 sm:p-5">
        <h3 className="home-chart-title">Equity křivka</h3>
        <div className="mt-3">
          <EquitySpark points={equity || []} />
        </div>
      </div>

      <div className="home-charts-grid">
        <div className="card p-4 sm:p-5">
          <h3 className="home-chart-title">Alokace tříd</h3>
          {classSlices.length === 0 ? (
            <p className="muted text-sm mt-3">Doplň portfolio pro koláčový přehled.</p>
          ) : (
            <div className="home-chart-block mt-3">
              <Donut
                slices={classSlices}
                centerLabel={totalMv ? totalMv.toLocaleString("cs-CZ", { notation: "compact" }) : "0"}
                centerSub="MV"
              />
              <Legend slices={classSlices} total={totalMv} />
            </div>
          )}
        </div>

        <div className="card p-4 sm:p-5">
          <h3 className="home-chart-title">Pozice (top)</h3>
          {bySymbol.length === 0 ? (
            <p className="muted text-sm mt-3">Zatím bez vážených pozic.</p>
          ) : (
            <div className="home-chart-block mt-3">
              <Donut
                slices={bySymbol}
                centerLabel={`${bySymbol.length}`}
                centerSub="symbolů"
                size={148}
              />
              <Legend slices={bySymbol} total={bySymbol.reduce((s, x) => s + x.value, 0)} />
            </div>
          )}
        </div>

        <div className="card p-4 sm:p-5">
          <h3 className="home-chart-title">PnL podle tickeru</h3>
          <div className="mt-3">
            <PnlBars positions={portfolio} />
          </div>
        </div>

        <div className="card p-4 sm:p-5">
          <h3 className="home-chart-title">Tipy podle akce</h3>
          <div className="mt-3">
            <TipActionsDonut tips={tips} />
          </div>
        </div>
      </div>
    </section>
  );
}
