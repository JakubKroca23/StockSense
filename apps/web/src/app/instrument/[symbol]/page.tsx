"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import { PriceChart, ChartBar, ChartLevel } from "@/components/PriceChart";
import { PortfolioPosition, Tip, actionLabel, horizonLabel } from "@/lib/types";

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
  const [alertMsg, setAlertMsg] = useState<string | null>(null);

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
    } finally {
      setFeedbackBusy(false);
    }
  }

  async function watchLevel(
    kind: "avg_cost" | "stop" | "target" | "custom",
    price: number,
    direction: "above" | "below" | "cross" = "cross",
    note?: string
  ) {
    if (!Number.isFinite(price) || price <= 0) return;
    setAlertMsg(null);
    try {
      await apiFetch("/price-alerts", {
        method: "POST",
        body: JSON.stringify({
          symbol,
          kind,
          price,
          direction,
          note: note || kind,
        }),
      });
      setAlertMsg(`Hlídač ${kind} @ ${price.toFixed(2)} uložen`);
    } catch (err) {
      setAlertMsg(err instanceof Error ? err.message : "Hlídač se neuložil");
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
        </div>

        {positions.length > 0 && (
          <div className="chart-positions">
            {positions.map((p) => {
              const cost = Number(p.avg_cost);
              const px = data.quote.price;
              const pnlPct =
                px != null && cost > 0 ? ((px - cost) / cost) * 100 : p.pnl_pct != null ? Number(p.pnl_pct) : null;
              return (
                <div key={p.id} className="chart-positions__item">
                  <span className="chart-positions__dot" aria-hidden />
                  <span>
                    Pozice {Number(p.quantity)} @ {cost.toFixed(2)}
                    {p.is_paper ? " (paper)" : ""}
                  </span>
                  {pnlPct != null && (
                    <span className={pnlPct >= 0 ? "text-[var(--ok)]" : "text-[var(--danger)]"}>
                      {pnlPct >= 0 ? "+" : ""}
                      {pnlPct.toFixed(2)}%
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div className="chart-alert-bar">
          {positions[0] && (
            <button
              type="button"
              className="btn text-xs px-2 py-1"
              onClick={() =>
                watchLevel("avg_cost", Number(positions[0].avg_cost), "cross", "Ø nákup")
              }
            >
              Hlídač Ø nákup
            </button>
          )}
          {data.tip?.stop != null && (
            <button
              type="button"
              className="btn text-xs px-2 py-1"
              onClick={() => watchLevel("stop", Number(data.tip!.stop), "below", "Stop tipu")}
            >
              Hlídač stop
            </button>
          )}
          {data.tip?.target_1 != null && (
            <button
              type="button"
              className="btn text-xs px-2 py-1"
              onClick={() => watchLevel("target", Number(data.tip!.target_1), "above", "Cíl tipu")}
            >
              Hlídač cíl
            </button>
          )}
          {data.quote.price != null && (
            <button
              type="button"
              className="btn text-xs px-2 py-1"
              onClick={() => watchLevel("custom", Number(data.quote.price), "cross", "Aktuální cena")}
            >
              Hlídač teď
            </button>
          )}
        </div>
        {alertMsg && <p className="muted text-sm">{alertMsg}</p>}

        {chartBusy && <p className="muted text-sm">Načítám data…</p>}
        <PriceChart bars={data.bars} height={380} levels={chartLevels} />
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
