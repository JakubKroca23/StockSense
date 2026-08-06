"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";

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
    status: "now" as const,
    body: "CCXT public tickery z Binance, Bybit, OKX, Kraken — medián + spread.",
  },
  {
    title: "Canonical OHLCV historie",
    status: "next" as const,
    body: "1d / 1h / 4h z primary burzy do DB — základ pro backtest a signály.",
  },
  {
    title: "Paper trading bot",
    status: "later" as const,
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
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch<CryptoOverview>("/crypto/overview");
      setData(res);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Načtení crypto dat selhalo");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(id);
  }, [load]);

  return (
    <div className="cryptosense space-y-6">
      <section className="rise flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="advisor-card__eyebrow">CryptoSense</p>
          <h1 className="display text-3xl md:text-4xl mt-1">Live crypto desk</h1>
          <p className="muted mt-2 max-w-2xl">
            Multi-exchange přehled přes CCXT. Primary burza pro budoucí bota — ostatní burzy
            slouží ke kontrole ceny a spreadu. Historie a trading bot přijdou postupně.
          </p>
        </div>
        <button type="button" className="btn text-xs px-2 py-1" onClick={() => void load()} disabled={loading}>
          {loading ? "Načítám…" : "Obnovit"}
        </button>
      </section>

      {error && <div className="card p-4 text-[var(--danger)]">{error}</div>}

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
            <span
              key={ex}
              className={`badge ${ex === data?.primary_exchange ? "long" : ""}`}
            >
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
            const up = (q.change_pct ?? 0) >= 0;
            const open = expanded === q.symbol;
            return (
              <article key={q.symbol} className="card crypto-board__card p-4 rise">
                <button
                  type="button"
                  className="crypto-board__head"
                  onClick={() => setExpanded(open ? null : q.symbol)}
                >
                  <div>
                    <h3 className="font-semibold text-lg">{q.symbol}</h3>
                    <p className="muted text-xs">
                      {q.primary_exchange} · medián {fmtPrice(q.median_price)}
                    </p>
                  </div>
                  <div className="text-right">
                    <div className="text-xl font-semibold">{fmtPrice(q.primary_price)}</div>
                    <div className={up ? "text-[var(--ok)] text-sm" : "text-[var(--danger)] text-sm"}>
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
                            <td className={(e.change_pct ?? 0) >= 0 ? "text-[var(--ok)]" : "text-[var(--danger)]"}>
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
                    item.status === "now" ? "long" : item.status === "next" ? "hold" : ""
                  }`}
                >
                  {item.status === "now" ? "teď" : item.status === "next" ? "další" : "později"}
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
