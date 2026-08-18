"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { apiFetch, apiWsUrl } from "@/lib/api";
import { PriceChart, type ChartBar, type HeatmapLevel, type HeatVizSettings, type ChartVizSettings, DEFAULT_HEAT_VIZ, DEFAULT_DESK_CHART_VIZ } from "@/components/PriceChart";
import { HeaderExtra } from "@/components/HeaderExtra";
import { type FootprintData, type FpVizSettings, DEFAULT_FP_VIZ } from "@/components/FootprintChart";
import { FootprintSettingsPanel } from "@/components/FootprintSettingsPanel";
import { type OrderBookData } from "@/components/OrderBookPanel";
import { TradesTapePanel, type TradesTapeData } from "@/components/TradesTapePanel";
import { LiquidityPanel } from "@/components/LiquidityPanel";
import { analyzeLiquidity, rememberBook, type BookMem } from "@/lib/liquidity";
import {
  levelsFromWireBars,
  type SessionProfile,
} from "@/lib/orderflow";
import type { ChartDrawing, DrawTool } from "@/lib/chart";
import type { LinearDeskInfo } from "@/lib/desks";

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
const DEFAULT_TAPE_VIZ = { smart: true, blockSize: 0 };
const DEFAULT_DRAWINGS = { items: [] as ChartDrawing[] };

const TIMEFRAMES = [
  { id: "1s", label: "1 S", defaultLookback: "1h" },
  { id: "1m", label: "1 M", defaultLookback: "1d" },
  { id: "5m", label: "5 M", defaultLookback: "5d" },
  { id: "15m", label: "15 M", defaultLookback: "5d" },
  { id: "30m", label: "30 M", defaultLookback: "1mo" },
  { id: "1h", label: "1 H", defaultLookback: "1mo" },
  { id: "4h", label: "4 H", defaultLookback: "3mo" },
  { id: "1d", label: "D", defaultLookback: "6mo" },
  { id: "1wk", label: "W", defaultLookback: "2y" },
] as const;

const LOOKBACKS_BY_TF: Record<string, { id: string; label: string }[]> = {
  "1s": [
    { id: "15m", label: "15 M" },
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
    setPos({ top: r.bottom, left: r.left });
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
        <span className="header-desk__tf-caret" aria-hidden>
          ▾
        </span>
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

function VizMenu({
  title,
  ariaLabel,
  label,
  wide,
  children,
}: {
  title: string;
  ariaLabel: string;
  label?: string;
  wide?: boolean;
  children: ReactNode;
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
    const width = wide ? 360 : 300;
    let left = r.left;
    if (left + width > window.innerWidth - 8) left = Math.max(8, r.right - width);
    setPos({ top: r.bottom + 4, left });
  }, [open, wide]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`chart-chip chart-chip--soft ${label ? "" : "chart-chip--gear "}${open ? "is-active" : ""}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={ariaLabel}
        title={ariaLabel}
        onClick={() => setOpen((v) => !v)}
      >
        {label || "⚙"}
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            className={`tf-menu viz-menu${wide ? " viz-menu--wide" : ""}`}
            role="dialog"
            aria-label={title}
            style={{ top: pos.top, left: pos.left }}
          >
            <p className="viz-menu__title">{title}</p>
            {children}
          </div>,
          document.body
        )}
    </>
  );
}

function VizRow({
  label,
  value,
  children,
}: {
  label: string;
  value: string;
  children: ReactNode;
}) {
  return (
    <label className="viz-menu__row">
      <span className="viz-menu__lab">
        {label}
        <span className="muted">{value}</span>
      </span>
      {children}
    </label>
  );
}

function usePersistedOpen(key: string, fallback = true) {
  const [open, setOpen] = useState(fallback);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw === "0") setOpen(false);
      if (raw === "1") setOpen(true);
    } catch {
      /* ignore */
    }
  }, [key]);
  const set = useCallback(
    (next: boolean | ((v: boolean) => boolean)) => {
      setOpen((v) => {
        const val = typeof next === "function" ? next(v) : next;
        try {
          window.localStorage.setItem(key, val ? "1" : "0");
        } catch {
          /* ignore */
        }
        return val;
      });
    },
    [key]
  );
  const toggle = useCallback(() => set((v) => !v), [set]);
  return [open, toggle, set] as const;
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
  const [tapeOpen, toggleTape] = usePersistedOpen(`${DESK_STORE}-tape`, true);
  const [liqOpen, toggleLiq] = usePersistedOpen(`${DESK_STORE}-liq`, true);
  const [showHeatmap, , setShowHeatmap] = usePersistedOpen(`${DESK_STORE}-heat`, true);
  const [heatmapLevels, setHeatmapLevels] = useState<HeatmapLevel[]>([]);
  const bookMemRef = useRef<BookMem>(new Map());
  const bookSrcRef = useRef<HeatmapLevel[] | null>(null);
  const [heatOpacity, setHeatOpacity] = useState(0.55);
  const [footprint, , setFootprint] = usePersistedOpen(`${DESK_STORE}-fp`, false);
  const [fpSettingsOpen, , setFpSettingsOpen] = usePersistedOpen(`${DESK_STORE}-fp-settings`, false);
  const [fpData, setFpData] = useState<FootprintData | null>(null);
  const [heatViz, setHeatViz, resetHeatViz] = usePersistedJson<HeatVizSettings>(
    `${DESK_STORE}-l2-viz`,
    DEFAULT_HEAT_VIZ
  );
  const [fpViz, setFpViz, resetFpViz] = usePersistedJson<FpVizSettings>(
    `${DESK_STORE}-fp-viz`,
    DEFAULT_FP_VIZ
  );
  const [chartViz, setChartViz, resetChartViz] = usePersistedJson<ChartVizSettings>(
    `${DESK_STORE}-chart-viz`,
    DEFAULT_DESK_CHART_VIZ
  );
  const [drawingsStore, setDrawingsStore] = usePersistedJson<{ items: ChartDrawing[] }>(
    `${DESK_STORE}-draw-${config.id}`,
    DEFAULT_DRAWINGS
  );
  const [drawTool, setDrawTool] = useState<DrawTool>("none");
  const [tapeViz, setTapeViz] = usePersistedJson(`${DESK_STORE}-tape-viz`, DEFAULT_TAPE_VIZ);

  const [deskPrefsReady, setDeskPrefsReady] = useState(false);

  useEffect(() => {
    try {
      const tfRaw = window.localStorage.getItem(`${DESK_STORE}-tf`);
      const lbRaw = window.localStorage.getItem(`${DESK_STORE}-lb`);
      const alpha = window.localStorage.getItem(`${DESK_STORE}-alpha`);
      const tfOk = TIMEFRAMES.some((t) => t.id === tfRaw) ? tfRaw! : "1m";
      const allowed = LOOKBACKS_BY_TF[tfOk] || LOOKBACKS_BY_TF["1d"];
      const tfMeta = TIMEFRAMES.find((t) => t.id === tfOk);
      const lbOk = allowed.some((r) => r.id === lbRaw)
        ? lbRaw!
        : tfMeta?.defaultLookback || "1d";
      setTimeframe(tfOk);
      setLookback(lbOk);
      if (alpha) {
        const n = Number(alpha);
        if (Number.isFinite(n)) setHeatOpacity(Math.min(1, Math.max(0.15, n)));
      }
    } catch {
      /* ignore */
    }
    setDeskPrefsReady(true);
  }, []);

  const applyHeatLevels = useCallback((res: OrderBookData) => {
    const priceMap = new Map<number, { bid: number; ask: number }>();
    for (const lvl of res.bids || []) {
      if (!lvl || !(lvl.price > 0)) continue;
      priceMap.set(lvl.price, { bid: lvl.amount || 0, ask: 0 });
    }
    for (const lvl of res.asks || []) {
      if (!lvl || !(lvl.price > 0)) continue;
      const cur = priceMap.get(lvl.price) || { bid: 0, ask: 0 };
      cur.ask = lvl.amount || 0;
      priceMap.set(lvl.price, cur);
    }
    if (!priceMap.size) return;
    setHeatmapLevels(
      [...priceMap.entries()].map(([price, v]) => ({ price, bid: v.bid, ask: v.ask }))
    );
  }, []);

  const loadOrderBook = useCallback(async () => {
      try {
        const res = await apiFetch<OrderBookData>(`${apiBase}/orderbook?limit=400`);
        applyHeatLevels(res);
      } catch {
        /* keep last book */
      }
    }, [applyHeatLevels, apiBase]);

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
    if (!deskPrefsReady) return;
    let cancelled = false;
    const iv = timeframe;
    const lb = lookback;
    const tick = async () => {
      try {
        const res = await apiFetch<FootprintData>(
          `${apiBase}/footprint?interval=${encodeURIComponent(iv)}&lookback=${encodeURIComponent(lb)}`
        );
        if (cancelled) return;
        setFpData((prev) => {
          const a = prev?.bars[prev.bars.length - 1];
          const b = res.bars[res.bars.length - 1];
          if (
            prev &&
            prev.interval === res.interval &&
            prev.tick === res.tick &&
            prev.bars.length === res.bars.length &&
            a &&
            b &&
            a.ts === b.ts &&
            a.volume === b.volume &&
            a.delta === b.delta &&
            a.close === b.close
          ) {
            return prev;
          }
          return res;
        });
      } catch {
        /* keep last */
      }
    };
    void tick();
    const id = window.setInterval(() => void tick(), footprint ? 1000 : 4000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [deskPrefsReady, footprint, timeframe, lookback, apiBase]);

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

  useEffect(() => {
    try {
      if (window.localStorage.getItem(`${DESK_STORE}-vol-stats`) === "1") return;
      window.localStorage.setItem(`${DESK_STORE}-vol-stats`, "1");
      setChartViz({ volume: true });
    } catch {
      /* ignore */
    }
  }, [setChartViz]);

  useEffect(() => {
    try {
      window.localStorage.setItem(`${DESK_STORE}-alpha`, String(heatOpacity));
    } catch {
      /* ignore */
    }
  }, [heatOpacity]);

  const up = (data?.change_pct ?? data?.change_pct_window ?? 0) >= 0;
  const ranges = LOOKBACKS_BY_TF[timeframe] || LOOKBACKS_BY_TF["1d"];
  const tfLabel = TIMEFRAMES.find((t) => t.id === timeframe)?.label ?? timeframe;
  const lbLabel = ranges.find((r) => r.id === lookback)?.label ?? lookback;
  const lastClose = data?.bars?.length
    ? data.bars[data.bars.length - 1].close
    : data?.price ?? 0;
  const session: SessionProfile | null = useMemo(() => {
    if (!fpData?.bars.length) return null;
    const tick = (fpData.tick || config.tick) * (fpViz.tickGroup || 1);
    return levelsFromWireBars(fpData.bars, tick);
  }, [fpData, fpViz.tickGroup, config.tick]);

  const liqSnap = useMemo(() => {
    const sessionVol = new Map((session?.rows || []).map((r) => [r.price, r.totalVolume]));
    const snap = analyzeLiquidity({
      levels: heatmapLevels,
      viz: heatViz,
      tick: config.tick,
      lastClose: lastClose || 0,
      sessionVol,
      bookMem: bookMemRef.current,
      tape: tradesTape?.trades,
      fpBars: fpData?.bars,
    });
    if (snap && bookSrcRef.current !== heatmapLevels) {
      bookMemRef.current = rememberBook(bookMemRef.current, snap.rows);
      bookSrcRef.current = heatmapLevels;
    }
    return snap;
  }, [heatmapLevels, heatViz, config.tick, lastClose, session, fpData, tradesTape]);

  return (
    <div className="gold-page oil-page">
      <HeaderExtra>
        <div className="header-desk">
          <div className="header-desk__id">
            <p className="header-desk__title">{config.title}</p>
            <p className="header-desk__quote">
              <span className="badge">{data?.symbol || config.fallbackSymbol}</span>
              {live && (
                <span className="header-desk__live" title={config.liveTitle}>
                  <span className="header-desk__live-dot" aria-hidden />
                  live
                </span>
              )}
              <span className="cryptosense__px">{fmtPrice(data?.price, config.priceDigits)}</span>
              <span className={`cryptosense__chg ${up ? "is-up" : "is-down"}`}>
                {fmtPct(data?.change_pct ?? data?.change_pct_window)}
              </span>
              {data && (
                <span className="header-desk__bars">
                  {data.interval} · {data.lookback} · {data.bars_count}
                  {data.source?.includes("ticks") ? " · tick" : ""}
                </span>
              )}
            </p>
          </div>
          <div className="header-desk__tools">
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
            <VizMenu title="Graf" ariaLabel="Nastavení grafu" label="Graf">
              <p className="viz-menu__sec">Vzhled</p>
              <div className="viz-menu__row">
                <span className="viz-menu__lab">Styl</span>
                <div className="viz-menu__seg">
                  {(
                    [
                      ["candle", "Svíčky"],
                      ["hollow", "Duté"],
                      ["line", "Čára"],
                    ] as const
                  ).map(([id, lab]) => (
                    <button
                      key={id}
                      type="button"
                      className={`chart-chip chart-chip--soft ${chartViz.style === id ? "is-active" : ""}`}
                      onClick={() => setChartViz({ style: id })}
                    >
                      {lab}
                    </button>
                  ))}
                </div>
              </div>
              <div className="viz-menu__row">
                <span className="viz-menu__lab">Kříž</span>
                <div className="viz-menu__seg">
                  {(
                    [
                      ["normal", "Normální"],
                      ["magnet", "Magnet"],
                      ["off", "Vyp"],
                    ] as const
                  ).map(([id, lab]) => (
                    <button
                      key={id}
                      type="button"
                      className={`chart-chip chart-chip--soft ${chartViz.crosshair === id ? "is-active" : ""}`}
                      onClick={() => setChartViz({ crosshair: id })}
                    >
                      {lab}
                    </button>
                  ))}
                </div>
              </div>
              <label className="viz-menu__check">
                <input
                  type="checkbox"
                  checked={chartViz.grid}
                  onChange={(e) => setChartViz({ grid: e.target.checked })}
                />
                Mřížka
              </label>
              <label className="viz-menu__check">
                <input
                  type="checkbox"
                  checked={chartViz.wicks}
                  onChange={(e) => setChartViz({ wicks: e.target.checked })}
                />
                Knoty
              </label>
              <label className="viz-menu__check">
                <input
                  type="checkbox"
                  checked={chartViz.priceLine}
                  onChange={(e) => setChartViz({ priceLine: e.target.checked })}
                />
                Čára poslední ceny
              </label>
              <label className="viz-menu__check">
                <input
                  type="checkbox"
                  checked={chartViz.lastValue}
                  onChange={(e) => setChartViz({ lastValue: e.target.checked })}
                />
                Label na ose
              </label>
              <label className="viz-menu__check">
                <input
                  type="checkbox"
                  checked={chartViz.logScale}
                  onChange={(e) => setChartViz({ logScale: e.target.checked })}
                />
                Logaritmická škála
              </label>
              <p className="viz-menu__sec">Indikátory</p>
              <label className="viz-menu__check">
                <input
                  type="checkbox"
                  checked={chartViz.sma20}
                  onChange={(e) => setChartViz({ sma20: e.target.checked })}
                />
                SMA 20
              </label>
              <label className="viz-menu__check">
                <input
                  type="checkbox"
                  checked={chartViz.sma50}
                  onChange={(e) => setChartViz({ sma50: e.target.checked })}
                />
                SMA 50
              </label>
              <label className="viz-menu__check">
                <input
                  type="checkbox"
                  checked={chartViz.ema20}
                  onChange={(e) => setChartViz({ ema20: e.target.checked })}
                />
                EMA 20
              </label>
              <label className="viz-menu__check">
                <input
                  type="checkbox"
                  checked={chartViz.rsi}
                  onChange={(e) => setChartViz({ rsi: e.target.checked })}
                />
                RSI 14
              </label>
              <label className="viz-menu__check">
                <input
                  type="checkbox"
                  checked={chartViz.volume}
                  onChange={(e) => setChartViz({ volume: e.target.checked })}
                />
                Volume histogram
              </label>
              <p className="viz-menu__sec">Měřítko</p>
              <VizRow label="Šířka svíček" value={`${chartViz.barSpacing} px`}>
                <input
                  type="range"
                  min={4}
                  max={72}
                  value={chartViz.barSpacing}
                  onChange={(e) => setChartViz({ barSpacing: Number(e.target.value) })}
                />
              </VizRow>
              <VizRow label="Pravý okraj" value={chartViz.rightOffset <= 0 ? "lepit" : `${chartViz.rightOffset}`}>
                <input
                  type="range"
                  min={0}
                  max={12}
                  value={chartViz.rightOffset >= 6 ? 0 : chartViz.rightOffset}
                  onChange={(e) => setChartViz({ rightOffset: Number(e.target.value) })}
                />
              </VizRow>
              <button type="button" className="viz-menu__reset" onClick={resetChartViz}>
                Výchozí
              </button>
            </VizMenu>
            <div className="viz-menu__seg header-desk__draw">
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
                  className={`chart-chip chart-chip--soft ${drawTool === id ? "is-active" : ""}`}
                  onClick={() => setDrawTool((t) => (t === id ? "none" : id))}
                  title={lab}
                >
                  {lab}
                </button>
              ))}
              <button
                type="button"
                className="chart-chip chart-chip--soft"
                onClick={() => {
                  setDrawingsStore({ items: [] });
                  setDrawTool("none");
                }}
                title="Smazat kresby"
              >
                ⌫
              </button>
            </div>
            <button
              type="button"
              className={`chart-chip chart-chip--soft ${footprint ? "is-active" : ""}`}
              onClick={() =>
                setFootprint((v) => {
                  if (!v && chartViz.barSpacing < 20) setChartViz({ barSpacing: 24 });
                  return !v;
                })
              }
              aria-pressed={footprint}
              title="Footprint — volume na ceně z Bybit tradů"
            >
              FP
            </button>
            <button
              type="button"
              className={`chart-chip chart-chip--soft ${fpSettingsOpen ? "is-active" : ""}`}
              onClick={() => {
                setFpSettingsOpen((open) => {
                  const next = !open;
                  if (next) {
                    setFootprint(true);
                    if (chartViz.barSpacing < 20) setChartViz({ barSpacing: 24 });
                  }
                  return next;
                });
              }}
              aria-pressed={fpSettingsOpen}
              title="Nastavení footprintu — panel vpravo, zůstane otevřený"
            >
              FP nastavení
            </button>
          </div>
        </div>
      </HeaderExtra>

      {error && (
        <p className="card gold-page__error" role="alert">
          {error}
        </p>
      )}

      <div className={`oil-page__desk${fpSettingsOpen ? " is-fp-settings" : ""}`}>
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
                  heatmapLevels={heatmapLevels}
                  showHeatmap={showHeatmap}
                  heatOpacity={heatOpacity}
                  heatViz={heatViz}
                  tick={config.tick}
                  priceDigits={config.priceDigits}
                  session={session}
                  onProfileWidthChange={(frac) => setHeatViz({ profileWidth: frac })}
                  showFootprint={footprint}
                  footprintData={fpData}
                  tapePrints={tradesTape?.trades ?? null}
                  fpViz={fpViz}
                  onFpVizChange={setFpViz}
                  chartViz={chartViz}
                  drawTool={drawTool}
                  drawings={drawingsStore.items}
                  onDrawingsChange={(items) => setDrawingsStore({ items })}
                />
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
        {fpSettingsOpen ? (
          <div className="oil-page__panel oil-page__panel--fp">
            <FootprintSettingsPanel
              viz={fpViz}
              onChange={setFpViz}
              onReset={resetFpViz}
              barSpacing={chartViz.barSpacing}
              onBarSpacing={(n) => setChartViz({ barSpacing: n })}
              onClose={() => setFpSettingsOpen(false)}
            />
          </div>
        ) : (
          <>
        <div className={`oil-page__panel ${liqOpen ? "" : "is-collapsed"}`}>
          <LiquidityPanel
            snapshot={liqSnap}
            showHeatmap={showHeatmap}
            onToggleHeatmap={(on) => setShowHeatmap(on)}
            heatViz={heatViz}
            onHeatViz={setHeatViz}
            onReset={resetHeatViz}
            heatOpacity={heatOpacity}
            onOpacity={setHeatOpacity}
            priceDigits={config.priceDigits}
            collapsed={!liqOpen}
            onToggle={toggleLiq}
          />
        </div>
        <div className={`oil-page__panel ${tapeOpen ? "" : "is-collapsed"}`}>
          <TradesTapePanel
            tape={tradesTape}
            collapsed={!tapeOpen}
            onToggle={toggleTape}
            smart={tapeViz.smart}
            blockSize={tapeViz.blockSize}
            onSmart={(on) => setTapeViz({ smart: on })}
            onBlockSize={(n) => setTapeViz({ blockSize: n })}
          />
        </div>
          </>
        )}
      </div>
      </div>
    </div>
  );
}
