"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { PriceChart, ChartBar } from "@/components/PriceChart";

type ExchangeQuote = {
  exchange: string;
  market: string;
  price: number | null;
  bid: number | null;
  ask: number | null;
  change_pct: number | null;
  volume_24h: number | null;
  ok: boolean;
  error: string | null;
  as_of: string;
};

type AggregatedQuote = {
  symbol: string;
  primary_exchange: string;
  primary_price: number | null;
  median_price: number | null;
  best_bid: number | null;
  best_ask: number | null;
  spread_pct: number | null;
  change_pct: number | null;
  as_of: string;
  exchanges: ExchangeQuote[];
};

type CryptoOverview = {
  primary_exchange: string;
  exchanges: string[];
  as_of: string;
  quotes: AggregatedQuote[];
};

type CryptoOhlcv = {
  symbol: string;
  interval: string;
  primary_exchange: string;
  bars: number;
  inserted: number;
  updated: number;
  ohlcv: ChartBar[];
};

const TIMEFRAMES = [
  { id: "15m", label: "15m" },
  { id: "1h", label: "1H" },
  { id: "4h", label: "4H" },
  { id: "1d", label: "1D" },
] as const;

function fmtPrice(n: number | null | undefined) {
  if (n == null) return "—";
  if (n >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (n >= 1) return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
  return n.toLocaleString("en-US", { maximumFractionDigits: 6 });
}

function fmtPct(n: number | null | undefined) {
  if (n == null) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

const ROADMAP = [
  {
    title: "Live multi-exchange quotes",
    status: "done" as const,
    body: "CCXT tickery z Binance, Bybit, OKX, Kraken — medián + spread.",
  },
  {
    title: "Canonical OHLCV + grafy",
    status: "now" as const,
    body: "1d / 1h / 4h / 15m z primary burzy, upsert do price_bars, candle chart.",
  },
  {
    title: "Paper trading bot",
    status: "next" as const,
    body: "Signál → paper order → fills log. Execution jen na jedné primary burze.",
  },
  {
    title: "Live bot + risk",
    status: "later" as const,
    body: "Websocket user stream, kill-switch, reconciliation balances/orders.",
  },
];

export default function CryptoSensePage() {
  const [data, setData] = useState<CryptoOverview | null>(null);
  const [selected, setSelected] = useState("BTC/USDT");
  const [interval, setIntervalTf] = useState<(typeof TIMEFRAMES)[number]["id"]>("1h");
  const [ohlcv, setOhlcv] = useState<CryptoOhlcv | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [chartBusy, setChartBusy] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const loadOverview = useCallback(async () => {
    try {
      const res = await apiFetch<CryptoOverview>("/crypto/overview");
      setData(res);
      setError(null);
      setSelected((prev) =>
        res.quotes.some((q) => q.symbol === prev) ? prev : res.quotes[0]?.symbol || prev
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Načtení crypto dat selhalo");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadChart = useCallback(async (symbol: string, tf: string) => {
    setChartBusy(true);
    try {
      const res = await apiFetch<CryptoOhlcv>(
        `/crypto/ohlcv?symbol=${encodeURIComponent(symbol)}&interval=${tf}&limit=220&persist=true`
      );
      setOhlcv(res);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Načtení grafu selhalo");
    } finally {
      setChartBusy(false);
    }
  }, []);

  useEffect(() => {
    void loadOverview();
    const id = window.setInterval(() => void loadOverview(), 30_000);
    return () => window.clearInterval(id);
  }, [loadOverview]);

  useEffect(() => {
    void loadChart(selected, interval);
  }, [selected, interval, loadChart]);

  const activeQuote = data?.quotes.find((q) => q.symbol === selected) || null;
  const up = (activeQuote?.change_pct ?? 0) >= 0;

  return (
    <div className="cryptosense space-y-6">
      <section className="rise flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="advisor-card__eyebrow">CryptoSense</p>
          <h1 className="display text-3xl md:text-4xl mt-1">Live crypto desk</h1>
          <p className="muted mt-2 max-w-2xl">
            Multi-exchange quote + canonical OHLCV z primary burzy. Graf se ukládá do historie
            pro budoucí backtest a bota.
          </p>
        </div>
        <button
          type="button"
          className="btn text-xs px-2 py-1"
          onClick={() => {
            void loadOverview();
            void loadChart(selected, interval);
          }}
          disabled={loading || chartBusy}
        >
          {loading || chartBusy ? "Načítám…" : "Obnovit"}
        </button>
      </section>

      {error && <div className="card p-4 text-[var(--danger)]">{error}</div>}

      <section className="card instrument-chart">
        <div className="instrument-chart__bar">
          <div className="chart-controls">
            <div className="chart-controls__group" role="group" aria-label="Symbol">
              {(data?.quotes || [{ symbol: selected } as AggregatedQuote]).map((q) => (
                <button
                  key={q.symbol}
                  type="button"
                  className={`chart-chip ${selected === q.symbol ? "is-active" : ""}`}
                  onClick={() => {
                    setSelected(q.symbol);
                    setExpanded(null);
                  }}
                >
                  {q.symbol.split("/")[0]}
                </button>
              ))}
            </div>
            <div className="chart-controls__group" role="group" aria-label="Timeframe">
              {TIMEFRAMES.map((tf) => (
                <button
                  key={tf.id}
                  type="button"
                  className={`chart-chip chart-chip--soft ${interval === tf.id ? "is-active" : ""}`}
                  disabled={chartBusy}
                  onClick={() => setIntervalTf(tf.id)}
                >
                  {tf.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs muted">
            {activeQuote && (
              <>
                <span className="text-[var(--text)] font-semibold text-sm">
                  {fmtPrice(activeQuote.primary_price)}
                </span>
                <span className={up ? "text-[var(--ok)]" : "text-[var(--danger)]"}>
                  {fmtPct(activeQuote.change_pct)}
                </span>
                <span className="badge">{ohlcv?.primary_exchange || data?.primary_exchange}</span>
                {ohlcv && (
                  <span className="badge">
                    +{ohlcv.inserted}/↻{ohlcv.updated} · {ohlcv.bars} bars
                  </span>
                )}
              </>
            )}
            {chartBusy && <span>Načítám graf…</span>}
          </div>
        </div>
        <div className="instrument-chart__stage crypto-chart-stage">
          {ohlcv?.ohlcv?.length ? (
            <PriceChart bars={ohlcv.ohlcv} showMa />
          ) : (
            <div className="muted p-6 text-sm">
              {chartBusy ? "Připravuji svíčky…" : "Žádná OHLCV data."}
            </div>
          )}
        </div>
      </section>

      <section className="card p-4 sm:p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="home-chart-title">Burzy</h2>
          {data && (
            <p className="muted text-xs">
              primary <span className="text-[var(--sense)]">{data.primary_exchange}</span>
              {" · "}
              {new Date(data.as_of).toLocaleTimeString("cs-CZ")}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {(data?.exchanges || ["binance", "bybit", "okx", "kraken"]).map((ex) => (
            <span key={ex} className={`badge ${ex === data?.primary_exchange ? "long" : ""}`}>
              {ex}
              {ex === data?.primary_exchange ? " · primary" : ""}
            </span>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="display text-2xl">Live board</h2>
        {loading && !data && <div className="card p-5 muted">Tahám tickery z burz…</div>}
        <div className="crypto-board">
          {(data?.quotes || []).map((q) => {
            const qUp = (q.change_pct ?? 0) >= 0;
            const open = expanded === q.symbol;
            return (
              <article
                key={q.symbol}
                className={`card crypto-board__card p-4 rise ${
                  selected === q.symbol ? "crypto-board__card--active" : ""
                }`}
              >
                <button
                  type="button"
                  className="crypto-board__head"
                  onClick={() => {
                    setSelected(q.symbol);
                    setExpanded(open && selected === q.symbol ? null : q.symbol);
                  }}
                >
                  <div>
                    <h3 className="font-semibold text-lg">{q.symbol}</h3>
                    <p className="muted text-xs">
                      {q.primary_exchange} · medián {fmtPrice(q.median_price)}
                    </p>
                  </div>
                  <div className="text-right">
                    <div className="text-xl font-semibold">{fmtPrice(q.primary_price)}</div>
                    <div className={qUp ? "text-[var(--ok)] text-sm" : "text-[var(--danger)] text-sm"}>
                      {fmtPct(q.change_pct)}
                    </div>
                  </div>
                </button>

                <div className="mt-3 flex flex-wrap gap-2 text-xs muted">
                  <span className="badge">spread {fmtPct(q.spread_pct)}</span>
                  <span className="badge">
                    ok {q.exchanges.filter((e) => e.ok).length}/{q.exchanges.length}
                  </span>
                </div>

                {open && (
                  <div className="mt-3 overflow-x-auto">
                    <table className="crypto-ex-table">
                      <thead>
                        <tr>
                          <th>Burza</th>
                          <th>Market</th>
                          <th>Cena</th>
                          <th>Bid</th>
                          <th>Ask</th>
                          <th>24h</th>
                        </tr>
                      </thead>
                      <tbody>
                        {q.exchanges.map((e) => (
                          <tr key={e.exchange} className={e.ok ? "" : "is-bad"}>
                            <td>{e.exchange}</td>
                            <td className="muted">{e.market}</td>
                            <td>{fmtPrice(e.price)}</td>
                            <td>{fmtPrice(e.bid)}</td>
                            <td>{fmtPrice(e.ask)}</td>
                            <td
                              className={
                                (e.change_pct ?? 0) >= 0 ? "text-[var(--ok)]" : "text-[var(--danger)]"
                              }
                            >
                              {e.ok ? fmtPct(e.change_pct) : e.error || "err"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="display text-2xl">Roadmapa</h2>
        <div className="crypto-roadmap">
          {ROADMAP.map((item) => (
            <div key={item.title} className="card p-4">
              <div className="flex items-center gap-2 mb-2">
                <span
                  className={`badge ${
                    item.status === "now"
                      ? "long"
                      : item.status === "done"
                        ? "hold"
                        : item.status === "next"
                          ? "sell"
                          : ""
                  }`}
                >
                  {item.status === "done"
                    ? "hotovo"
                    : item.status === "now"
                      ? "teď"
                      : item.status === "next"
                        ? "další"
                        : "později"}
                </span>
                <h3 className="font-semibold">{item.title}</h3>
              </div>
              <p className="muted text-sm leading-relaxed">{item.body}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
