"use client";

import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
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
  bars: { ts: string; close: number; volume: number }[];
  filings: { form: string; filing_date: string }[];
  tip: Tip | null;
}

export default function InstrumentPage() {
  const params = useParams<{ symbol: string }>();
  const symbol = decodeURIComponent(params.symbol);
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedbackBusy, setFeedbackBusy] = useState(false);

  useEffect(() => {
    apiFetch<Detail>(`/instruments/${encodeURIComponent(symbol)}`)
      .then(setData)
      .catch((err) => setError(err.message));
  }, [symbol]);

  const spark = useMemo(() => {
    const closes = data?.bars.map((b) => b.close) || [];
    if (closes.length < 2) return null;
    const min = Math.min(...closes);
    const max = Math.max(...closes);
    const w = 320;
    const h = 80;
    const pts = closes
      .map((c, i) => {
        const x = (i / (closes.length - 1)) * w;
        const y = h - ((c - min) / (max - min || 1)) * h;
        return `${x},${y}`;
      })
      .join(" ");
    return { pts, w, h };
  }, [data]);

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

  if (error) return <div className="card p-4 text-[var(--danger)]">{error}</div>;
  if (!data) return <div className="muted">Načítám {symbol}…</div>;

  const ch = data.quote.change_pct;

  return (
    <div className="space-y-6">
      <section className="rise">
        <p className="muted text-sm">{data.instrument.asset_class} · {data.quote.source} · DQ {data.quote.data_quality}</p>
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
        {spark && (
          <svg viewBox={`0 0 ${spark.w} ${spark.h}`} className="mt-4 w-full max-w-xl h-20">
            <polyline fill="none" stroke="var(--accent)" strokeWidth="2" points={spark.pts} />
          </svg>
        )}
      </section>

      {data.tip && (
        <section className="card p-5 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="display text-2xl">Aktivní tip</h2>
            <span className={`badge ${data.tip.action}`}>{actionLabel[data.tip.action]}</span>
            <span className="badge">{horizonLabel[data.tip.horizon]}</span>
          </div>
          <p className="text-sm">Score {data.tip.score} · confidence {(data.tip.confidence * 100).toFixed(0)}%</p>
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
            <button className="btn" disabled={feedbackBusy} onClick={() => sendFeedback("hit")}>Tip vyšel</button>
            <button className="btn" disabled={feedbackBusy} onClick={() => sendFeedback("partial")}>Částečně</button>
            <button className="btn" disabled={feedbackBusy} onClick={() => sendFeedback("miss")}>Nevyšel</button>
          </div>
        </section>
      )}

      <section className="card p-5">
        <h2 className="display text-2xl mb-3">Fundament</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          {Object.entries(data.quote.fundamentals || {}).map(([k, v]) => (
            <div key={k} className="rounded-xl border border-[var(--line)] p-3">
              <div className="muted text-xs">{k}</div>
              <div className="font-medium">{typeof v === "number" ? Number(v).toPrecision(4) : String(v)}</div>
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
              <li key={`${f.form}-${f.filing_date}-${i}`} className="flex justify-between border-b border-[var(--line)] py-2">
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
