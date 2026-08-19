"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { DeskWindow } from "@/components/DeskWindowHead";
import { usePriceLink } from "@/components/PriceLink";
import type { OrderBookData } from "@/components/OrderBookPanel";
import type { TradesTapeData } from "@/components/TradesTapePanel";
import type { LinkGroup } from "@/lib/linkGroup";
import {
  DepthTracker,
  EMPTY_DEPTH_STAT,
  alpha,
  fmtCompact,
  medianDepth,
  readOrderflowTheme,
  type DomSettings,
  type FootprintData,
  type OrderflowTheme,
} from "@/lib/orderflow";
import { useThemeRevision } from "@/lib/theme";

type DomRow = {
  key: number;
  price: number;
  bid: number;
  ask: number;
  cumBid: number;
  cumAsk: number;
  buy: number;
  sell: number;
  traded: number;
  wallBid: boolean;
  wallAsk: boolean;
  pullBid: boolean;
  pullAsk: boolean;
  stackBid: boolean;
  stackAsk: boolean;
  iceberg: boolean;
  best: "bid" | "ask" | null;
};

type DomModel = {
  rows: DomRow[];
  keys: number[];
  maxDepth: number;
  maxTraded: number;
  maxCum: number;
  bidTotal: number;
  askTotal: number;
  centerKey: number;
  snapshots: number;
};

function fmtPrice(n: number | null | undefined, digits = 2) {
  if (n == null) return "—";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** Traded volume per price for the session columns — the server footprint is the backbone. */
function sessionVap(footprint: FootprintData | null, step: number, cutoff: number) {
  const map = new Map<number, { buy: number; sell: number }>();
  for (const bar of footprint?.bars ?? []) {
    if (Date.parse(bar.ts) < cutoff) continue;
    for (const level of bar.levels) {
      const key = Math.round(level.price / step);
      const cur = map.get(key);
      if (cur) {
        cur.buy += level.buy;
        cur.sell += level.sell;
      } else {
        map.set(key, { buy: level.buy, sell: level.sell });
      }
    }
  }
  return map;
}

function buildDomModel(args: {
  book: OrderBookData;
  footprint: FootprintData | null;
  tracker: DepthTracker;
  settings: DomSettings;
  step: number;
  digits: number;
  offsetRows: number;
  rowCount: number;
  now: number;
  linkedTop?: number | null;
  linkedBottom?: number | null;
}): DomModel {
  const { book, footprint, tracker, settings, step, digits, offsetRows, rowCount, now } = args;
  const vap = sessionVap(footprint, step, now - settings.sessionMinutes * 60_000);
  const stats = tracker.stats(now, Math.min(8000, settings.heatSeconds * 1000));

  const bids = new Map<number, number>();
  const asks = new Map<number, number>();
  for (const level of book.bids) {
    const key = Math.round(level.price / step);
    bids.set(key, (bids.get(key) ?? 0) + level.amount);
  }
  for (const level of book.asks) {
    const key = Math.round(level.price / step);
    asks.set(key, (asks.get(key) ?? 0) + level.amount);
  }

  const bestBidKey = book.best_bid != null ? Math.floor(book.best_bid / step) : null;
  const bestAskKey = book.best_ask != null ? Math.ceil(book.best_ask / step) : null;
  const midPrice = book.mid ?? book.best_bid ?? book.best_ask ?? 0;
  const centerKey = Math.round(midPrice / step) + offsetRows;
  const linked =
    args.linkedTop != null &&
    args.linkedBottom != null &&
    Number.isFinite(args.linkedTop) &&
    Number.isFinite(args.linkedBottom) &&
    args.linkedTop > args.linkedBottom;

  const keys: number[] = [];
  if (linked) {
    const topKey = Math.ceil(args.linkedTop! / step);
    const botKey = Math.floor(args.linkedBottom! / step);
    const raw = Math.max(1, topKey - botKey + 1);
    const skip = raw > 280 ? Math.ceil(raw / 280) : 1;
    for (let k = topKey; k >= botKey; k -= skip) keys.push(k);
  }
  if (!keys.length) {
    const half = Math.floor(rowCount / 2);
    for (let i = half; i >= -half; i -= 1) keys.push(centerKey + i);
  }

  const median = medianDepth([
    ...keys.map((k) => bids.get(k) ?? 0),
    ...keys.map((k) => asks.get(k) ?? 0),
  ]);
  const wallFloor = median * Math.max(1.2, settings.wallRatio);

  let cumBid = 0;
  let cumAsk = 0;
  const cumBidByKey = new Map<number, number>();
  const cumAskByKey = new Map<number, number>();
  for (const key of [...keys].sort((a, b) => b - a)) {
    cumAsk += asks.get(key) ?? 0;
    cumAskByKey.set(key, cumAsk);
  }
  for (const key of [...keys].sort((a, b) => a - b)) {
    cumBid += bids.get(key) ?? 0;
    cumBidByKey.set(key, cumBid);
  }

  const rows: DomRow[] = keys.map((key) => {
    const bid = bids.get(key) ?? 0;
    const ask = asks.get(key) ?? 0;
    const stat = stats.get(key) ?? EMPTY_DEPTH_STAT;
    const traded = vap.get(key);
    const buy = traded?.buy ?? 0;
    const sell = traded?.sell ?? 0;
    const maxSeen = tracker.maxDepthAt(key);
    const pullMin = Math.max(1e-9, (settings.pullPct / 100) * Math.max(stat.pastBid, stat.pastAsk));
    return {
      key,
      price: Number((key * step).toFixed(digits)),
      bid,
      ask,
      cumBid: cumBidByKey.get(key) ?? 0,
      cumAsk: cumAskByKey.get(key) ?? 0,
      buy,
      sell,
      traded: buy + sell,
      wallBid: settings.showWalls && bid > 0 && bid >= wallFloor,
      wallAsk: settings.showWalls && ask > 0 && ask >= wallFloor,
      pullBid: settings.showPulling && stat.pulledBid > pullMin && stat.pastBid > 0,
      pullAsk: settings.showPulling && stat.pulledAsk > pullMin && stat.pastAsk > 0,
      stackBid: settings.showPulling && stat.addedBid > pullMin,
      stackAsk: settings.showPulling && stat.addedAsk > pullMin,
      iceberg:
        settings.showIceberg &&
        tracker.snapshotCount > 5 &&
        maxSeen > 0 &&
        buy + sell >= maxSeen * Math.max(1.5, settings.icebergRatio),
      best: key === bestBidKey ? "bid" : key === bestAskKey ? "ask" : null,
    };
  });

  return {
    rows,
    keys,
    maxDepth: rows.reduce((acc, r) => Math.max(acc, r.bid, r.ask), 0),
    maxTraded: rows.reduce((acc, r) => Math.max(acc, r.buy, r.sell), 0),
    maxCum: rows.reduce((acc, r) => Math.max(acc, r.cumBid, r.cumAsk), 0),
    bidTotal: rows.reduce((acc, r) => acc + r.bid, 0),
    askTotal: rows.reduce((acc, r) => acc + r.ask, 0),
    centerKey,
    snapshots: tracker.snapshotCount,
  };
}

export function DomPanel({
  book,
  tape,
  footprint,
  settings,
  onSettingsChange,
  priceDigits = 2,
  settingsPanel,
  onClose,
  onDragStart,
  leafId,
  linkGroup = null,
  onLinkGroupChange,
}: {
  book: OrderBookData | null;
  tape: TradesTapeData | null;
  footprint: FootprintData | null;
  settings: DomSettings;
  onSettingsChange: (patch: Partial<DomSettings>) => void;
  priceDigits?: number;
  settingsPanel?: ReactNode;
  onClose?: () => void;
  onDragStart?: (e: ReactPointerEvent<HTMLElement>) => void;
  leafId?: string;
  linkGroup?: LinkGroup | null;
  onLinkGroupChange?: (next: LinkGroup | null) => void;
}) {
  const [tracker] = useState(() => new DepthTracker());
  const gridRef = useRef<HTMLDivElement>(null);
  const heatRef = useRef<HTMLCanvasElement>(null);
  const themeRef = useRef<OrderflowTheme | null>(null);
  const themeRevRef = useRef(-1);
  const ingestedRef = useRef<{ book: OrderBookData | null; tape: TradesTapeData | null }>({
    book: null,
    tape: null,
  });
  const themeRev = useThemeRevision();
  const [fitRows, setFitRows] = useState(24);
  const [offsetRows, setOffsetRows] = useState(0);
  const [model, setModel] = useState<DomModel | null>(null);
  const [alignShift, setAlignShift] = useState(0);
  const priceLink = usePriceLink();
  const linked = linkGroup && priceLink ? priceLink.scaleOf(linkGroup) : null;
  const useScale = Boolean(linked && linked.top > linked.bottom);

  const tick = book?.tick && book.tick > 0 ? book.tick : 0.01;
  const step = tick * Math.max(1, settings.tickGroup);
  const digits = Math.max(0, Math.min(8, Math.ceil(-Math.log10(step) + 1e-9)));
  const linkedRowH = (() => {
    if (!useScale || !linked) return null;
    const raw = Math.max(1, Math.ceil((linked.top - linked.bottom) / step));
    const skip = raw > 280 ? Math.ceil(raw / 280) : 1;
    return Math.max(2, Math.min(48, linked.pxPerPrice * step * skip));
  })();
  const rowHeight = linkedRowH ?? Math.max(12, Math.min(40, settings.rowHeight));
  const heatWidth = settings.showHeatmap ? Math.max(40, Math.min(240, settings.heatWidth)) : 0;
  const offset = useScale || settings.centerLock ? 0 : offsetRows;
  const rowCount = settings.centerLock && !useScale ? fitRows : Math.max(6, settings.rows);

  /** `hasModel` re-attaches the observer once the ladder replaces the loading placeholder. */
  const hasModel = model != null;
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setFitRows(Math.max(6, Math.floor(el.clientHeight / rowHeight)));
    });
    ro.observe(el);
    setFitRows(Math.max(6, Math.floor(el.clientHeight / rowHeight)));
    return () => ro.disconnect();
  }, [rowHeight, hasModel]);

  useEffect(() => {
    const el = gridRef.current;
    if (!el || !useScale || !linked) {
      setAlignShift(0);
      return;
    }
    const update = () => {
      const r = el.getBoundingClientRect();
      const overlap = linked.screenTop < r.bottom && r.top < linked.screenTop + linked.height;
      setAlignShift(overlap ? Math.round(linked.screenTop - r.top) : 0);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [useScale, linked]);

  /**
   * Feeds the depth tracker and rebuilds the ladder on the next frame, which both keeps
   * wall-clock reads out of render and coalesces bursts of book updates into one repaint.
   */
  useEffect(() => {
    if (!book) return;
    const now = Date.now();
    tracker.configure(step);
    const ingested = ingestedRef.current;
    if (ingested.book !== book) {
      ingested.book = book;
      tracker.pushBook(book, now, settings.heatSeconds * 1000);
    }
    if (ingested.tape !== tape && tape?.trades?.length) {
      ingested.tape = tape;
      tracker.pushTrades(tape.trades, now, Math.max(120, settings.heatSeconds) * 1000);
    }
    const frame = requestAnimationFrame(() => {
      setModel(
        buildDomModel({
          book,
          footprint,
          tracker,
          settings,
          step,
          digits,
          offsetRows: offset,
          rowCount,
          now: Date.now(),
          linkedTop: useScale && linked ? linked.top : null,
          linkedBottom: useScale && linked ? linked.bottom : null,
        })
      );
    });
    return () => cancelAnimationFrame(frame);
  }, [book, tape, footprint, tracker, settings, step, digits, offset, rowCount, useScale, linked]);

  useEffect(() => {
    const canvas = heatRef.current;
    if (!canvas || !model || !settings.showHeatmap) return;
    const h = model.rows.length * rowHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = Math.max(1, Math.floor(heatWidth * dpr));
    canvas.height = Math.max(1, Math.floor(h * dpr));
    canvas.style.width = `${heatWidth}px`;
    canvas.style.height = `${h}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!themeRef.current || themeRevRef.current !== themeRev) {
      themeRef.current = readOrderflowTheme();
      themeRevRef.current = themeRev;
    }
    const theme = themeRef.current;
    ctx.clearRect(0, 0, heatWidth, h);
    ctx.fillStyle = alpha(theme.bg, 0.85);
    ctx.fillRect(0, 0, heatWidth, h);

    const now = Date.now();
    const snaps = tracker.history(now, settings.heatSeconds * 1000);
    if (!snaps.length) return;
    const colW = Math.max(1.5, heatWidth / snaps.length);
    let max = 0;
    for (const snap of snaps) {
      for (const key of model.keys) {
        max = Math.max(max, snap.bids.get(key) ?? 0, snap.asks.get(key) ?? 0);
      }
    }
    if (max <= 0) return;
    snaps.forEach((snap, col) => {
      const x = col * colW;
      model.rows.forEach((row, idx) => {
        const bid = snap.bids.get(row.key) ?? 0;
        const ask = snap.asks.get(row.key) ?? 0;
        const size = Math.max(bid, ask);
        if (size <= 0) return;
        const intensity = Math.min(1, Math.sqrt(size / max));
        ctx.fillStyle = alpha(bid >= ask ? theme.up : theme.down, 0.08 + intensity * 0.72);
        ctx.fillRect(x, idx * rowHeight, colW + 0.5, rowHeight);
      });
    });
  }, [model, tracker, settings.showHeatmap, settings.heatSeconds, heatWidth, rowHeight, themeRev]);

  useEffect(() => {
    if (!linkGroup || !leafId || !priceLink || !model) return;
    if (priceLink.scaleOf(linkGroup)) return;
    const el = gridRef.current;
    if (!el || model.rows.length < 2) return;
    const top = model.rows[0]?.price;
    const bottom = model.rows[model.rows.length - 1]?.price;
    if (top == null || bottom == null || !(top > bottom)) return;
    const height = model.rows.length * rowHeight;
    priceLink.publish(linkGroup, {
      top,
      bottom,
      height,
      pxPerPrice: height / (top - bottom),
      screenTop: el.getBoundingClientRect().top,
      sourceId: leafId,
    });
  }, [linkGroup, leafId, priceLink, model, rowHeight]);

  useEffect(() => {
    if (!linkGroup || !leafId || !priceLink || !linked) return;
    if (linked.sourceId !== leafId) return;
    const nextPx = Math.max(12, Math.min(40, settings.rowHeight)) / step;
    if (Math.abs(linked.pxPerPrice - nextPx) / Math.max(nextPx, 1e-9) < 0.02) return;
    priceLink.publish(linkGroup, {
      ...linked,
      pxPerPrice: nextPx,
      height: (linked.top - linked.bottom) * nextPx,
      sourceId: leafId,
    });
  }, [settings.rowHeight, step, linkGroup, leafId, priceLink, linked]);

  const onWheel = useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      const dir = e.deltaY > 0 ? -1 : 1;
      if (linkGroup && leafId && priceLink) {
        const cur = priceLink.scaleOf(linkGroup);
        if (cur) {
          const shift = dir * step;
          priceLink.publish(
            linkGroup,
            {
              ...cur,
              top: cur.top + shift,
              bottom: cur.bottom + shift,
              sourceId: leafId,
            },
            700
          );
          return;
        }
      }
      if (settings.centerLock) return;
      setOffsetRows((v) => v + dir);
    },
    [settings.centerLock, linkGroup, leafId, priceLink, step]
  );

  const imbalance =
    model && model.bidTotal + model.askTotal > 0
      ? model.bidTotal / (model.bidTotal + model.askTotal)
      : 0.5;

  const lastPrint = tape?.trades?.[0] ?? null;
  const lastKey = lastPrint ? Math.round(lastPrint.price / step) : null;

  const cols = [
    settings.showVolume ? "1fr" : null,
    "1.1fr",
    "1.05fr",
    "1.1fr",
    settings.showVolume ? "1fr" : null,
    settings.showSessionProfile ? "0.55fr" : null,
  ].filter(Boolean) as string[];
  const gridTemplate = cols.join(" ");

  const headProps = {
    title: "DOM" as const,
    settings: settingsPanel,
    onClose,
    onDragStart,
    linkGroup,
    onLinkGroupChange,
    extra: book ? (
      <p className="muted text-xs">
        last {fmtPrice(lastPrint?.price ?? book.mid, priceDigits)}
        {lastPrint ? ` ${lastPrint.side === "buy" ? "▲" : "▼"} ${fmtCompact(lastPrint.amount)}` : ""}
        {" · "}
        spread {book.spread_pct != null ? `${book.spread_pct.toFixed(3)} %` : "—"}
        {book.spread != null && book.tick > 0 ? ` / ${(book.spread / book.tick).toFixed(1)} t` : ""}
        {" · "}
        krok {step.toFixed(digits)}
      </p>
    ) : null,
  };

  if (!book || !model) {
    return (
      <DeskWindow as="aside" className="dom" {...headProps}>
        <p className="muted text-sm mt-2 px-2">Načítám hloubku trhu…</p>
      </DeskWindow>
    );
  }

  return (
    <DeskWindow as="aside" className="dom" {...headProps}>
      <div className="dom__meter" aria-hidden>
        <span className="dom__meter-bid" style={{ width: `${Math.round(imbalance * 100)}%` }} />
        <span className="dom__meter-ask" style={{ width: `${Math.round((1 - imbalance) * 100)}%` }} />
      </div>
      <div className="dom__summary muted text-xs">
        <span className="is-up">bid {fmtCompact(model.bidTotal)}</span>
        <span className="dom__mid">{fmtPrice(book.mid, priceDigits)}</span>
        <span className="is-down">ask {fmtCompact(model.askTotal)}</span>
      </div>

      <div className="dom__work">
        <div className="dom__ladder">
          <div
            className="dom__cols muted text-xs"
            style={{ gridTemplateColumns: gridTemplate, marginLeft: heatWidth || undefined }}
          >
            {settings.showVolume ? <span>Sell</span> : null}
            <span>Bid</span>
            <span className="dom__cols-px">Cena</span>
            <span>Ask</span>
            {settings.showVolume ? <span>Buy</span> : null}
            {settings.showSessionProfile ? <span>Prof</span> : null}
          </div>

          <div className="dom__grid" ref={gridRef} onWheel={onWheel}>
            {settings.showHeatmap ? (
              <canvas
                ref={heatRef}
                className="dom__heat"
                style={{
                  width: heatWidth,
                  transform: alignShift ? `translateY(${alignShift}px)` : undefined,
                }}
                aria-label="Historie hloubky trhu"
              />
            ) : null}
            <div
              className="dom__rows"
              style={{
                marginLeft: heatWidth || undefined,
                transform: alignShift ? `translateY(${alignShift}px)` : undefined,
              }}
            >
              {model.rows.map((row) => {
                const depthRef = model.maxDepth || 1;
                const tradedRef = model.maxTraded || 1;
                const cumRef = model.maxCum || 1;
                const bidW = settings.showCumulative
                  ? (row.cumBid / cumRef) * 100
                  : (row.bid / depthRef) * 100;
                const askW = settings.showCumulative
                  ? (row.cumAsk / cumRef) * 100
                  : (row.ask / depthRef) * 100;
                const isLast = lastKey != null && row.key === lastKey;
                const classes = [
                  "dom__row",
                  row.best ? `is-best-${row.best}` : "",
                  row.wallBid ? "is-wall-bid" : "",
                  row.wallAsk ? "is-wall-ask" : "",
                  row.pullBid || row.pullAsk ? "is-pull" : "",
                  row.stackBid || row.stackAsk ? "is-stack" : "",
                  row.iceberg ? "is-ice" : "",
                  isLast && lastPrint ? `is-last is-last-${lastPrint.side}` : "",
                ]
                  .filter(Boolean)
                  .join(" ");
                return (
                  <div
                    key={row.key}
                    className={classes}
                    style={{ gridTemplateColumns: gridTemplate, height: rowHeight }}
                  >
                    {settings.showVolume ? (
                      <span className="dom__cell is-sell">
                        {settings.showDepthBars && row.sell > 0 ? (
                          <span
                            className="dom__bar is-sell"
                            style={{ width: `${(row.sell / tradedRef) * 100}%` }}
                          />
                        ) : null}
                        <em>{row.sell > 0 ? fmtCompact(row.sell) : ""}</em>
                      </span>
                    ) : null}
                    <span className="dom__cell is-bid">
                      {settings.showDepthBars && bidW > 0 ? (
                        <span className="dom__bar is-bid" style={{ width: `${bidW}%` }} />
                      ) : null}
                      <em>
                        {row.bid > 0 ? fmtCompact(settings.showCumulative ? row.cumBid : row.bid) : ""}
                      </em>
                    </span>
                    <span className="dom__px">
                      {row.iceberg ? <i className="dom__flag is-ice" title="Iceberg" /> : null}
                      {fmtPrice(row.price, priceDigits)}
                      {isLast && lastPrint ? (
                        <i className={`dom__print is-${lastPrint.side}`}>{fmtCompact(lastPrint.amount)}</i>
                      ) : null}
                    </span>
                    <span className="dom__cell is-ask">
                      {settings.showDepthBars && askW > 0 ? (
                        <span className="dom__bar is-ask" style={{ width: `${askW}%` }} />
                      ) : null}
                      <em>
                        {row.ask > 0 ? fmtCompact(settings.showCumulative ? row.cumAsk : row.ask) : ""}
                      </em>
                    </span>
                    {settings.showVolume ? (
                      <span className="dom__cell is-buy">
                        {settings.showDepthBars && row.buy > 0 ? (
                          <span
                            className="dom__bar is-buy"
                            style={{ width: `${(row.buy / tradedRef) * 100}%` }}
                          />
                        ) : null}
                        <em>{row.buy > 0 ? fmtCompact(row.buy) : ""}</em>
                      </span>
                    ) : null}
                    {settings.showSessionProfile ? (
                      <span className="dom__cell is-prof">
                        {row.traded > 0 ? (
                          <span
                            className="dom__bar is-prof"
                            style={{ width: `${(row.traded / (tradedRef * 2)) * 100}%` }}
                          />
                        ) : null}
                      </span>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <div className="dom__foot muted text-xs">
        <span>
          {book.execution_exchange}
          {book.books?.length ? ` · ${book.books.filter((b) => b.ok).map((b) => b.exchange).join(" + ")}` : ""}
        </span>
        {useScale && linkGroup ? (
          <span>skupina {linkGroup}</span>
        ) : offset !== 0 ? (
          <button type="button" className="dom__recenter" onClick={() => setOffsetRows(0)}>
            Vycentrovat
          </button>
        ) : (
          <span>{model.snapshots} snapshotů</span>
        )}
        <button
          type="button"
          className={`dom__lock${useScale ? " is-active" : settings.centerLock ? " is-active" : ""}`}
          onClick={() => {
            if (useScale) return;
            setOffsetRows(0);
            onSettingsChange({ centerLock: !settings.centerLock });
          }}
          aria-pressed={useScale || settings.centerLock}
          disabled={useScale}
        >
          {useScale ? "Sdílené měřítko" : settings.centerLock ? "Zámek na mid" : "Volný sken"}
        </button>
      </div>
    </DeskWindow>
  );
}
