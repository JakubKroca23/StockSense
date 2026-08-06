"use client";

import Link from "next/link";
import { PriceChart } from "@/components/PriceChart";
import { MarketSector } from "@/lib/types";

const BIAS_CLASS: Record<string, string> = {
  risk_on: "is-up",
  mild_up: "is-up",
  risk_off: "is-down",
  mild_down: "is-down",
  range: "",
  unknown: "",
};

const SLICE_COLORS = ["#5dde8a", "#5b9cff", "#f0c14b", "#c084fc", "#ff6b7a"];

function fmtPct(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

function CompositionDonut({
  items,
  avgChange,
}: {
  items: MarketSector["composition"];
  avgChange: number | null;
}) {
  const total = items.reduce((s, x) => s + x.value, 0);
  if (!total) return <p className="muted text-sm">Bez dat</p>;

  const size = 120;
  const thickness = 18;
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;

  return (
    <div className="home-chart-block market-sector__donut-block">
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
          {items.map((slice, i) => {
            const len = (slice.value / total) * c;
            const el = (
              <circle
                key={slice.key}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={SLICE_COLORS[i % SLICE_COLORS.length]}
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
          <div className={`home-donut__value ${avgChange != null && avgChange >= 0 ? "is-up" : avgChange != null ? "is-down" : ""}`}>
            {fmtPct(avgChange)}
          </div>
          <div className="home-donut__sub">ø den</div>
        </div>
      </div>
      <ul className="home-legend">
        {items.map((s, i) => (
          <li key={s.key}>
            <span
              className="home-legend__swatch"
              style={{ background: SLICE_COLORS[i % SLICE_COLORS.length] }}
            />
            <span className="home-legend__label">{s.label}</span>
            <span
              className={`home-legend__pct ${
                s.change_pct != null && s.change_pct >= 0 ? "is-up" : s.change_pct != null ? "is-down" : ""
              }`}
            >
              {fmtPct(s.change_pct)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function MarketSectorCard({ sector }: { sector: MarketSector }) {
  const biasClass = BIAS_CLASS[sector.bias] || "";
  const header = (
    <div className="market-sector__head">
      <div>
        <h2 className="market-sector__title">{sector.label}</h2>
        <p className={`market-sector__bias ${biasClass}`}>{sector.bias_label}</p>
      </div>
      {sector.href ? (
        <Link href={sector.href} className="market-sector__link">
          Otevřít →
        </Link>
      ) : null}
    </div>
  );

  return (
    <article className="card market-sector">
      {header}
      <p className="market-sector__summary">{sector.summary}</p>

      <div className="market-sector__body">
        <div className="market-sector__chart">
          <div className="home-chart-title mb-2">
            {sector.chart_symbol} · denní
          </div>
          {sector.spark.length > 0 ? (
            <PriceChart bars={sector.spark} height={168} showMa={false} />
          ) : (
            <p className="muted text-sm">Graf není dostupný</p>
          )}
        </div>
        <CompositionDonut items={sector.composition} avgChange={sector.avg_change_pct} />
      </div>

      <ul className="market-sector__benches">
        {sector.benchmarks.map((b) => (
          <li key={b.symbol}>
            <span className="market-sector__bench-name">{b.name}</span>
            <span className="market-sector__bench-sym muted">{b.symbol}</span>
            <span
              className={`market-sector__bench-pct ${
                b.change_pct != null && b.change_pct >= 0 ? "is-up" : b.change_pct != null ? "is-down" : ""
              }`}
            >
              {fmtPct(b.change_pct)}
            </span>
          </li>
        ))}
      </ul>
    </article>
  );
}
