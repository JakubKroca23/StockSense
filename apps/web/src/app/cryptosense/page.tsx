"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch, apiWsUrl } from "@/lib/api";
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
  execution_exchange?: string;
  chart_mode?: string;
  exchanges: string[];
  as_of: string;
  quotes: AggregatedQuote[];
};

type CryptoOhlcv = {
  symbol: string;
  interval: string;
  primary_exchange: string;
  execution_exchange?: string;
  chart_mode?: string;
  bars: number;
  inserted: number;
  updated: number;
  ohlcv: ChartBar[];
};

type LiveKline = {
  type?: string;
  ts: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  is_closed?: boolean;
  detail?: string;
};

const TIMEFRAMES = [
  { id: "1s", label: "1s" },
  { id: "1m", label: "1m" },
  { id: "5m", label: "5m" },
  { id: "15m", label: "15m" },
  { id: "30m", label: "30m" },
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
    title: "Binance + Bybit data",
    status: "done" as const,
    body: "Tickery a grafy agregované z Binance + Bybit. Bot/execution = Bybit.",
  },
  {
    title: "Realtime graf (WS)",
    status: "now" as const,
    body: "Agregované živé svíčky z Binance + Bybit websocketů.",
  },
  {
    title: "Paper trading bot",
    status: "next" as const,
    body: "Signál → paper order na Bybit → fills log.",
  },
  {
    title: "Live bot + risk",
    status: "later" as const,
    body: "Bybit user stream, kill-switch, reconciliation balances/orders.",
  },
];

function chartLimit(tf: string) {
  if (tf === "1s") return 360;
  if (tf === "1m") return 240;
  if (tf === "5m") return 288;
  return 220;
}

function mergeLiveBar(bars: ChartBar[], live: LiveKline): ChartBar[] {
  const next: ChartBar = {
    ts: live.ts,
    open: live.open,
    high: live.high,
    low: live.low,
    close: live.close,
    volume: live.volume,
  };
  if (!bars.length) return [next];
  const last = bars[bars.length - 1];
  const sameBucket = new Date(last.ts).getTime() === new Date(live.ts).getTime();
  if (sameBucket) {
    return [...bars.slice(0, -1), next];
  }
  const merged = [...bars, next];
  const cap = 500;
  return merged.length > cap ? merged.slice(merged.length - cap) : merged;
}

export default function CryptoSensePage() {
  const [data, setData] = useState<CryptoOverview | null>(null);
  const [selected, setSelected] = useState("BTC/USDT");
  const [interval, setIntervalTf] = useState<(typeof TIMEFRAMES)[number]["id"]>("1m");
  const [ohlcv, setOhlcv] = useState<CryptoOhlcv | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [chartBusy, setChartBusy] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [live, setLive] = useState(false);

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
      const persist = !["1s", "1m", "5m", "30m"].includes(tf);
      const res = await apiFetch<CryptoOhlcv>(
        `/crypto/ohlcv?symbol=${encodeURIComponent(symbol)}&interval=${tf}&limit=${chartLimit(tf)}&persist=${persist}`
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

  useEffect(() => {
    let ws: WebSocket | null = null;
    let closed = false;
    let retry: number | null = null;

    const connect = () => {
      if (closed) return;
      const url = apiWsUrl(
        `/crypto/ws/ohlcv?symbol=${encodeURIComponent(selected)}&interval=${encodeURIComponent(interval)}`
      );
      ws = new WebSocket(url);
      ws.onopen = () => setLive(true);
      ws.onclose = () => {
        setLive(false);
        if (!closed) retry = window.setTimeout(connect, 2000);
      };
      ws.onerror = () => {
        setLive(false);
        try {
          ws?.close();
        } catch {
          /* ignore */
        }
      };
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data as string) as LiveKline;
          if (msg.type === "hello") {
            setLive(true);
            return;
          }
          if (msg.type === "error") {
            setLive(false);
            return;
          }
          if (msg.ts == null || msg.close == null) return;
          setOhlcv((prev) => {
            if (!prev) return prev;
            const ohlcvBars = mergeLiveBar(prev.ohlcv, msg);
            return { ...prev, bars: ohlcvBars.length, ohlcv: ohlcvBars };
          });
        } catch {
          /* ignore */
        }
      };
    };

    connect();
    return () => {
      closed = true;
      if (retry) window.clearTimeout(retry);
      setLive(false);
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
    };
  }, [selected, interval]);

  const activeQuote = data?.quotes.find((q) => q.symbol === selected) || null;
  const up = (activeQuote?.change_pct ?? 0) >= 0;

  return (
    <div className="cryptosense space-y-6">
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
            <button
              type="button"
              className="chart-chip chart-chip--soft"
              onClick={() => {
                void loadOverview();
                void loadChart(selected, interval);
              }}
              disabled={loading || chartBusy}
            >
              {loading || chartBusy ? "…" : "↻"}
            </button>
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
                <span className={`badge ${live ? "long" : ""}`}>{live ? "LIVE" : "offline"}</span>
                <span className="badge">agg binance+bybit</span>
                <span className="badge">
                  bot {(ohlcv?.execution_exchange || data?.execution_exchange || "bybit")}
                </span>
                {ohlcv && <span className="badge">{ohlcv.bars} bars</span>}
              </>
            )}
            {chartBusy && <span>Načítám graf…</span>}
          </div>
        </div>
        <div className="instrument-chart__stage crypto-chart-stage">
          {ohlcv?.ohlcv?.length ? (
            <PriceChart
              bars={ohlcv.ohlcv}
              showMa={!["1s", "1m"].includes(interval)}
              realtime
              secondsVisible={interval === "1s" || interval === "1m"}
            />
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
              chart <span className="text-[var(--sense)]">agg</span>
              {" · "}
              bot/exec <span className="text-[var(--sense)]">{data.execution_exchange || "bybit"}</span>
              {" · "}
              {new Date(data.as_of).toLocaleTimeString("cs-CZ")}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {(data?.exchanges || ["binance", "bybit"]).map((ex) => (
            <span key={ex} className={`badge ${ex === (data?.execution_exchange || "bybit") ? "long" : ""}`}>
              {ex}
              {ex === (data?.execution_exchange || "bybit") ? " · bot" : ""}
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
                      medián {fmtPrice(q.median_price)}
                      {q.primary_exchange ? ` · bot ${q.primary_exchange}` : ""}
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
