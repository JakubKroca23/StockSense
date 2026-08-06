"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch, apiWsUrl } from "@/lib/api";
import { PriceChart, ChartBar, HeatmapColumn } from "@/components/PriceChart";
import { OrderBookPanel, OrderBookData } from "@/components/OrderBookPanel";
import { useScreenContext } from "@/components/ScreenContext";

type AggregatedQuote = {
  symbol: string;
  primary_exchange: string;
  primary_price: number | null;
  median_price: number | null;
  change_pct: number | null;
  as_of: string;
};

type CryptoOverview = {
  primary_exchange: string;
  execution_exchange?: string;
  exchanges: string[];
  as_of: string;
  quotes: AggregatedQuote[];
};

type CryptoOhlcv = {
  symbol: string;
  interval: string;
  bars: number;
  ohlcv: ChartBar[];
  execution_exchange?: string;
};

type LiveKline = {
  type?: string;
  ts: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
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
  if (sameBucket) return [...bars.slice(0, -1), next];
  const merged = [...bars, next];
  return merged.length > 500 ? merged.slice(merged.length - 500) : merged;
}

function Sparkline({
  closes,
  up,
  width = 64,
  height = 22,
}: {
  closes: number[];
  up: boolean;
  width?: number;
  height?: number;
}) {
  const path = useMemo(() => {
    if (closes.length < 2) return "";
    const min = Math.min(...closes);
    const max = Math.max(...closes);
    const span = max - min || 1;
    const pad = 1;
    const w = width - pad * 2;
    const h = height - pad * 2;
    return closes
      .map((v, i) => {
        const x = pad + (i / (closes.length - 1)) * w;
        const y = pad + (1 - (v - min) / span) * h;
        return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  }, [closes, width, height]);

  if (!path) {
    return <span className="crypto-spark crypto-spark--empty" style={{ width, height }} />;
  }

  return (
    <svg
      className={`crypto-spark ${up ? "is-up" : "is-down"}`}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden
    >
      <path d={path} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export default function CryptoSensePage() {
  const { setScreen } = useScreenContext();
  const [data, setData] = useState<CryptoOverview | null>(null);
  const [selected, setSelected] = useState("BTC/USDT");
  const [interval, setIntervalTf] = useState<(typeof TIMEFRAMES)[number]["id"]>("1m");
  const [ohlcv, setOhlcv] = useState<CryptoOhlcv | null>(null);
  const [sparks, setSparks] = useState<Record<string, number[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [chartBusy, setChartBusy] = useState(false);
  const [live, setLive] = useState(false);
  const [orderBook, setOrderBook] = useState<OrderBookData | null>(null);
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [heatmap, setHeatmap] = useState<HeatmapColumn[]>([]);
  const [metaOpen, setMetaOpen] = useState(true);
  const [mobilePanel, setMobilePanel] = useState<"chart" | "book">("chart");
  const heatSymRef = useRef(selected);

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

  const loadSparks = useCallback(async (symbols: string[]) => {
    const results = await Promise.all(
      symbols.map(async (symbol) => {
        try {
          const res = await apiFetch<CryptoOhlcv>(
            `/crypto/ohlcv?symbol=${encodeURIComponent(symbol)}&interval=5m&limit=48&persist=false`
          );
          const closes = (res.ohlcv || []).map((b) => b.close).filter((n) => Number.isFinite(n));
          return [symbol, closes] as const;
        } catch {
          return [symbol, [] as number[]] as const;
        }
      })
    );
    setSparks((prev) => {
      const next = { ...prev };
      for (const [sym, closes] of results) next[sym] = closes;
      return next;
    });
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

  const pushHeatColumn = useCallback((res: OrderBookData, symbol: string) => {
    const priceMap = new Map<number, { bid: number; ask: number }>();
    // Full depth from API (up to hundreds of levels)
    for (const lvl of res.bids) {
      priceMap.set(lvl.price, { bid: lvl.amount, ask: 0 });
    }
    for (const lvl of res.asks) {
      const cur = priceMap.get(lvl.price) || { bid: 0, ask: 0 };
      cur.ask = lvl.amount;
      priceMap.set(lvl.price, cur);
    }
    const levels = [...priceMap.entries()].map(([price, v]) => ({
      price,
      bid: v.bid,
      ask: v.ask,
    }));
    if (!levels.length) return;
    const now = Date.now();
    const col: HeatmapColumn = { ts: now, levels };
    setHeatmap((prev) => {
      const sameSym = heatSymRef.current === symbol;
      const base = sameSym ? prev : [];
      heatSymRef.current = symbol;
      const last = base[base.length - 1];
      // Keep rightmost column live (~refresh in place) so heatmap stays current
      if (last && now - last.ts < 900) {
        return [...base.slice(0, -1), { ...col, ts: last.ts }];
      }
      const next = [...base, col];
      return next.length > 220 ? next.slice(next.length - 220) : next;
    });
  }, []);

  const loadOrderBook = useCallback(
    async (symbol: string, accumulateHeat: boolean) => {
      try {
        const depth = accumulateHeat ? 200 : 100;
        const res = await apiFetch<OrderBookData>(
          `/crypto/orderbook?symbol=${encodeURIComponent(symbol)}&limit=${depth}`
        );
        setOrderBook(res);
        if (accumulateHeat) pushHeatColumn(res, symbol);
      } catch {
        /* keep last book */
      }
    },
    [pushHeatColumn]
  );

  useEffect(() => {
    void loadOverview();
    const id = window.setInterval(() => void loadOverview(), 30_000);
    return () => window.clearInterval(id);
  }, [loadOverview]);

  useEffect(() => {
    setHeatmap([]);
    heatSymRef.current = selected;
  }, [selected]);

  useEffect(() => {
    void loadOrderBook(selected, showHeatmap);
    const id = window.setInterval(
      () => void loadOrderBook(selected, showHeatmap),
      showHeatmap ? 700 : 2000
    );
    return () => window.clearInterval(id);
  }, [selected, showHeatmap, loadOrderBook]);

  useEffect(() => {
    const symbols = (data?.quotes || []).map((q) => q.symbol);
    if (!symbols.length) return;
    void loadSparks(symbols);
    const id = window.setInterval(() => void loadSparks(symbols), 60_000);
    return () => window.clearInterval(id);
  }, [data?.quotes, loadSparks]);

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
  const quotes = data?.quotes || [];
  const exchanges = data?.exchanges?.length
    ? data.exchanges
    : orderBook?.exchanges || ["binance", "bybit"];
  const execution = data?.execution_exchange || orderBook?.execution_exchange || "bybit";

  useEffect(() => {
    const last = ohlcv?.ohlcv?.[ohlcv.ohlcv.length - 1];
    const coinList = (data?.quotes || []).map((q) => q.symbol.split("/")[0]).join(", ");
    const detail = [
      `Timeframe grafu: ${interval}`,
      live ? "Stream: LIVE (agregace Binance+Bybit)" : "Stream: offline",
      `Burzy grafu: ${exchanges.join(" + ")}`,
      `Execution: ${execution}`,
      activeQuote?.primary_price != null
        ? `Cena (agg): ${activeQuote.primary_price}`
        : null,
      activeQuote?.change_pct != null ? `Denní změna: ${activeQuote.change_pct.toFixed(2)}%` : null,
      orderBook?.spread_pct != null
        ? `Spread: ${orderBook.spread_pct.toFixed(4)}%`
        : null,
      last
        ? `Poslední svíčka: o=${last.open} h=${last.high} l=${last.low} c=${last.close}`
        : null,
      `Dostupné coiny: ${coinList || "—"}`,
      showHeatmap ? "Heatmapa order book: zapnuto" : null,
    ]
      .filter(Boolean)
      .join("\n");

    setScreen({
      page: "cryptosense",
      title: "CryptoSense — live graf",
      symbol: selected,
      detail,
    });
  }, [
    selected,
    interval,
    live,
    activeQuote?.primary_price,
    activeQuote?.change_pct,
    ohlcv,
    data?.quotes,
    exchanges,
    execution,
    orderBook?.spread_pct,
    showHeatmap,
    setScreen,
  ]);

  return (
    <div className="cryptosense">
      {error && <div className="card p-4 text-[var(--danger)] mb-3">{error}</div>}

      <div className="crypto-coin-strip" role="group" aria-label="Kryptoměny">
        {quotes.map((q) => {
          const closes = sparks[q.symbol] || [];
          const sparkUp =
            closes.length >= 2
              ? closes[closes.length - 1] >= closes[0]
              : (q.change_pct ?? 0) >= 0;
          const base = q.symbol.split("/")[0];
          const active = selected === q.symbol;
          return (
            <button
              key={q.symbol}
              type="button"
              className={`crypto-coin-card ${active ? "is-active" : ""} ${sparkUp ? "is-up" : "is-down"}`}
              onClick={() => setSelected(q.symbol)}
              title={q.symbol}
            >
              <div className="crypto-coin-card__top">
                <span className="crypto-coin-card__sym">{base}</span>
                <span className="crypto-coin-card__pct">{fmtPct(q.change_pct)}</span>
              </div>
              <span className="crypto-coin-card__price">{fmtPrice(q.primary_price)}</span>
              <Sparkline closes={closes} up={sparkUp} width={88} height={22} />
            </button>
          );
        })}
        {!quotes.length && loading && (
          <div className="crypto-coin-card crypto-coin-card--ghost muted text-xs">Načítám…</div>
        )}
      </div>

      <div className="cryptosense__desk">
        <section
          className={`card instrument-chart cryptosense__chart is-${mobilePanel}`}
        >
          <div className="instrument-chart__bar cryptosense__meta">
            <div className="cryptosense__meta-row">
              {activeQuote && (
                <>
                  <span className="text-[var(--text)] font-semibold text-sm">
                    {fmtPrice(activeQuote.primary_price)}
                  </span>
                  <span className={up ? "text-[var(--chart-up)]" : "text-[var(--chart-down)]"}>
                    {fmtPct(activeQuote.change_pct)}
                  </span>
                  <span className={`badge ${live ? "long" : ""}`}>{live ? "LIVE" : "offline"}</span>
                </>
              )}
              <button
                type="button"
                className={`chart-chip chart-chip--soft ${metaOpen ? "is-active" : ""}`}
                onClick={() => setMetaOpen((v) => !v)}
                title={metaOpen ? "Sbalit data grafu" : "Rozbalit data grafu"}
              >
                {metaOpen ? "Data ▾" : "Data ▸"}
              </button>
              {metaOpen && (
                <>
                  <span className="badge">{exchanges.join(" + ")}</span>
                  <span className="badge">agg OHLCV</span>
                  <span className="badge">exec {execution}</span>
                  {orderBook?.spread_pct != null && (
                    <span className="badge">spread {orderBook.spread_pct.toFixed(3)}%</span>
                  )}
                </>
              )}
              <div className="cryptosense__tf chart-controls__group" role="group" aria-label="Timeframe">
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
                className={`chart-chip chart-chip--soft ${showHeatmap ? "is-active" : ""}`}
                onClick={() => {
                  setShowHeatmap((v) => {
                    const next = !v;
                    if (next && orderBook) pushHeatColumn(orderBook, selected);
                    return next;
                  });
                }}
                title="Bookmap-stylová heatmapa likvidity z order booku"
              >
                Heatmap
              </button>
              <button
                type="button"
                className="chart-chip chart-chip--soft"
                onClick={() => {
                  void loadOverview();
                  void loadChart(selected, interval);
                  void loadOrderBook(selected, showHeatmap);
                  if (quotes.length) void loadSparks(quotes.map((q) => q.symbol));
                }}
                disabled={loading || chartBusy}
              >
                {loading || chartBusy ? "…" : "↻"}
              </button>
            </div>
          </div>

          <div className="cryptosense__panel-tabs" role="tablist" aria-label="Graf nebo order book">
            <button
              type="button"
              role="tab"
              aria-selected={mobilePanel === "chart"}
              className={`cryptosense__panel-tab ${mobilePanel === "chart" ? "is-active" : ""}`}
              onClick={() => setMobilePanel("chart")}
            >
              Graf
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mobilePanel === "book"}
              className={`cryptosense__panel-tab ${mobilePanel === "book" ? "is-active" : ""}`}
              onClick={() => setMobilePanel("book")}
            >
              Order book
            </button>
          </div>

          <div className="instrument-chart__stage crypto-chart-stage cryptosense__chart-pane">
            {ohlcv?.ohlcv?.length ? (
              <PriceChart
                bars={ohlcv.ohlcv}
                showMa={!["1s", "1m"].includes(interval)}
                realtime
                secondsVisible={interval === "1s" || interval === "1m"}
                heatmap={heatmap}
                showHeatmap={showHeatmap}
              />
            ) : (
              <div className="muted p-6 text-sm">
                {chartBusy ? "Připravuji svíčky…" : "Žádná OHLCV data."}
              </div>
            )}
          </div>

          <div className="cryptosense__ob-in-card">
            <OrderBookPanel book={orderBook} />
          </div>
        </section>

        <div className="cryptosense__ob-side">
          <OrderBookPanel book={orderBook} />
        </div>
      </div>
    </div>
  );
}
