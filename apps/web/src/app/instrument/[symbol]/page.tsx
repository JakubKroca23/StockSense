"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import { PriceChart, ChartBar, ChartLevel } from "@/components/PriceChart";
import { DataQualityBadge } from "@/components/DataQualityBadge";
import { PortfolioPosition } from "@/lib/types";

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
  const [timeframe, setTimeframe] = useState<string>("1d");
  const [lookback, setLookback] = useState<string>("6mo");
  const [chartBusy, setChartBusy] = useState(false);

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
    return levels;
  }, [positions]);

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
      </section>

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
