"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { apiFetch, apiWsUrl } from "@/lib/api";
import { PriceChart, type ChartBar } from "@/components/PriceChart";
import { HeaderExtra, HeaderQuote } from "@/components/HeaderExtra";
import { IconDraw } from "@/components/NavIcons";
import { OrderBookPanel, type OrderBookData } from "@/components/OrderBookPanel";
import { TradesTapePanel, type TradesTapeData } from "@/components/TradesTapePanel";
import type { ChartDrawing, DrawTool } from "@/lib/chart";
import type { LinearDeskInfo } from "@/lib/desks";
import { useChartViz } from "@/lib/chartViz";

type DeskChartResponse = {
  symbol: string;
  label: string;
  note: string;
  interval: string;
  lookback: string;
  bars_count: number;
  as_of: string;
  price: number | null;
  change_pct: number | null;
  change_pct_window: number | null;
  source?: string;
  bars: ChartBar[];
};

export type BybitDeskConfig = LinearDeskInfo;

const DESK_STORE = "stocksense-desk";
const DEFAULT_DRAWINGS = { items: [] as ChartDrawing[] };

const TIMEFRAMES = [
  { id: "1s", label: "1 S", defaultLookback: "1h" },
  { id: "1m", label: "1 m", defaultLookback: "1d" },
  { id: "5m", label: "5 m", defaultLookback: "5d" },
  { id: "15m", label: "15 m", defaultLookback: "5d" },
  { id: "30m", label: "30 m", defaultLookback: "1mo" },
  { id: "1h", label: "1 H", defaultLookback: "1mo" },
  { id: "4h", label: "4 H", defaultLookback: "3mo" },
  { id: "1d", label: "D", defaultLookback: "6mo" },
  { id: "1wk", label: "W", defaultLookback: "2y" },
] as const;

const LOOKBACKS_BY_TF: Record<string, { id: string; label: string }[]> = {
  "1s": [
    { id: "15m", label: "15 m" },
    { id: "1h", label: "1 H" },
    { id: "4h", label: "4 H" },
  ],
  "1m": [
    { id: "1d", label: "1 D" },
    { id: "5d", label: "5 D" },
    { id: "7d", label: "7 D" },
  ],
  "5m": [
    { id: "5d", label: "5 D" },
    { id: "1mo", label: "1 M" },
  ],
  "15m": [
    { id: "5d", label: "5 D" },
    { id: "1mo", label: "1 M" },
  ],
  "30m": [
    { id: "5d", label: "5 D" },
    { id: "1mo", label: "1 M" },
  ],
  "1h": [
    { id: "5d", label: "5 D" },
    { id: "1mo", label: "1 M" },
    { id: "3mo", label: "3 M" },
    { id: "6mo", label: "6 M" },
  ],
  "4h": [
    { id: "1mo", label: "1 M" },
    { id: "3mo", label: "3 M" },
    { id: "6mo", label: "6 M" },
    { id: "1y", label: "1 R" },
  ],
  "1d": [
    { id: "1mo", label: "1 M" },
    { id: "3mo", label: "3 M" },
    { id: "6mo", label: "6 M" },
    { id: "1y", label: "1 R" },
    { id: "2y", label: "2 R" },
    { id: "5y", label: "5 R" },
  ],
  "1wk": [
    { id: "1y", label: "1 R" },
    { id: "2y", label: "2 R" },
    { id: "5y", label: "5 R" },
  ],
};

function fmtPrice(n: number | null | undefined, digits = 2) {
  if (n == null) return "—";
  return n.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

function fmtPct(n: number | null | undefined) {
  if (n == null) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

type OilLiveResponse = {
  price: number;
  change_pct: number | null;
  as_of: string;
  bar: ChartBar;
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

function mergeLiveBar(bars: ChartBar[], live: ChartBar): ChartBar[] {
  if (!bars.length) return [live];
  const lastTs = Date.parse(bars[bars.length - 1].ts);
  const liveTs = Date.parse(live.ts);
  if (Number.isFinite(liveTs) && liveTs > lastTs + 400) {
    return [...bars, live];
  }
  return [...bars.slice(0, -1), { ...bars[bars.length - 1], ...live }];
}

function applyLiveBar(prev: DeskChartResponse, live: ChartBar, extra?: Partial<DeskChartResponse>): DeskChartResponse {
  const bars = mergeLiveBar(prev.bars, live);
  const last = bars[bars.length - 1];
  const prevBar = bars.length > 1 ? bars[bars.length - 2] : last;
  const change_pct =
    prevBar.close ? ((last.close - prevBar.close) / prevBar.close) * 100 : prev.change_pct;
  return {
    ...prev,
    ...extra,
    price: last.close,
    change_pct,
    as_of: last.ts,
    bars,
    bars_count: bars.length,
  };
}

function HeaderPick({
  label,
  ariaLabel,
  value,
  options,
  onSelect,
}: {
  label: string;
  ariaLabel: string;
  value: string;
  options: { id: string; label: string }[];
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onPtr = (e: PointerEvent) => {
      const t = e.target;
      if (!(t instanceof Node)) return;
      if (btnRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPtr);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPtr);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const header = document.querySelector(".app-header");
    const headerBottom = header?.getBoundingClientRect().bottom ?? r.bottom;
    setPos({ top: headerBottom + 8, left: r.left });
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`chart-chip header-desk__tf-btn ${open ? "is-active" : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((v) => !v)}
      >
        {label}
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            className="tf-menu"
            role="menu"
            style={{ top: pos.top, left: pos.left }}
          >
            {options.map((opt) => (
              <button
                key={opt.id}
                type="button"
                role="menuitem"
                className={`tf-menu__item ${value === opt.id ? "is-active" : ""}`}
                onClick={() => {
                  onSelect(opt.id);
                  setOpen(false);
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>,
          document.body
        )}
    </>
  );
}

function usePersistedJson<T extends object>(key: string, fallback: T) {
  const [value, setValue] = useState<T>(fallback);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<T>;
      if (parsed && typeof parsed === "object") setValue({ ...fallback, ...parsed });
    } catch {
      /* ignore */
    }
  }, [key, fallback]);
  const update = useCallback(
    (patch: Partial<T>) => {
      setValue((prev) => {
        const next = { ...prev, ...patch };
        try {
          window.localStorage.setItem(key, JSON.stringify(next));
        } catch {
          /* ignore */
        }
        return next;
      });
    },
    [key]
  );
  const reset = useCallback(() => {
    setValue(fallback);
    try {
      window.localStorage.setItem(key, JSON.stringify(fallback));
    } catch {
      /* ignore */
    }
  }, [key, fallback]);
  return [value, update, reset] as const;
}

export function BybitDesk({ config }: { config: BybitDeskConfig }) {
  const apiBase = `/desk/${config.id}`;
  const loadError = `Načtení ${config.fallbackSymbol} selhalo`;
  const loadingLabel = `Stahuji ${config.fallbackSymbol}…`;
  const [data, setData] = useState<DeskChartResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [timeframe, setTimeframe] = useState("1m");
  const [lookback, setLookback] = useState("1d");
  const [live, setLive] = useState(false);
  const [tradesTape, setTradesTape] = useState<TradesTapeData | null>(null);
  const [orderBook, setOrderBook] = useState<OrderBookData | null>(null);
  const [drawBarOpen, setDrawBarOpen] = useState(false);
  const { viz: chartViz } = useChartViz();
  const [drawingsStore, setDrawingsStore] = usePersistedJson<{ items: ChartDrawing[] }>(
    `${DESK_STORE}-draw-${config.id}`,
    DEFAULT_DRAWINGS
  );
  const [drawTool, setDrawTool] = useState<DrawTool>("none");

  const [deskPrefsReady, setDeskPrefsReady] = useState(false);

  useEffect(() => {
    try {
      const tfRaw = window.localStorage.getItem(`${DESK_STORE}-tf`);
      const lbRaw = window.localStorage.getItem(`${DESK_STORE}-lb`);
      const tfOk = TIMEFRAMES.some((t) => t.id === tfRaw) ? tfRaw! : "1m";
      const allowed = LOOKBACKS_BY_TF[tfOk] || LOOKBACKS_BY_TF["1d"];
      const tfMeta = TIMEFRAMES.find((t) => t.id === tfOk);
      const lbOk = allowed.some((r) => r.id === lbRaw)
        ? lbRaw!
        : tfMeta?.defaultLookback || "1d";
      setTimeframe(tfOk);
      setLookback(lbOk);
    } catch {
      /* ignore */
    }
    setDeskPrefsReady(true);
  }, []);

  const loadOrderBook = useCallback(async () => {
      try {
        const res = await apiFetch<OrderBookData>(`${apiBase}/orderbook?limit=200`);
        setOrderBook(res);
      } catch {
        /* keep last book */
      }
    }, [apiBase]);

  const loadTrades = useCallback(async () => {
    try {
      const res = await apiFetch<TradesTapeData>(`${apiBase}/trades?limit=90`);
      setTradesTape(res);
    } catch {
      /* keep last tape */
    }
  }, [apiBase]);

  const loadGen = useRef(0);
  const load = useCallback(async (iv: string, lb: string, silent = false) => {
    const gen = ++loadGen.current;
    if (!silent) setLoading(true);
    try {
      const res = await apiFetch<DeskChartResponse>(
        `${apiBase}/chart?interval=${encodeURIComponent(iv)}&lookback=${encodeURIComponent(lb)}`
      );
      if (gen !== loadGen.current) return;
      setData(res);
      setError(null);
    } catch (err) {
      if (gen !== loadGen.current) return;
      if (!silent) setError(err instanceof Error ? err.message : loadError);
    } finally {
      if (gen === loadGen.current && !silent) setLoading(false);
    }
  }, [apiBase, loadError]);

  useEffect(() => {
    if (!deskPrefsReady) return;
    void load(timeframe, lookback);
  }, [deskPrefsReady, load, timeframe, lookback]);

  useEffect(() => {
    void loadOrderBook();
    const id = window.setInterval(() => void loadOrderBook(), 650);
    return () => window.clearInterval(id);
  }, [loadOrderBook]);

  useEffect(() => {
    void loadTrades();
    const id = window.setInterval(() => void loadTrades(), 1500);
    return () => window.clearInterval(id);
  }, [loadTrades]);

  useEffect(() => {
    if (loading || !data?.source?.startsWith("bybit")) return;
    let closed = false;
    let ws: WebSocket | null = null;
    let retry: number | null = null;
    const tf = timeframe;

    const connect = () => {
      if (closed) return;
      const url = apiWsUrl(`${apiBase}/ws/ohlcv?interval=${encodeURIComponent(tf)}`);
      ws = new WebSocket(url);
      ws.onopen = () => setLive(true);
      ws.onclose = () => {
        setLive(false);
        if (!closed) retry = window.setTimeout(connect, 1500);
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
          if (msg.type === "error" || msg.ts == null || msg.close == null) return;
          setData((prev) => {
            if (!prev) return prev;
            return applyLiveBar(prev, {
              ts: msg.ts,
              open: msg.open,
              high: msg.high,
              low: msg.low,
              close: msg.close,
              volume: msg.volume,
            });
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
  }, [timeframe, loading, data?.source, apiBase]);

  useEffect(() => {
    if (loading || live) return;
    let cancelled = false;
    let inflight = false;
    const tick = async () => {
      if (cancelled || inflight) return;
      if (document.visibilityState !== "visible") return;
      inflight = true;
      try {
        const snap = await apiFetch<OilLiveResponse>(
          `${apiBase}/live?interval=${encodeURIComponent(timeframe)}`
        );
        if (cancelled) return;
        setData((prev) => (prev ? applyLiveBar(prev, snap.bar, { change_pct: snap.change_pct }) : prev));
      } catch {
        /* keep last snapshot */
      } finally {
        inflight = false;
      }
    };
    const first = window.setTimeout(() => void tick(), 1000);
    const id = window.setInterval(() => void tick(), 2000);
    return () => {
      cancelled = true;
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, [timeframe, loading, live, apiBase]);

  function selectTimeframe(tfId: string) {
    const tf = TIMEFRAMES.find((t) => t.id === tfId);
    if (!tf) return;
    const allowed = LOOKBACKS_BY_TF[tfId] || LOOKBACKS_BY_TF["1d"];
    const nextLb = allowed.some((r) => r.id === lookback) ? lookback : tf.defaultLookback;
    setTimeframe(tfId);
    setLookback(nextLb);
  }

  useEffect(() => {
    if (!deskPrefsReady) return;
    try {
      window.localStorage.setItem(`${DESK_STORE}-tf`, timeframe);
      window.localStorage.setItem(`${DESK_STORE}-lb`, lookback);
    } catch {
      /* ignore */
    }
  }, [deskPrefsReady, timeframe, lookback]);

  const up = (data?.change_pct ?? data?.change_pct_window ?? 0) >= 0;
  const ranges = LOOKBACKS_BY_TF[timeframe] || LOOKBACKS_BY_TF["1d"];
  const tfLabel = TIMEFRAMES.find((t) => t.id === timeframe)?.label ?? timeframe;
  const lbLabel = ranges.find((r) => r.id === lookback)?.label ?? lookback;

  return (
    <div className="gold-page oil-page">
      <HeaderQuote>
        <p className="header-desk__quote">
          <span className="header-desk__px-row">
            <span className="cryptosense__px">{fmtPrice(data?.price, config.priceDigits)}</span>
            <span className={`cryptosense__chg ${up ? "is-up" : "is-down"}`}>
              {fmtPct(data?.change_pct ?? data?.change_pct_window)}
            </span>
          </span>
          <span className={`header-desk__live${live ? " is-on" : ""}`} title={config.liveTitle}>
            <span className="header-desk__live-dot" aria-hidden />
            live
            <span className="header-desk__venue">
              {orderBook?.execution_exchange || tradesTape?.execution_exchange || "bybit"}
            </span>
          </span>
        </p>
      </HeaderQuote>
      <HeaderExtra>
        <div className="header-desk">
          <div className="header-desk__tools">
            <div className="header-desk__sec" role="group" aria-label="Timeframe">
              <HeaderPick
                label={tfLabel}
                ariaLabel="Timeframe"
                value={timeframe}
                options={TIMEFRAMES.map((t) => ({ id: t.id, label: t.label }))}
                onSelect={selectTimeframe}
              />
              <HeaderPick
                label={lbLabel}
                ariaLabel="Období"
                value={lookback}
                options={ranges}
                onSelect={setLookback}
              />
            </div>
            <span className="header-desk__div" aria-hidden />
            <div className="header-desk__sec" role="group" aria-label="Kreslení">
              <button
                type="button"
                className={`chart-chip chart-chip--soft chart-chip--icon ${drawBarOpen ? "is-active" : ""}`}
                onClick={() => {
                  setDrawBarOpen((open) => {
                    const next = !open;
                    if (!next) setDrawTool("none");
                    return next;
                  });
                }}
                aria-pressed={drawBarOpen}
                aria-label="Kreslení"
                title="Kreslení"
              >
                <IconDraw size={18} />
              </button>
            </div>
          </div>
        </div>
      </HeaderExtra>

      {error && (
        <p className="card gold-page__error" role="alert">
          {error}
        </p>
      )}

      <div className="oil-page__desk">
      <section className="card instrument-chart gold-page__chart">
        <div className="instrument-chart__stage crypto-chart-stage gold-page__chart-pane">
          {data?.bars?.length ? (
            <div className="desk-charts">
              <div className="desk-charts__pane">
                <PriceChart
                  bars={data.bars}
                  realtime
                  showMa={false}
                  showVolume={chartViz.volume}
                  secondsVisible={timeframe === "1m" || timeframe === "1s"}
                  chartViz={chartViz}
                  drawTool={drawTool}
                  drawings={drawingsStore.items}
                  onDrawingsChange={(items) => setDrawingsStore({ items })}
                />
                {drawBarOpen ? (
                  <div className="draw-toolbar" role="toolbar" aria-label="Kreslení">
                    {(
                      [
                        ["trend", "Trend"],
                        ["ray", "Ray"],
                        ["rect", "Box"],
                        ["hline", "H"],
                      ] as const
                    ).map(([id, lab]) => (
                      <button
                        key={id}
                        type="button"
                        className={`draw-toolbar__btn ${drawTool === id ? "is-active" : ""}`}
                        onClick={() => setDrawTool((t) => (t === id ? "none" : id))}
                      >
                        {lab}
                      </button>
                    ))}
                    <button
                      type="button"
                      className="draw-toolbar__btn"
                      onClick={() => {
                        setDrawingsStore({ items: [] });
                        setDrawTool("none");
                      }}
                      title="Smazat kresby"
                    >
                      Smazat
                    </button>
                    <button
                      type="button"
                      className="draw-toolbar__btn"
                      onClick={() => {
                        setDrawBarOpen(false);
                        setDrawTool("none");
                      }}
                      title="Zavřít kreslení"
                    >
                      Hotovo
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="muted p-6 text-sm">
              {loading ? loadingLabel : "Žádná OHLCV data."}
            </div>
          )}
          {loading && data?.bars?.length ? (
            <div className="chart-loading-overlay" aria-live="polite">
              Načítám…
            </div>
          ) : null}
        </div>
      </section>
      <div className="oil-page__ob-side">
            <div className="oil-page__panel">
              <OrderBookPanel book={orderBook} priceDigits={config.priceDigits} />
            </div>
            <div className="oil-page__panel">
              <TradesTapePanel tape={tradesTape} />
            </div>
      </div>
      </div>
    </div>
  );
}
