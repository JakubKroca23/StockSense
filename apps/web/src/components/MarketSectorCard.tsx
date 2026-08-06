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

function fmtPct(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

export function MarketSectorCard({
  sector,
  aiPending = false,
}: {
  sector: MarketSector;
  aiPending?: boolean;
}) {
  const biasClass = BIAS_CLASS[sector.bias] || "";
  const avgClass =
    sector.avg_change_pct != null && sector.avg_change_pct >= 0
      ? "is-up"
      : sector.avg_change_pct != null
        ? "is-down"
        : "";

  return (
    <article className="card market-sector">
      <div className="market-sector__head">
        <div>
          <h2 className="market-sector__title">{sector.label}</h2>
          <p className={`market-sector__bias ${biasClass}`}>{sector.bias_label}</p>
        </div>
        <div className="market-sector__head-right">
          <span className={`market-sector__avg ${avgClass}`}>{fmtPct(sector.avg_change_pct)}</span>
          {sector.href ? (
            <Link href={sector.href} className="market-sector__link">
              Otevřít →
            </Link>
          ) : null}
        </div>
      </div>
      <p className="market-sector__summary">{sector.summary}</p>
      {aiPending && (
        <p className="market-sector__ai-pending">Generuji AI souhrn…</p>
      )}
      {sector.summary_source === "llm" && !aiPending && (
        <p className="market-sector__ai-tag">AI · Gemini</p>
      )}

      <div className="market-sector__chart">
        <div className="home-chart-title mb-2">{sector.chart_symbol} · denní</div>
        {sector.spark.length > 0 ? (
          <PriceChart bars={sector.spark} height={168} showMa={false} />
        ) : (
          <p className="muted text-sm">Graf není dostupný</p>
        )}
      </div>

      <ul className="market-sector__benches">
        {sector.benchmarks.map((b) => (
          <li key={b.symbol}>
            <span className="market-sector__bench-name">{b.name}</span>
            <span className="market-sector__bench-sym muted">{b.symbol}</span>
            <span
              className={`market-sector__bench-pct ${
                b.change_pct != null && b.change_pct >= 0
                  ? "is-up"
                  : b.change_pct != null
                    ? "is-down"
                    : ""
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
