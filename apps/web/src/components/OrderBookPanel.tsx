"use client";

import { useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import { fmtV } from "@/components/FootprintChart";
import type { BookWallFlag, SessionProfile } from "@/lib/orderflow";

export type OrderLevel = {
  price: number;
  amount: number;
  total: number;
  side: "bid" | "ask";
};

export type OrderBookData = {
  symbol: string;
  tick: number;
  mid: number | null;
  best_bid: number | null;
  best_ask: number | null;
  spread: number | null;
  spread_pct: number | null;
  exchanges: string[];
  execution_exchange: string;
  chart_mode?: string;
  bids: OrderLevel[];
  asks: OrderLevel[];
  books: {
    exchange: string;
    ok: boolean;
    error: string | null;
    bids: [number, number][];
    asks: [number, number][];
  }[];
  as_of: string;
};

function fmtPrice(n: number | null | undefined, digits = 2) {
  if (n == null) return "—";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function fmtAmt(n: number) {
  if (n >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
}

const ROWS = 42;

type LadderRow = {
  price: number;
  bid: number;
  ask: number;
  vol: number;
  wall: "bid" | "ask" | "spoof" | null;
};

function PanelToggle({
  collapsed,
  onToggle,
  children,
}: {
  collapsed: boolean;
  onToggle?: () => void;
  children: ReactNode;
}) {
  if (!onToggle) return <div className="orderbook__head">{children}</div>;
  return (
    <button
      type="button"
      className="desk-panel__toggle"
      onClick={onToggle}
      aria-expanded={!collapsed}
    >
      {children}
    </button>
  );
}

export function OrderBookPanel({
  book,
  session,
  walls = [],
  priceDigits = 2,
  collapsed = false,
  onToggle,
  onPriceClick,
}: {
  book: OrderBookData | null;
  session?: SessionProfile | null;
  walls?: BookWallFlag[];
  priceDigits?: number;
  collapsed?: boolean;
  onToggle?: () => void;
  onPriceClick?: (price: number, side: "bid" | "ask") => void;
}) {
  const ladderRef = useRef<HTMLDivElement>(null);
  const midRef = useRef<HTMLDivElement>(null);
  const userLockRef = useRef(0);

  const title = (
    <p className="orderbook__title">
      {onToggle ? <span className="desk-panel__caret">{collapsed ? "▸" : "▾"}</span> : null}
      DOM
    </p>
  );

  const ladder = useMemo(() => {
    if (!book) return { list: [] as LadderRow[], anchor: null as number | null };
    const bidMap = new Map(book.bids.map((l) => [l.price, l.amount]));
    const askMap = new Map(book.asks.map((l) => [l.price, l.amount]));
    const volMap = new Map((session?.rows || []).map((r) => [r.price, r.totalVolume]));
    const wallMap = new Map(walls.map((w) => [w.price, w.kind === "spoof" ? "spoof" : w.side]));
    const prices = new Set<number>([
      ...bidMap.keys(),
      ...askMap.keys(),
      ...[...volMap.keys()].filter((p) => {
        if (book.mid == null) return false;
        return Math.abs(p - book.mid) / Math.max(book.mid, 1) < 0.012;
      }),
    ]);
    const sorted = [...prices].sort((a, b) => b - a);
    const mid = book.mid ?? (sorted[Math.floor(sorted.length / 2)] || 0);
    let midIdx = sorted.findIndex((p) => p <= mid);
    if (midIdx < 0) midIdx = Math.floor(sorted.length / 2);
    const from = Math.max(0, midIdx - ROWS);
    const to = Math.min(sorted.length, midIdx + ROWS);
    const list = sorted.slice(from, to).map((price) => {
      const wall = wallMap.get(price);
      return {
        price,
        bid: bidMap.get(price) || 0,
        ask: askMap.get(price) || 0,
        vol: volMap.get(price) || 0,
        wall: (wall === "spoof" || wall === "bid" || wall === "ask" ? wall : null) as LadderRow["wall"],
      };
    });
    const anchor =
      list.find((r) => r.price <= mid)?.price ?? list[Math.floor(list.length / 2)]?.price ?? null;
    return { list, anchor };
  }, [book, session, walls]);

  const rows = ladder.list;
  const anchorPrice = ladder.anchor;

  useLayoutEffect(() => {
    if (collapsed || !book) return;
    const ladder = ladderRef.current;
    const midEl = midRef.current;
    if (!ladder || !midEl) return;
    const center = () => {
      if (Date.now() < userLockRef.current) return;
      const view = ladder.clientHeight;
      if (view < 16) return;
      const rel =
        midEl.getBoundingClientRect().top - ladder.getBoundingClientRect().top + ladder.scrollTop;
      ladder.scrollTop = Math.max(0, rel - view / 2 + midEl.offsetHeight / 2);
    };
    center();
    const ro = new ResizeObserver(() => center());
    ro.observe(ladder);
    return () => ro.disconnect();
  }, [collapsed, book, rows]);

  if (!book) {
    return (
      <aside className={`orderbook ${collapsed ? "is-collapsed" : ""}`}>
        <PanelToggle collapsed={collapsed} onToggle={onToggle}>
          {title}
        </PanelToggle>
        {!collapsed && <p className="muted text-sm mt-2">Načítám hloubku trhu…</p>}
      </aside>
    );
  }

  const maxBid = Math.max(...rows.map((r) => r.bid), 0.0001);
  const maxAsk = Math.max(...rows.map((r) => r.ask), 0.0001);
  const maxVol = Math.max(...rows.map((r) => r.vol), 0.0001);

  return (
    <aside className={`orderbook orderbook--dom ${collapsed ? "is-collapsed" : ""}`}>
      <PanelToggle collapsed={collapsed} onToggle={onToggle}>
        {title}
        {!collapsed && (
          <p className="muted text-xs">
            tick {book.tick} · spread{" "}
            {book.spread_pct != null ? `${book.spread_pct.toFixed(3)}%` : "—"}
          </p>
        )}
      </PanelToggle>

      {!collapsed && (
        <>
          <div className="orderbook__cols orderbook__cols--dom muted text-xs">
            <span>Bid</span>
            <span>Cena</span>
            <span>Ask</span>
            <span>Vol</span>
          </div>

          <div
            className="orderbook__ladder"
            ref={ladderRef}
            onWheel={() => {
              userLockRef.current = Date.now() + 2500;
            }}
            onPointerDown={() => {
              userLockRef.current = Date.now() + 2500;
            }}
          >
            {rows.map((row) => {
              const isMid = row.price === anchorPrice;
              const wallClass =
                row.wall === "spoof"
                  ? " is-spoof"
                  : row.wall === "bid"
                    ? " is-wall-bid"
                    : row.wall === "ask"
                      ? " is-wall-ask"
                      : "";
              return (
                <div
                  key={row.price}
                  ref={isMid ? midRef : undefined}
                  className={`orderbook__row orderbook__row--dom${isMid ? " is-mid" : ""}${wallClass}`}
                >
                  <button
                    type="button"
                    className="orderbook__cell is-bid"
                    onClick={() => onPriceClick?.(row.price, "bid")}
                  >
                    {row.bid > 0 && (
                      <span
                        className="orderbook__hist is-bid"
                        style={{ width: `${(row.bid / maxBid) * 100}%` }}
                      />
                    )}
                    <span>{row.bid > 0 ? fmtAmt(row.bid) : ""}</span>
                  </button>
                  <span className="orderbook__px">{fmtPrice(row.price, priceDigits)}</span>
                  <button
                    type="button"
                    className="orderbook__cell is-ask"
                    onClick={() => onPriceClick?.(row.price, "ask")}
                  >
                    {row.ask > 0 && (
                      <span
                        className="orderbook__hist is-ask"
                        style={{ width: `${(row.ask / maxAsk) * 100}%` }}
                      />
                    )}
                    <span>{row.ask > 0 ? fmtAmt(row.ask) : ""}</span>
                  </button>
                  <span className="orderbook__sess">
                    {row.vol > 0 && (
                      <span
                        className="orderbook__hist is-vol"
                        style={{ width: `${(row.vol / maxVol) * 100}%` }}
                      />
                    )}
                    <span>{row.vol > 0 ? fmtV(row.vol) : ""}</span>
                  </span>
                </div>
              );
            })}
          </div>

          <div className="orderbook__venues">
            {book.books.map((b) => (
              <span key={b.exchange} className={`badge ${b.ok ? "" : "text-[var(--danger)]"}`}>
                {b.exchange}
                {b.ok ? "" : " · err"}
              </span>
            ))}
          </div>
        </>
      )}
    </aside>
  );
}
