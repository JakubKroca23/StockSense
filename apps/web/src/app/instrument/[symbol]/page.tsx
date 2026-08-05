"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { PriceChart, ChartBar } from "@/components/PriceChart";
import { Tip, actionLabel, horizonLabel } from "@/lib/types";

interface Detail {
  instrument: { symbol: string; name: string; asset_class: string };
  quote: {
    price: number | null;
    change_pct: number | null;
    source: string;
    data_quality: string;
    fundamentals: Record<string, number | string | null>;
  };
  bars: ChartBar[];
  filings: { form: string; filing_date: string }[];
  tip: Tip | null;
}

const RANGES = [
  { id: "1mo", label: "1M" },
  { id: "3mo", label: "3M" },
  { id: "6mo", label: "6M" },
  { id: "1y", label: "1R" },
  { id: "2y", label: "2R" },
  { id: "5y", label: "5R" },
] as const;

export default function InstrumentPage() {
  const params = useParams<{ symbol: string }>();
  const symbol = decodeURIComponent(params.symbol);
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedbackBusy, setFeedbackBusy] = useState(false);
  const [lookback, setLookback] = useState<string>("6mo");
  const [chartBusy, setChartBusy] = useState(false);

  const load = useCallback(
    async (lb: string) => {
      setChartBusy(true);
      try {
        const detail = await apiFetch<Detail>(
          `/instruments/${encodeURIComponent(symbol)}?lookback=${lb}`
        );
        setData(detail);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Chyba načtení");
      } finally {
        setChartBusy(false);
      }
    },
    [symbol]
  );

  useEffect(() => {
    void load(lookback);
  }, [load, lookback]);

  async function sendFeedback(result: "hit" | "miss" | "partial") {
    if (!data?.tip) return;
    setFeedbackBusy(true);
    try {
      await apiFetch(`/tips/${data.tip.id}/feedback`, {
        method: "POST",
        body: JSON.stringify({ result }),
      });
    } finally {
      setFeedbackBusy(false);
    }
  }

  if (error && !data) return <div className="card p-4 text-[var(--danger)]">{error}</div>;
  if (!data) return <div className="muted">Načítám {symbol}…</div>;

  const ch = data.quote.change_pct;

  return (
    <div className="space-y-6">
      <section className="rise">
        <p className="muted text-sm">
          {data.instrument.asset_class} · {data.quote.source} · DQ {data.quote.data_quality}
        </p>
        <h1 className="display text-4xl">{data.instrument.symbol}</h1>
        <p className="muted">{data.instrument.name}</p>
        <div className="mt-3 flex items-end gap-3">
          <div className="text-3xl font-semibold">
            {data.quote.price != null ? data.quote.price.toFixed(2) : "—"}
          </div>
          <div className={ch != null && ch >= 0 ? "text-[var(--ok)]" : "text-[var(--danger)]"}>
            {ch != null ? `${ch >= 0 ? "+" : ""}${ch.toFixed(2)}%` : ""}
          </div>
        </div>
      </section>

      <section className="card p-4 sm:p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="display text-2xl">Graf</h2>
          <div className="flex flex-wrap gap-1">
            {RANGES.map((r) => (
              <button
                key={r.id}
                type="button"
                className={`btn text-xs px-2.5 py-1 ${lookback === r.id ? "btn-primary" : ""}`}
                disabled={chartBusy}
                onClick={() => setLookback(r.id)}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
        {chartBusy && <p className="muted text-sm">Načítám data…</p>}
        <PriceChart bars={data.bars} height={380} />
      </section>

      {data.tip && (
        <section className="card p-5 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="display text-2xl">Aktivní tip</h2>
            <span className={`badge ${data.tip.action}`}>{actionLabel[data.tip.action]}</span>
            <span className="badge">{horizonLabel[data.tip.horizon]}</span>
          </div>
          <p className="text-sm">
            Score {data.tip.score} · confidence {(data.tip.confidence * 100).toFixed(0)}%
          </p>
          {data.tip.narrative_cs && <p className="leading-relaxed">{data.tip.narrative_cs}</p>}
          <div className="grid sm:grid-cols-3 gap-3 text-sm">
            <div className="card p-3">Bull: {data.tip.scenario_bull}</div>
            <div className="card p-3">Base: {data.tip.scenario_base}</div>
            <div className="card p-3">Bear: {data.tip.scenario_bear}</div>
          </div>
          <div className="text-sm muted whitespace-pre-wrap">
            {JSON.stringify(data.tip.rationale, null, 2)}
          </div>
          <p className="text-sm text-[var(--warn)]">{data.tip.risks}</p>
          <div className="flex flex-wrap gap-2">
            <button className="btn" disabled={feedbackBusy} onClick={() => sendFeedback("hit")}>
              Tip vyšel
            </button>
            <button className="btn" disabled={feedbackBusy} onClick={() => sendFeedback("partial")}>
              Částečně
            </button>
            <button className="btn" disabled={feedbackBusy} onClick={() => sendFeedback("miss")}>
              Nevyšel
            </button>
          </div>
        </section>
      )}

      <section className="card p-5">
        <h2 className="display text-2xl mb-3">Fundament</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          {Object.entries(data.quote.fundamentals || {}).map(([k, v]) => (
            <div key={k} className="rounded-xl border border-[var(--line)] p-3">
              <div className="muted text-xs">{k}</div>
              <div className="font-medium">
                {typeof v === "number" ? Number(v).toPrecision(4) : String(v)}
              </div>
            </div>
          ))}
          {Object.keys(data.quote.fundamentals || {}).length === 0 && (
            <p className="muted">Fundamentální data zatím nejsou dostupná.</p>
          )}
        </div>
      </section>

      {data.filings?.length > 0 && (
        <section className="card p-5">
          <h2 className="display text-2xl mb-3">SEC filings</h2>
          <ul className="space-y-2 text-sm">
            {data.filings.map((f, i) => (
              <li
                key={`${f.form}-${f.filing_date}-${i}`}
                className="flex justify-between border-b border-[var(--line)] py-2"
              >
                <span>{f.form}</span>
                <span className="muted">{f.filing_date}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
