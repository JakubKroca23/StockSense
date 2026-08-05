"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import { PriceChart, ChartBar, ChartLevel } from "@/components/PriceChart";
import { DataQualityBadge } from "@/components/DataQualityBadge";
import { PortfolioPosition, Tip, TipStatus, actionLabel, horizonLabel, tipStatusLabel } from "@/lib/types";

interface Detail {
  instrument: { symbol: string; name: string; asset_class: string; currency?: string };
  quote: {
    price: number | null;
    change_pct: number | null;
    source: string;
    data_quality: string;
    fundamentals: Record<string, number | string | null>;
  };
  bars: ChartBar[];
  positions?: PortfolioPosition[];
  filings: { form: string; filing_date: string }[];
  tip: Tip | null;
  interval?: string;
  lookback?: string;
}

const TIMEFRAMES = [
  { id: "15m", label: "15m", defaultLookback: "5d" },
  { id: "1h", label: "1H", defaultLookback: "1mo" },
  { id: "4h", label: "4H", defaultLookback: "3mo" },
  { id: "1d", label: "1D", defaultLookback: "6mo" },
  { id: "1wk", label: "1T", defaultLookback: "2y" },
] as const;

const LOOKBACKS_BY_TF: Record<string, { id: string; label: string }[]> = {
  "15m": [
    { id: "5d", label: "5D" },
    { id: "1mo", label: "1M" },
  ],
  "1h": [
    { id: "5d", label: "5D" },
    { id: "1mo", label: "1M" },
    { id: "3mo", label: "3M" },
    { id: "6mo", label: "6M" },
  ],
  "4h": [
    { id: "1mo", label: "1M" },
    { id: "3mo", label: "3M" },
    { id: "6mo", label: "6M" },
    { id: "1y", label: "1R" },
  ],
  "1d": [
    { id: "1mo", label: "1M" },
    { id: "3mo", label: "3M" },
    { id: "6mo", label: "6M" },
    { id: "1y", label: "1R" },
    { id: "2y", label: "2R" },
    { id: "5y", label: "5R" },
  ],
  "1wk": [
    { id: "1y", label: "1R" },
    { id: "2y", label: "2R" },
    { id: "5y", label: "5R" },
  ],
};

export default function InstrumentPage() {
  const params = useParams<{ symbol: string }>();
  const symbol = decodeURIComponent(params.symbol);
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedbackBusy, setFeedbackBusy] = useState(false);
  const [timeframe, setTimeframe] = useState<string>("1d");
  const [lookback, setLookback] = useState<string>("6mo");
  const [chartBusy, setChartBusy] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  const load = useCallback(
    async (iv: string, lb: string) => {
      setChartBusy(true);
      try {
        const detail = await apiFetch<Detail>(
          `/instruments/${encodeURIComponent(symbol)}?interval=${iv}&lookback=${lb}`
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
    void load(timeframe, lookback);
  }, [load, timeframe, lookback]);

  function selectTimeframe(tfId: string) {
    const tf = TIMEFRAMES.find((t) => t.id === tfId);
    if (!tf) return;
    const allowed = LOOKBACKS_BY_TF[tfId] || LOOKBACKS_BY_TF["1d"];
    const nextLb = allowed.some((r) => r.id === lookback) ? lookback : tf.defaultLookback;
    setTimeframe(tfId);
    setLookback(nextLb);
  }

  async function sendFeedback(result: "hit" | "miss" | "partial") {
    if (!data?.tip) return;
    setFeedbackBusy(true);
    try {
      await apiFetch(`/tips/${data.tip.id}/feedback`, {
        method: "POST",
        body: JSON.stringify({ result }),
      });
      await load(timeframe, lookback);
    } finally {
      setFeedbackBusy(false);
    }
  }

  async function setTipLifecycle(status: TipStatus, result?: "hit" | "miss" | "partial") {
    if (!data?.tip) return;
    setFeedbackBusy(true);
    try {
      await apiFetch(`/tips/${data.tip.id}/lifecycle`, {
        method: "POST",
        body: JSON.stringify({ status, result: result || null }),
      });
      await load(timeframe, lookback);
    } finally {
      setFeedbackBusy(false);
    }
  }

  const positions = data?.positions ?? [];
  const chartLevels = useMemo((): ChartLevel[] => {
    const levels: ChartLevel[] = [];
    positions.forEach((p, i) => {
      const cost = Number(p.avg_cost);
      if (!Number.isFinite(cost) || cost <= 0) return;
      const qty = Number(p.quantity);
      const label =
        positions.length > 1
          ? `Ø ${qty} ks`
          : `Ø nákup`;
      levels.push({
        price: cost,
        title: label,
        color: i === 0 ? "#6ea8ff" : "#f0c14a",
        style: "dashed",
      });
    });
    const tip = data?.tip;
    if (tip?.stop != null && Number(tip.stop) > 0) {
      levels.push({ price: Number(tip.stop), title: "Stop", color: "#ff6b7a", style: "dotted" });
    }
    if (tip?.target_1 != null && Number(tip.target_1) > 0) {
      levels.push({
        price: Number(tip.target_1),
        title: "Cíl",
        color: "#5dde8a",
        style: "dotted",
      });
    }
    return levels;
  }, [positions, data?.tip]);

  if (error && !data) return <div className="card p-4 text-[var(--danger)]">{error}</div>;
  if (!data) return <div className="muted">Načítám {symbol}…</div>;

  const ch = data.quote.change_pct;
  const ranges = LOOKBACKS_BY_TF[timeframe] || LOOKBACKS_BY_TF["1d"];

  return (
    <div className="instrument-page space-y-4">
      <section className="instrument-page__head rise">
        <div className="instrument-page__title">
          <h1 className="display text-2xl sm:text-3xl leading-none">{data.instrument.symbol}</h1>
          <span className="muted text-sm truncate">{data.instrument.name}</span>
          <DataQualityBadge quality={data.quote.data_quality} compact />
        </div>
        <div className="instrument-page__price">
          <span className="text-2xl font-semibold tabular-nums">
            {data.quote.price != null ? data.quote.price.toFixed(2) : "—"}
          </span>
          <span className={ch != null && ch >= 0 ? "text-[var(--ok)]" : "text-[var(--danger)]"}>
            {ch != null ? `${ch >= 0 ? "+" : ""}${ch.toFixed(2)}%` : ""}
          </span>
        </div>
      </section>

      <section className="instrument-chart card">
        <div className="instrument-chart__bar">
          <div className="chart-controls">
            <div className="chart-controls__group" role="group" aria-label="Timeframe">
              {TIMEFRAMES.map((tf) => (
                <button
                  key={tf.id}
                  type="button"
                  className={`chart-chip ${timeframe === tf.id ? "is-active" : ""}`}
                  disabled={chartBusy}
                  onClick={() => selectTimeframe(tf.id)}
                >
                  {tf.label}
                </button>
              ))}
            </div>
            <div className="chart-controls__group" role="group" aria-label="Rozsah">
              {ranges.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className={`chart-chip chart-chip--soft ${lookback === r.id ? "is-active" : ""}`}
                  disabled={chartBusy}
                  onClick={() => setLookback(r.id)}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>
          {chartBusy && <span className="muted text-xs">Načítám…</span>}
        </div>
        <div className="instrument-chart__stage">
          <PriceChart bars={data.bars} levels={chartLevels} />
        </div>
      </section>

      {data.tip && (
        <section className="card p-5 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="display text-2xl">Aktivní tip</h2>
            <span className={`badge ${data.tip.action}`}>{actionLabel[data.tip.action]}</span>
            <span className="badge">{horizonLabel[data.tip.horizon]}</span>
            <span className="badge">
              {tipStatusLabel[data.tip.status || "proposed"] || data.tip.status}
            </span>
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
          {(data.tip.entry_notes || data.tip.feedback?.notes) && (
            <div className="text-sm muted space-y-1">
              {data.tip.entry_notes && <p>Vstup: {data.tip.entry_notes}</p>}
              {data.tip.feedback?.notes && <p>Výstup: {data.tip.feedback.notes}</p>}
            </div>
          )}
          <div className="tip-journal space-y-2">
            <label className="block space-y-1">
              <span className="text-xs muted">Journal — proč vstupuji</span>
              <textarea
                className="input"
                defaultValue={data.tip.entry_notes || ""}
                id="tip-entry-notes"
                placeholder="Krátký zápis k vstupu…"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs muted">Journal — proč vycházím</span>
              <textarea
                className="input"
                defaultValue={data.tip.feedback?.notes || ""}
                id="tip-exit-notes"
                placeholder="Krátký zápis k výstupu…"
              />
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              className="btn"
              disabled={feedbackBusy}
              onClick={async () => {
                if (!data.tip) return;
                const entry = (document.getElementById("tip-entry-notes") as HTMLTextAreaElement)?.value || "";
                const exit = (document.getElementById("tip-exit-notes") as HTMLTextAreaElement)?.value || "";
                setFeedbackBusy(true);
                try {
                  await apiFetch(`/tips/${data.tip.id}/journal`, {
                    method: "PATCH",
                    body: JSON.stringify({
                      entry_notes: entry,
                      exit_notes: exit || null,
                      result: data.tip.feedback?.result || (exit ? "partial" : null),
                    }),
                  });
                  await load(timeframe, lookback);
                } finally {
                  setFeedbackBusy(false);
                }
              }}
            >
              Uložit journal
            </button>
            {(data.tip.status || "proposed") === "proposed" && (
              <>
                <button
                  className="btn btn-primary"
                  disabled={feedbackBusy}
                  onClick={() => {
                    const entry = (document.getElementById("tip-entry-notes") as HTMLTextAreaElement)?.value;
                    void setTipLifecycle("accepted").then(() => {
                      if (entry) {
                        void apiFetch(`/tips/${data.tip!.id}/journal`, {
                          method: "PATCH",
                          body: JSON.stringify({ entry_notes: entry }),
                        }).then(() => load(timeframe, lookback));
                      }
                    });
                  }}
                >
                  Přijmout
                </button>
                <button
                  className="btn"
                  disabled={feedbackBusy}
                  onClick={() => setTipLifecycle("rejected")}
                >
                  Odmítnout
                </button>
              </>
            )}
            <button
              className="btn btn-primary"
              disabled={feedbackBusy}
              onClick={async () => {
                if (!data.tip) return;
                setFeedbackBusy(true);
                try {
                  const res = await apiFetch<{
                    preview: { quantity: number; avg_cost: number; size_pct: number };
                  }>(`/tips/${data.tip.id}/paper-position`, { method: "POST" });
                  setActionMsg(
                    `Paper: ${res.preview.quantity} @ ${res.preview.avg_cost} (${res.preview.size_pct}%)`
                  );
                  await load(timeframe, lookback);
                } catch (err) {
                  setActionMsg(err instanceof Error ? err.message : "Paper selhal");
                } finally {
                  setFeedbackBusy(false);
                }
              }}
            >
              Přidat paper pozici
            </button>
            <Link
              href={`/chat?symbol=${encodeURIComponent(symbol)}&prompt=pre-zaver&fresh=1`}
              className="btn"
            >
              Analyzovat v Sense
            </Link>
            <button
              className="btn"
              disabled={feedbackBusy}
              onClick={() => {
                const exit = (document.getElementById("tip-exit-notes") as HTMLTextAreaElement)?.value;
                void apiFetch(`/tips/${data.tip!.id}/feedback`, {
                  method: "POST",
                  body: JSON.stringify({ result: "hit", notes: exit || null }),
                }).then(() => load(timeframe, lookback));
              }}
            >
              Tip vyšel
            </button>
            <button
              className="btn"
              disabled={feedbackBusy}
              onClick={() => {
                const exit = (document.getElementById("tip-exit-notes") as HTMLTextAreaElement)?.value;
                void apiFetch(`/tips/${data.tip!.id}/feedback`, {
                  method: "POST",
                  body: JSON.stringify({ result: "partial", notes: exit || null }),
                }).then(() => load(timeframe, lookback));
              }}
            >
              Částečně
            </button>
            <button
              className="btn"
              disabled={feedbackBusy}
              onClick={() => {
                const exit = (document.getElementById("tip-exit-notes") as HTMLTextAreaElement)?.value;
                void apiFetch(`/tips/${data.tip!.id}/feedback`, {
                  method: "POST",
                  body: JSON.stringify({ result: "miss", notes: exit || null }),
                }).then(() => load(timeframe, lookback));
              }}
            >
              Nevyšel
            </button>
            {data.tip.feedback && (
              <span className="badge">uloženo: {data.tip.feedback.result}</span>
            )}
            <DataQualityBadge quality={data.tip.data_quality} />
          </div>
          {actionMsg && <p className="muted text-sm">{actionMsg}</p>}
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
