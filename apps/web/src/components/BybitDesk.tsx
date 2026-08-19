"use client";

import { useCallback, useEffect, useMemo, useRef, useState, cloneElement, type PointerEvent as ReactPointerEvent, type ReactElement, type ReactNode } from "react";
import { apiFetch, apiWsUrl } from "@/lib/api";
import { PriceChart, type ChartBar, type ChartStyle, type ChartVizSettings, DEFAULT_DESK_CHART_VIZ } from "@/components/PriceChart";
import { HeaderExtra, HeaderQuote } from "@/components/HeaderExtra";
import { IconBook, IconDom, IconDraw, IconFootprint, IconTape, IconAddChart } from "@/components/NavIcons";
import { OrderBookPanel, type OrderBookData } from "@/components/OrderBookPanel";
import { TradesTapePanel, type TradesTapeData } from "@/components/TradesTapePanel";
import { DeskWindowHead } from "@/components/DeskWindowHead";
import { DeskPick } from "@/components/DeskPick";
import { ChartSettingsPanel } from "@/components/ChartSettingsPanel";
import { FootprintPanel } from "@/components/FootprintPanel";
import { FootprintSettingsPanel } from "@/components/FootprintSettingsPanel";
import { DomPanel } from "@/components/DomPanel";
import { DomSettingsPanel } from "@/components/DomSettingsPanel";
import { bindToolDrag, DeskMosaic, DeskWorkspace, useDeskDrag } from "@/components/DeskMosaic";
import type { ChartDrawing, DrawTool } from "@/lib/chart";
import type { LinearDeskInfo } from "@/lib/desks";
import {
  DEFAULT_DOM_SETTINGS,
  DEFAULT_ORDERFLOW_SETTINGS,
  type DomSettings,
  type FootprintData,
  type OrderflowSettings,
} from "@/lib/orderflow";
import {
  addChart,
  cloneDesk,
  collectChartLeaves,
  DEFAULT_DESK_LAYOUT,
  hasPanel,
  isDeskNode,
  NEW_CHART_DRAG,
  newChartLeaf,
  removeLeaf,
  removePanel,
  togglePanel,
  type DeskNode,
  type DeskPanelId,
} from "@/lib/deskLayout";

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

const CHART_STYLES: { id: ChartStyle; label: string }[] = [
  { id: "candle", label: "Svíčky" },
  { id: "hollow", label: "Duté" },
  { id: "line", label: "Čára" },
];

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

/** Footprint bars are aggregated from 1m clusters — no sub-minute timeframe upstream. */
const FP_TIMEFRAMES = TIMEFRAMES.filter((t) => t.id !== "1s");

const FP_DEFAULT_RANGE = { tf: "1m", lb: "1d" };

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

function lsGet(key: string) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function lsSet(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

function deskPrefKey(deskId: string, name: string) {
  return `${DESK_STORE}-${deskId}-${name}`;
}

type ChartPrefs = {
  tf: string;
  lb: string;
  viz: ChartVizSettings;
  drawings: ChartDrawing[];
  fpViz: OrderflowSettings;
};

function normalizeTfLb(tfRaw: string | null, lbRaw: string | null) {
  const tfOk = TIMEFRAMES.some((t) => t.id === tfRaw) ? tfRaw! : "1m";
  const allowed = LOOKBACKS_BY_TF[tfOk] || LOOKBACKS_BY_TF["1d"];
  const tfMeta = TIMEFRAMES.find((t) => t.id === tfOk);
  const lbOk = allowed.some((r) => r.id === lbRaw) ? lbRaw! : tfMeta?.defaultLookback || "1d";
  return { tf: tfOk, lb: lbOk };
}

function defaultChartPrefs(): ChartPrefs {
  return { tf: "1m", lb: "1d", viz: { ...DEFAULT_DESK_CHART_VIZ }, drawings: [], fpViz: { ...DEFAULT_ORDERFLOW_SETTINGS } };
}

function readChartPrefs(deskId: string, leafId: string): ChartPrefs {
  const paneKey = deskPrefKey(deskId, `pane-${leafId}`);
  try {
    const raw = lsGet(paneKey);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<ChartPrefs>;
      const { tf, lb } = normalizeTfLb(parsed.tf ?? null, parsed.lb ?? null);
      return {
        tf,
        lb,
        viz: { ...DEFAULT_DESK_CHART_VIZ, ...(parsed.viz ?? {}) },
        drawings: Array.isArray(parsed.drawings) ? parsed.drawings : [],
        fpViz: { ...DEFAULT_ORDERFLOW_SETTINGS, ...((parsed as Record<string, unknown>).fpViz as Partial<OrderflowSettings> ?? {}) },
      };
    }
  } catch {
    /* ignore */
  }
  if (leafId === "chart") {
    const { tf, lb } = normalizeTfLb(
      lsGet(deskPrefKey(deskId, "tf")) ?? lsGet(`${DESK_STORE}-tf`),
      lsGet(deskPrefKey(deskId, "lb")) ?? lsGet(`${DESK_STORE}-lb`)
    );
    let viz = { ...DEFAULT_DESK_CHART_VIZ };
    try {
      const vraw = lsGet(deskPrefKey(deskId, "viz")) ?? lsGet("stocksense-desk-chart-viz");
      if (vraw) viz = { ...viz, ...(JSON.parse(vraw) as Partial<ChartVizSettings>) };
    } catch {
      /* ignore */
    }
    let drawings: ChartDrawing[] = [];
    try {
      const draw = lsGet(deskPrefKey(deskId, "draw")) ?? lsGet(`${DESK_STORE}-draw-${deskId}`);
      if (draw) {
        const parsed = JSON.parse(draw) as { items?: ChartDrawing[] };
        drawings = Array.isArray(parsed.items) ? parsed.items : [];
      }
    } catch {
      /* ignore */
    }
    const prefs = { tf, lb, viz, drawings, fpViz: { ...DEFAULT_ORDERFLOW_SETTINGS } };
    lsSet(paneKey, JSON.stringify(prefs));
    return prefs;
  }
  return defaultChartPrefs();
}

function usePersistedJson<T extends object>(key: string, fallback: T, legacyKey?: string) {
  const [value, setValue] = useState<T>(fallback);
  useEffect(() => {
    try {
      const raw = lsGet(key) ?? (legacyKey ? lsGet(legacyKey) : null);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<T>;
      if (parsed && typeof parsed === "object") setValue({ ...fallback, ...parsed });
    } catch {
      /* ignore */
    }
  }, [key, fallback, legacyKey]);
  const update = useCallback(
    (patch: Partial<T>) => {
      setValue((prev) => {
        const next = { ...prev, ...patch };
        lsSet(key, JSON.stringify(next));
        return next;
      });
    },
    [key]
  );
  const reset = useCallback(() => {
    setValue(fallback);
    lsSet(key, JSON.stringify(fallback));
  }, [key, fallback]);
  return [value, update, reset] as const;
}

function usePersistedOpen(key: string, fallback = true, legacyKey?: string) {
  const [open, setOpen] = useState(fallback);
  useEffect(() => {
    const raw = lsGet(key) ?? (legacyKey ? lsGet(legacyKey) : null);
    if (raw === "0") setOpen(false);
    if (raw === "1") setOpen(true);
  }, [key, legacyKey]);
  const set = useCallback((next: boolean | ((v: boolean) => boolean)) => {
    setOpen((v) => {
      const val = typeof next === "function" ? next(v) : next;
      lsSet(key, val ? "1" : "0");
      return val;
    });
  }, [key]);
  const toggle = useCallback(() => set((v) => !v), [set]);
  return [open, toggle, set] as const;
}

export function BybitDesk({ config }: { config?: BybitDeskConfig | null }) {
  const blank = !config;
  const deskId = config?.id ?? "home";
  const apiBase = config ? `/desk/${config.id}` : "";
  const loadError = config ? `Načtení ${config.fallbackSymbol} selhalo` : "";
  const loadingLabel = config ? `Stahuji ${config.fallbackSymbol}…` : "";
  const [error, setError] = useState<string | null>(null);
  const [quoteData, setQuoteData] = useState<DeskChartResponse | null>(null);
  const [quoteLive, setQuoteLive] = useState(false);
  const [tradesTape, setTradesTape] = useState<TradesTapeData | null>(null);
  const [orderBook, setOrderBook] = useState<OrderBookData | null>(null);
  const [fpFetch, setFpFetch] = useState<{ tf: string; lb: string; data: FootprintData } | null>(
    null
  );
  const [fpRange, patchFpRange] = usePersistedJson(
    deskPrefKey(deskId, "fp-range"),
    FP_DEFAULT_RANGE
  );
  const [fpViz, patchFpViz, resetFpViz] = usePersistedJson<OrderflowSettings>(
    deskPrefKey(deskId, "orderflow"),
    DEFAULT_ORDERFLOW_SETTINGS
  );
  const [domViz, patchDomViz, resetDomViz] = usePersistedJson<DomSettings>(
    deskPrefKey(deskId, "dom-viz"),
    DEFAULT_DOM_SETTINGS
  );
  const [drawBarOpen, , setDrawBarOpen] = usePersistedOpen(
    deskPrefKey(deskId, "draw-bar"),
    false
  );
  const [drawTool, setDrawTool] = useState<DrawTool>("none");
  const [layout, setLayoutState] = useState<DeskNode>(DEFAULT_DESK_LAYOUT);
  const [deskPrefsReady, setDeskPrefsReady] = useState(false);

  useEffect(() => {
    try {
      const layoutRaw = lsGet(deskPrefKey(deskId, "layout"));
      if (layoutRaw) {
        const parsed = JSON.parse(layoutRaw) as unknown;
        if (isDeskNode(parsed)) {
          setLayoutState(parsed);
        }
      } else {
        let next = cloneDesk(DEFAULT_DESK_LAYOUT);
        const book = lsGet(deskPrefKey(deskId, "book")) ?? lsGet(`${DESK_STORE}-book`);
        const tape = lsGet(deskPrefKey(deskId, "tape")) ?? lsGet(`${DESK_STORE}-tape`);
        if (book === "0") next = removePanel(next, "orderbook") ?? next;
        if (tape === "0") next = removePanel(next, "tape") ?? next;
        setLayoutState(next);
      }
    } catch {
      /* ignore */
    }
    setDeskPrefsReady(true);
  }, [deskId]);

  const setLayout = useCallback(
    (next: DeskNode) => {
      setLayoutState(next);
      lsSet(deskPrefKey(deskId, "layout"), JSON.stringify(next));
    },
    [deskId]
  );

  const bookOpen = hasPanel(layout, "orderbook");
  const tapeOpen = hasPanel(layout, "tape");
  const footprintOpen = hasPanel(layout, "footprint");
  const domOpen = hasPanel(layout, "dom");
  const needFootprint = footprintOpen || domOpen;
  const quoteLeafId = useMemo(() => collectChartLeaves(layout)[0]?.id ?? "chart", [layout]);

  const loadOrderBook = useCallback(async () => {
      if (!apiBase) return;
      try {
        const res = await apiFetch<OrderBookData>(`${apiBase}/orderbook?limit=200`);
        setOrderBook(res);
      } catch {
        /* keep last book */
      }
    }, [apiBase]);

  const loadTrades = useCallback(async () => {
    if (!apiBase) return;
    try {
      const res = await apiFetch<TradesTapeData>(`${apiBase}/trades?limit=90`);
      setTradesTape(res);
    } catch {
      /* keep last tape */
    }
  }, [apiBase]);

  useEffect(() => {
    if (blank) return;
    void loadOrderBook();
    const id = window.setInterval(() => void loadOrderBook(), 650);
    return () => window.clearInterval(id);
  }, [blank, loadOrderBook]);

  useEffect(() => {
    if (blank) return;
    void loadTrades();
    const id = window.setInterval(() => void loadTrades(), 1500);
    return () => window.clearInterval(id);
  }, [blank, loadTrades]);

  const loadFootprint = useCallback(async () => {
    if (!apiBase) return;
    const { tf, lb } = fpRange;
    try {
      const res = await apiFetch<FootprintData>(
        `${apiBase}/footprint?interval=${encodeURIComponent(tf)}&lookback=${encodeURIComponent(lb)}`
      );
      setFpFetch({ tf, lb, data: res });
    } catch {
      /* keep last clusters */
    }
  }, [apiBase, fpRange]);

  useEffect(() => {
    if (blank || !needFootprint) return;
    void loadFootprint();
    const id = window.setInterval(() => void loadFootprint(), 3000);
    return () => {
      window.clearInterval(id);
    };
  }, [blank, needFootprint, loadFootprint]);

  /** Stale bars from a previous timeframe must not leak into the panel while a refetch is in flight. */
  const footprint =
    fpFetch && fpFetch.tf === fpRange.tf && fpFetch.lb === fpRange.lb ? fpFetch.data : null;
  const footprintLoading = needFootprint && !footprint;

  const selectFootprintTf = useCallback(
    (id: string) => {
      const tf = FP_TIMEFRAMES.find((t) => t.id === id);
      if (!tf) return;
      const allowed = LOOKBACKS_BY_TF[id] || LOOKBACKS_BY_TF["1d"];
      patchFpRange({
        tf: id,
        lb: allowed.some((r) => r.id === fpRange.lb) ? fpRange.lb : tf.defaultLookback,
      });
    },
    [fpRange.lb, patchFpRange]
  );

  const up = (quoteData?.change_pct ?? quoteData?.change_pct_window ?? 0) >= 0;

  return (
    <DeskWorkspace layout={layout} onLayout={setLayout}>
    <div className="gold-page oil-page">
      {!blank ? (
      <HeaderQuote>
        <p className="header-desk__quote">
          <span className="header-desk__px-row">
            <span className="cryptosense__px">{fmtPrice(quoteData?.price, config.priceDigits)}</span>
            <span className={`cryptosense__chg ${up ? "is-up" : "is-down"}`}>
              {fmtPct(quoteData?.change_pct ?? quoteData?.change_pct_window)}
            </span>
          </span>
          <span className={`header-desk__live${quoteLive ? " is-on" : ""}`} title={config.liveTitle}>
            <span className="header-desk__live-dot" aria-hidden />
            live
            <span className="header-desk__venue">
              {orderBook?.execution_exchange || tradesTape?.execution_exchange || "bybit"}
            </span>
          </span>
        </p>
      </HeaderQuote>
      ) : null}
      <HeaderExtra>
        <div className="header-desk">
          <div className="header-desk__tools">
            <div className="header-desk__sec" role="group" aria-label="Graf">
              <AddChartTool onAdd={() => setLayout(addChart(layout))} />
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
            <span className="header-desk__div" aria-hidden />
            <DeskToolLaunchers
              open={{
                orderbook: bookOpen,
                tape: tapeOpen,
                footprint: footprintOpen,
                dom: domOpen,
              }}
              onToggle={(panel) => setLayout(togglePanel(layout, panel))}
            />
          </div>
        </div>
      </HeaderExtra>

      {error && (
        <p className="card gold-page__error" role="alert">
          {error}
        </p>
      )}

      <div className="oil-page__desk">
        <DeskMosaic
          layout={layout}
          onLayout={setLayout}
          renderPanel={(leaf) => {
            if (leaf.panel === "orderbook") {
              return (
                <DeskBoundPanel leafId={leaf.id}>
                  <OrderBookPanel
                    book={orderBook}
                    priceDigits={config?.priceDigits ?? 2}
                    settings={<p className="desk-win__menu-empty">Žádné další volby.</p>}
                    onClose={() => setLayout(togglePanel(layout, "orderbook"))}
                  />
                </DeskBoundPanel>
              );
            }
            if (leaf.panel === "tape") {
              return (
                <DeskBoundPanel leafId={leaf.id}>
                  <TradesTapePanel
                    tape={tradesTape}
                    settings={<p className="desk-win__menu-empty">Žádné další volby.</p>}
                    onClose={() => setLayout(togglePanel(layout, "tape"))}
                  />
                </DeskBoundPanel>
              );
            }
            if (leaf.panel === "footprint") {
              const tick = footprint?.tick ?? config?.tick ?? 0.01;
              return (
                <DeskBoundPanel leafId={leaf.id}>
                  <FootprintPanel
                    data={footprint}
                    loading={footprintLoading}
                    settings={fpViz}
                    onSettingsChange={patchFpViz}
                    priceDigits={config?.priceDigits ?? 2}
                    interval={fpRange.tf}
                    lookback={fpRange.lb}
                    intervals={FP_TIMEFRAMES.map((t) => ({ id: t.id, label: t.label }))}
                    lookbacks={LOOKBACKS_BY_TF[fpRange.tf] || LOOKBACKS_BY_TF["1d"]}
                    onSelectInterval={selectFootprintTf}
                    onSelectLookback={(lb) => patchFpRange({ lb })}
                    settingsPanel={
                      <FootprintSettingsPanel
                        settings={fpViz}
                        tick={tick}
                        onChange={patchFpViz}
                        onReset={resetFpViz}
                      />
                    }
                    onClose={() => setLayout(togglePanel(layout, "footprint"))}
                  />
                </DeskBoundPanel>
              );
            }
            if (leaf.panel === "dom") {
              const tick = orderBook?.tick ?? config?.tick ?? 0.01;
              return (
                <DeskBoundPanel leafId={leaf.id}>
                  <DomPanel
                    book={orderBook}
                    tape={tradesTape}
                    footprint={footprint}
                    settings={domViz}
                    onSettingsChange={patchDomViz}
                    priceDigits={config?.priceDigits ?? 2}
                    settingsPanel={
                      <DomSettingsPanel
                        settings={domViz}
                        tick={tick}
                        onChange={patchDomViz}
                        onReset={resetDomViz}
                      />
                    }
                    onClose={() => setLayout(togglePanel(layout, "dom"))}
                  />
                </DeskBoundPanel>
              );
            }
            return (
              <DeskBoundPanel leafId={leaf.id}>
                <DeskChartPane
                  leafId={leaf.id}
                  deskId={deskId}
                  deskPrefsReady={deskPrefsReady}
                  apiBase={apiBase}
                  loadError={loadError}
                  loadingLabel={loadingLabel}
                  blank={blank}
                  drawBarOpen={drawBarOpen}
                  drawTool={drawTool}
                  onDrawTool={setDrawTool}
                  onCloseDraw={() => {
                    setDrawBarOpen(false);
                    setDrawTool("none");
                  }}
                  onClose={() => setLayout(removeLeaf(layout, leaf.id) ?? newChartLeaf())}
                  isQuoteSource={leaf.id === quoteLeafId}
                  onQuote={setQuoteData}
                  onLive={setQuoteLive}
                  onError={setError}
                  priceDigits={config?.priceDigits ?? 2}
                  tick={config?.tick}
                />
              </DeskBoundPanel>
            );
          }}
        />
      </div>
    </div>
    </DeskWorkspace>
  );
}

function AddChartTool({ onAdd }: { onAdd: () => void }) {
  const drag = useDeskDrag();
  const begin = drag?.beginDrag ?? (() => {});
  return (
    <button
      type="button"
      className="chart-chip chart-chip--soft chart-chip--icon"
      onPointerDown={bindToolDrag(NEW_CHART_DRAG, begin, onAdd)}
      aria-label="Přidat graf"
      title="Přidat graf — klikni nebo přetáhni do desku"
    >
      <IconAddChart size={18} />
    </button>
  );
}

type DeskToolId = Exclude<DeskPanelId, "chart">;

const DESK_TOOLS: {
  id: DeskToolId;
  label: string;
  hint: string;
  Icon: (p: { size?: number }) => ReactNode;
}[] = [
  { id: "orderbook", label: "Orderbook", hint: "Orderbook", Icon: IconBook },
  { id: "tape", label: "Tape", hint: "Tape", Icon: IconTape },
  { id: "footprint", label: "Footprint", hint: "Footprint & orderflow", Icon: IconFootprint },
  { id: "dom", label: "DOM", hint: "DOM — hloubka trhu", Icon: IconDom },
];

function DeskToolLaunchers({
  open,
  onToggle,
}: {
  open: Record<DeskToolId, boolean>;
  onToggle: (panel: DeskToolId) => void;
}) {
  const drag = useDeskDrag();
  const begin = drag?.beginDrag ?? (() => {});
  return (
    <div className="header-desk__sec" role="group" aria-label="Nástroje">
      {DESK_TOOLS.map(({ id, label, hint, Icon }) => (
        <button
          key={id}
          type="button"
          className={`chart-chip chart-chip--soft chart-chip--icon ${open[id] ? "is-active" : ""}`}
          onPointerDown={bindToolDrag(id, begin, () => onToggle(id))}
          aria-pressed={open[id]}
          aria-label={label}
          title={`${hint} — přetáhni do desku`}
        >
          <Icon size={18} />
          <span className="header-desk__tool-name">{label}</span>
        </button>
      ))}
    </div>
  );
}

function DeskChartPane({
  leafId,
  onDragStart,
  deskId,
  deskPrefsReady,
  apiBase,
  loadError,
  loadingLabel,
  blank,
  drawBarOpen,
  drawTool,
  onDrawTool,
  onCloseDraw,
  onClose,
  isQuoteSource,
  onQuote,
  onLive,
  onError,
  priceDigits,
  tick,
}: {
  leafId: string;
  onDragStart?: (e: ReactPointerEvent<HTMLElement>) => void;
  deskId: string;
  deskPrefsReady: boolean;
  apiBase: string;
  loadError: string;
  loadingLabel: string;
  blank: boolean;
  drawBarOpen: boolean;
  drawTool: DrawTool;
  onDrawTool: (tool: DrawTool | ((t: DrawTool) => DrawTool)) => void;
  onCloseDraw: () => void;
  onClose: () => void;
  isQuoteSource: boolean;
  onQuote: (data: DeskChartResponse | null) => void;
  onLive: (live: boolean) => void;
  onError: (msg: string | null) => void;
  priceDigits: number;
  tick?: number;
}) {
  const paneKey = deskPrefKey(deskId, `pane-${leafId}`);
  const [prefs, setPrefs] = useState<ChartPrefs>(defaultChartPrefs);
  const [prefsReady, setPrefsReady] = useState(false);
  const [data, setData] = useState<DeskChartResponse | null>(null);
  const [loading, setLoading] = useState(!blank);
  const [live, setLive] = useState(false);
  const loadGen = useRef(0);
  const [fpData, setFpData] = useState<{ tf: string; lb: string; data: FootprintData } | null>(null);

  useEffect(() => {
    if (!deskPrefsReady) return;
    setPrefs(readChartPrefs(deskId, leafId));
    setPrefsReady(true);
  }, [deskId, leafId, deskPrefsReady]);

  const persistPrefs = useCallback(
    (next: ChartPrefs) => {
      setPrefs(next);
      lsSet(paneKey, JSON.stringify(next));
    },
    [paneKey]
  );

  const patchPrefs = useCallback(
    (patch: Partial<ChartPrefs>) => {
      setPrefs((prev) => {
        const next = { ...prev, ...patch };
        lsSet(paneKey, JSON.stringify(next));
        return next;
      });
    },
    [paneKey]
  );

  const load = useCallback(
    async (iv: string, lb: string, silent = false) => {
      if (!apiBase) return;
      const gen = ++loadGen.current;
      if (!silent) setLoading(true);
      try {
        const res = await apiFetch<DeskChartResponse>(
          `${apiBase}/chart?interval=${encodeURIComponent(iv)}&lookback=${encodeURIComponent(lb)}`
        );
        if (gen !== loadGen.current) return;
        setData(res);
        onError(null);
      } catch (err) {
        if (gen !== loadGen.current) return;
        if (!silent) onError(err instanceof Error ? err.message : loadError);
      } finally {
        if (gen === loadGen.current && !silent) setLoading(false);
      }
    },
    [apiBase, loadError, onError]
  );

  useEffect(() => {
    if (blank || !prefsReady) return;
    void load(prefs.tf, prefs.lb);
  }, [blank, prefsReady, load, prefs.tf, prefs.lb]);

  useEffect(() => {
    if (!isQuoteSource) return;
    onQuote(data);
  }, [isQuoteSource, data, onQuote]);

  useEffect(() => {
    if (!isQuoteSource) return;
    onLive(live);
  }, [isQuoteSource, live, onLive]);

  useEffect(() => {
    if (blank || loading || !data?.source?.startsWith("bybit")) return;
    let closed = false;
    let ws: WebSocket | null = null;
    let retry: number | null = null;
    const tf = prefs.tf;

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
  }, [blank, prefs.tf, loading, data?.source, apiBase]);

  useEffect(() => {
    if (blank || loading || live) return;
    let cancelled = false;
    let inflight = false;
    const tick = async () => {
      if (cancelled || inflight) return;
      if (document.visibilityState !== "visible") return;
      inflight = true;
      try {
        const snap = await apiFetch<OilLiveResponse>(
          `${apiBase}/live?interval=${encodeURIComponent(prefs.tf)}`
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
  }, [blank, prefs.tf, loading, live, apiBase]);

  const wantFootprint = prefs.viz.footprint && !blank;
  const fpTf = prefs.tf === "1s" ? "1m" : prefs.tf;

  const loadFp = useCallback(async () => {
    if (!apiBase) return;
    const lb = prefs.lb;
    try {
      const res = await apiFetch<FootprintData>(
        `${apiBase}/footprint?interval=${encodeURIComponent(fpTf)}&lookback=${encodeURIComponent(lb)}`
      );
      setFpData({ tf: fpTf, lb, data: res });
    } catch {
      /* keep last */
    }
  }, [apiBase, fpTf, prefs.lb]);

  useEffect(() => {
    if (!wantFootprint) return;
    void loadFp();
    const id = window.setInterval(() => void loadFp(), 3000);
    return () => window.clearInterval(id);
  }, [wantFootprint, loadFp]);

  const footprint = fpData && fpData.tf === fpTf && fpData.lb === prefs.lb ? fpData.data : null;

  const selectTimeframe = (tfId: string) => {
    const tf = TIMEFRAMES.find((t) => t.id === tfId);
    if (!tf) return;
    const allowed = LOOKBACKS_BY_TF[tfId] || LOOKBACKS_BY_TF["1d"];
    const nextLb = allowed.some((r) => r.id === prefs.lb) ? prefs.lb : tf.defaultLookback;
    patchPrefs({ tf: tfId, lb: nextLb });
  };

  const resetViz = () => {
    persistPrefs({ ...prefs, viz: { ...DEFAULT_DESK_CHART_VIZ } });
  };

  const ranges = LOOKBACKS_BY_TF[prefs.tf] || LOOKBACKS_BY_TF["1d"];
  const tfLabel = TIMEFRAMES.find((t) => t.id === prefs.tf)?.label ?? prefs.tf;
  const lbLabel = ranges.find((r) => r.id === prefs.lb)?.label ?? prefs.lb;

  return (
    <DeskChartLeaf
      data={data}
      loading={loading}
      loadingLabel={loadingLabel}
      blank={blank}
      timeframe={prefs.tf}
      lookback={prefs.lb}
      ranges={ranges}
      tfLabel={tfLabel}
      lbLabel={lbLabel}
      chartViz={prefs.viz}
      drawBarOpen={drawBarOpen}
      drawTool={drawTool}
      drawings={prefs.drawings}
      onSelectTimeframe={selectTimeframe}
      onSelectLookback={(lb) => patchPrefs({ lb })}
      onSelectStyle={(id) => {
        setPrefs((prev) => {
          const next = { ...prev, viz: { ...prev.viz, style: id } };
          lsSet(paneKey, JSON.stringify(next));
          return next;
        });
      }}
      onDrawingsChange={(items) => patchPrefs({ drawings: items })}
      onDrawTool={onDrawTool}
      onCloseDraw={onCloseDraw}
      onClearDraw={() => {
        patchPrefs({ drawings: [] });
        onDrawTool("none");
      }}
      settings={
        <ChartSettingsPanel
          compact
          viz={prefs.viz}
          onChange={(patch) => {
            setPrefs((prev) => {
              const next = { ...prev, viz: { ...prev.viz, ...patch } };
              lsSet(paneKey, JSON.stringify(next));
              return next;
            });
          }}
          onReset={resetViz}
        />
      }
      onClose={onClose}
      onDragStart={onDragStart}
      footprintData={footprint}
      footprintLoading={wantFootprint && !footprint}
      fpViz={prefs.fpViz}
      onFpVizChange={(patch) => patchPrefs({ fpViz: { ...prefs.fpViz, ...patch } })}
      onFpVizReset={() => patchPrefs({ fpViz: { ...DEFAULT_ORDERFLOW_SETTINGS } })}
      priceDigits={priceDigits ?? 2}
      tick={tick}
    />
  );
}

function DeskChartLeaf({
  onDragStart,
  data,
  loading,
  loadingLabel,
  blank,
  timeframe,
  lookback,
  ranges,
  tfLabel,
  lbLabel,
  chartViz,
  drawBarOpen,
  drawTool,
  drawings,
  onSelectTimeframe,
  onSelectLookback,
  onSelectStyle,
  onDrawingsChange,
  onDrawTool,
  onCloseDraw,
  onClearDraw,
  settings,
  onClose,
  footprintData,
  footprintLoading,
  fpViz,
  onFpVizChange,
  onFpVizReset,
  priceDigits = 2,
  tick,
}: {
  onDragStart?: (e: ReactPointerEvent<HTMLElement>) => void;
  data: DeskChartResponse | null;
  loading: boolean;
  loadingLabel: string;
  blank: boolean;
  timeframe: string;
  lookback: string;
  ranges: { id: string; label: string }[];
  tfLabel: string;
  lbLabel: string;
  chartViz: ChartVizSettings;
  drawBarOpen: boolean;
  drawTool: DrawTool;
  drawings: ChartDrawing[];
  onSelectTimeframe: (id: string) => void;
  onSelectLookback: (id: string) => void;
  onSelectStyle: (id: ChartStyle) => void;
  onDrawingsChange: (items: ChartDrawing[]) => void;
  onDrawTool: (tool: DrawTool | ((t: DrawTool) => DrawTool)) => void;
  onCloseDraw: () => void;
  onClearDraw: () => void;
  settings?: ReactNode;
  onClose: () => void;
  footprintData?: FootprintData | null;
  footprintLoading?: boolean;
  fpViz?: OrderflowSettings;
  onFpVizChange?: (patch: Partial<OrderflowSettings>) => void;
  onFpVizReset?: () => void;
  priceDigits?: number;
  tick?: number;
}) {
  const styleLabel = CHART_STYLES.find((s) => s.id === chartViz.style)?.label ?? "Svíčky";
  return (
    <div className="desk-charts">
      <DeskWindowHead
        title={
          <DeskPick
            label={styleLabel}
            ariaLabel="Typ grafu"
            value={chartViz.style}
            options={CHART_STYLES}
            onSelect={(id) => onSelectStyle(id as ChartStyle)}
            className={`desk-win__pick desk-win__pick--type`}
          />
        }
        extra={
          <div className="desk-win__picks">
            <DeskPick
              label={tfLabel}
              ariaLabel="Timeframe"
              value={timeframe}
              options={TIMEFRAMES.map((t) => ({ id: t.id, label: t.label }))}
              onSelect={onSelectTimeframe}
              className="desk-win__pick"
            />
            <DeskPick
              label={lbLabel}
              ariaLabel="Období"
              value={lookback}
              options={ranges}
              onSelect={onSelectLookback}
              className="desk-win__pick"
            />
          </div>
        }
        onDragStart={onDragStart}
        settings={settings}
        onClose={onClose}
      />
      <div className={`desk-charts__body${chartViz.footprint ? " desk-charts__body--split" : ""}`}>
        <div className="desk-charts__pane">
          {data?.bars?.length ? (
            <>
              <PriceChart
                bars={data.bars}
                realtime
                showMa={false}
                showVolume={chartViz.volume}
                secondsVisible={timeframe === "1m" || timeframe === "1s"}
                chartViz={chartViz}
                drawTool={drawTool}
                drawings={drawings}
                onDrawingsChange={onDrawingsChange}
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
                      onClick={() => onDrawTool((t) => (t === id ? "none" : id))}
                    >
                      {lab}
                    </button>
                  ))}
                  <button type="button" className="draw-toolbar__btn" onClick={onClearDraw} title="Smazat kresby">
                    Smazat
                  </button>
                  <button type="button" className="draw-toolbar__btn" onClick={onCloseDraw} title="Zavřít kreslení">
                    Hotovo
                  </button>
                </div>
              ) : null}
            </>
          ) : (
            <div className="muted p-6 text-sm">{loading ? loadingLabel : blank ? "" : "Žádná OHLCV data."}</div>
          )}
          {loading && data?.bars?.length ? (
            <div className="chart-loading-overlay" aria-live="polite">
              Načítám…
            </div>
          ) : null}
        </div>
        {chartViz.footprint && fpViz && onFpVizChange ? (
          <div className="desk-charts__fp">
            <FootprintPanel
              data={footprintData ?? null}
              loading={footprintLoading ?? false}
              settings={fpViz}
              onSettingsChange={onFpVizChange}
              priceDigits={priceDigits}
              interval={timeframe === "1s" ? "1m" : timeframe}
              lookback={lookback}
              intervals={FP_TIMEFRAMES.map((t) => ({ id: t.id, label: t.label }))}
              lookbacks={LOOKBACKS_BY_TF[timeframe === "1s" ? "1m" : timeframe] || LOOKBACKS_BY_TF["1d"]}
              onSelectInterval={() => {}}
              onSelectLookback={() => {}}
              settingsPanel={
                <FootprintSettingsPanel
                  settings={fpViz}
                  tick={tick ?? footprintData?.tick ?? 0.01}
                  onChange={onFpVizChange}
                  onReset={onFpVizReset!}
                />
              }
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function DeskBoundPanel({
  leafId,
  children,
}: {
  leafId: string;
  children: ReactElement<{ onDragStart?: (e: ReactPointerEvent<HTMLElement>) => void }>;
}) {
  const drag = useDeskDrag();
  return cloneElement(children, {
    onDragStart: (e: ReactPointerEvent<HTMLElement>) => {
      drag?.beginDrag(leafId, e.clientX, e.clientY);
    },
  });
}