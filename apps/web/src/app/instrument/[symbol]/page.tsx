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
  filings: { form: string; filing_date: string; url?: string | null }[];
  headlines?: { title: string; publisher?: string; link?: string; published?: string }[];
  macro?: { series_id: string; name: string; value: number; as_of?: string }[];
  analysis?: {
    action: string;
    horizon: string;
    score: number;
    confidence: number;
    components?: Record<string, number>;
    features?: Record<string, number | string | null>;
    notes?: Record<string, string[]>;
    scenarios?: { bull: string; base: string; bear: string };
    levels?: Record<string, number | null>;
  } | null;
  tip: Tip | null;
  interval?: string;
  lookback?: string;
}

const FUND_LABELS: Record<string, string> = {
  pe: "P/E",
  forward_pe: "Fwd P/E",
  peg: "PEG",
  pb: "P/B",
  ps: "P/S",
  roe: "ROE",
  profit_margin: "Marže",
  debt_to_equity: "D/E",
  revenue_growth: "Růst tržeb",
  earnings_growth: "Růst EPS",
  market_cap: "Market cap",
  sector: "Sektor",
  industry: "Odvětví",
  dividend_yield: "Dividenda",
  earnings_date: "Earnings",
  eps_surprise_pct: "EPS growth QoQ",
  eps_ttm: "EPS TTM",
  target_mean: "Cíl analytici",
  recommendation: "Konsensus",
  fifty_two_week_high: "52t high",
  fifty_two_week_low: "52t low",
  beta: "Beta",
  funding_rate: "Funding",
};

function formatFundValue(key: string, v: number | string | null): string {
  if (v == null) return "—";
  if (typeof v === "string") return v;
  if (key === "market_cap") {
    if (v >= 1e12) return `${(v / 1e12).toFixed(2)}T`;
    if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
    if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
    return v.toFixed(0);
  }
  if (
    ["roe", "profit_margin", "revenue_growth", "earnings_growth", "dividend_yield", "eps_surprise_pct"].includes(
      key
    )
  ) {
    return `${(v * (Math.abs(v) <= 1 ? 100 : 1)).toFixed(1)}%`;
  }
  if (key === "funding_rate") return v.toFixed(5);
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
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
          <PriceChart bars={data.bars} levels={chartLevels} showMa />
        </div>
        {data.analysis?.features && (
          <div className="instrument-chart__stats">
            {data.analysis.features.rsi != null && (
              <span>RSI {Number(data.analysis.features.rsi).toFixed(0)}</span>
            )}
            {data.analysis.features.atr != null && (
              <span>ATR {Number(data.analysis.features.atr).toFixed(2)}</span>
            )}
            {data.analysis.features.rs_vs_bench != null && (
              <span>
                RS{" "}
                {Number(data.analysis.features.rs_vs_bench) >= 0 ? "+" : ""}
                {(Number(data.analysis.features.rs_vs_bench) * 100).toFixed(1)}%
              </span>
            )}
            {data.analysis.features.vol_ratio != null && (
              <span>Vol {Number(data.analysis.features.vol_ratio).toFixed(1)}×</span>
            )}
            <span className="muted">SMA20 · SMA50</span>
          </div>
        )}
      </section>

      {data.analysis && (
        <section className="card p-4 space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="display text-xl">Analýza</h2>
            <div className="flex flex-wrap gap-2 text-sm">
              <span className="badge">{actionLabel[data.analysis.action as Tip["action"]] || data.analysis.action}</span>
              <span className="badge">
                {horizonLabel[data.analysis.horizon as Tip["horizon"]] || data.analysis.horizon}
              </span>
              <span className="font-semibold tabular-nums">
                Score {data.analysis.score} · {(data.analysis.confidence * 100).toFixed(0)}%
              </span>
            </div>
          </div>
          {data.analysis.components && (
            <div className="score-bars">
              {Object.entries(data.analysis.components).map(([k, v]) => (
                <div key={k} className="score-bars__row">
                  <span className="muted text-xs">{k}</span>
                  <div className="score-bars__track">
                    <div
                      className={`score-bars__fill ${v >= 0 ? "is-pos" : "is-neg"}`}
                      style={{ width: `${Math.min(100, Math.abs(v) * 100)}%` }}
                    />
                  </div>
                  <span className="tabular-nums text-xs">{v.toFixed(2)}</span>
                </div>
              ))}
            </div>
          )}
          {data.analysis.notes && (
            <ul className="text-sm space-y-1 muted">
              {Object.values(data.analysis.notes)
                .flat()
                .slice(0, 8)
                .map((n, i) => (
                  <li key={`${n}-${i}`}>· {n}</li>
                ))}
            </ul>
          )}
          {data.analysis.scenarios && (
            <div className="grid sm:grid-cols-3 gap-2 text-sm">
              <div className="rounded-xl border border-[var(--line)] p-3">
                <div className="text-xs text-[var(--ok)] mb-1">Bull</div>
                {data.analysis.scenarios.bull}
              </div>
              <div className="rounded-xl border border-[var(--line)] p-3">
                <div className="text-xs muted mb-1">Base</div>
                {data.analysis.scenarios.base}
              </div>
              <div className="rounded-xl border border-[var(--line)] p-3">
                <div className="text-xs text-[var(--danger)] mb-1">Bear</div>
                {data.analysis.scenarios.bear}
              </div>
            </div>
          )}
        </section>
      )}

      {data.macro && data.macro.length > 0 && (
        <section className="card p-3">
          <div className="macro-strip">
            {data.macro.map((m) => (
              <div key={m.series_id} className="macro-strip__item">
                <span className="muted text-xs">{m.series_id}</span>
                <span className="tabular-nums font-medium">{Number(m.value).toFixed(2)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

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
          {data.tip.rationale && typeof data.tip.rationale === "object" && (
            <div className="text-sm space-y-1">
              {(["fundament", "money_flow", "technicka", "makro"] as const).map((key) => {
                const notes = (data.tip!.rationale as Record<string, unknown>)[key];
                if (!Array.isArray(notes) || !notes.length) return null;
                return (
                  <p key={key} className="muted">
                    <span className="text-[var(--text)]">{key}: </span>
                    {notes.join(" · ")}
                  </p>
                );
              })}
            </div>
          )}
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
              href={`/chat?symbol=${encodeURIComponent(symbol)}&fresh=1`}
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

      <section className="card p-4">
        <h2 className="display text-xl mb-3">Fundament</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
          {Object.entries(data.quote.fundamentals || {})
            .filter(([k]) => k !== "short_name")
            .map(([k, v]) => (
              <div key={k} className="rounded-xl border border-[var(--line)] p-2.5">
                <div className="muted text-xs">{FUND_LABELS[k] || k}</div>
                <div className="font-medium tabular-nums">{formatFundValue(k, v)}</div>
              </div>
            ))}
          {Object.keys(data.quote.fundamentals || {}).length === 0 && (
            <p className="muted">Fundamentální data zatím nejsou dostupná.</p>
          )}
        </div>
      </section>

      {data.headlines && data.headlines.length > 0 && (
        <section className="card p-4">
          <h2 className="display text-xl mb-3">Headlines</h2>
          <ul className="space-y-2 text-sm">
            {data.headlines.map((h, i) => (
              <li key={`${h.title}-${i}`} className="border-b border-[var(--line)] pb-2">
                {h.link ? (
                  <a href={h.link} target="_blank" rel="noreferrer" className="hover:underline">
                    {h.title}
                  </a>
                ) : (
                  <span>{h.title}</span>
                )}
                <div className="muted text-xs mt-0.5">
                  {[h.publisher, h.published ? h.published.slice(0, 10) : null]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {data.filings?.length > 0 && (
        <section className="card p-4">
          <h2 className="display text-xl mb-3">SEC filings</h2>
          <ul className="space-y-2 text-sm">
            {data.filings.map((f, i) => (
              <li
                key={`${f.form}-${f.filing_date}-${i}`}
                className="flex justify-between gap-3 border-b border-[var(--line)] py-2"
              >
                {f.url ? (
                  <a href={f.url} target="_blank" rel="noreferrer" className="hover:underline">
                    {f.form}
                  </a>
                ) : (
                  <span>{f.form}</span>
                )}
                <span className="muted shrink-0">{f.filing_date}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
