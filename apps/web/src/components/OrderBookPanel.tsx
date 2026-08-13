"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";

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

function fmtPrice(n: number | null | undefined) {
  if (n == null) return "—";
  if (n >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (n >= 1) return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
  return n.toLocaleString("en-US", { maximumFractionDigits: 6 });
}

function fmtAmt(n: number) {
  if (n >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
}

const ROWS = 36;

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
  collapsed = false,
  onToggle,
}: {
  book: OrderBookData | null;
  collapsed?: boolean;
  onToggle?: () => void;
}) {
  const ladderRef = useRef<HTMLDivElement>(null);
  const spreadRef = useRef<HTMLDivElement>(null);
  const userLockRef = useRef(0);

  const title = (
    <p className="orderbook__title">
      {onToggle ? <span className="desk-panel__caret">{collapsed ? "▸" : "▾"}</span> : null}
      Order book
    </p>
  );

  useLayoutEffect(() => {
    if (collapsed || !book) return;
    const ladder = ladderRef.current;
    const spread = spreadRef.current;
    if (!ladder || !spread) return;

    const center = () => {
      if (Date.now() < userLockRef.current) return;
      const view = ladder.clientHeight;
      if (view < 16) return;
      ladder.style.paddingTop = "0px";
      ladder.style.paddingBottom = "0px";
      const spreadH = spread.offsetHeight;
      const target = (view - spreadH) / 2;
      const relTop = () =>
        spread.getBoundingClientRect().top - ladder.getBoundingClientRect().top + ladder.scrollTop;
      const asksH = relTop();
      const bidsH = ladder.scrollHeight - asksH - spreadH;
      const padTop = Math.max(0, Math.round(target - asksH));
      const padBot = Math.max(0, Math.round(target - bidsH));
      ladder.style.paddingTop = `${padTop}px`;
      ladder.style.paddingBottom = `${padBot}px`;
      ladder.scrollTop = Math.max(0, relTop() - target);
    };

    center();
    const ro = new ResizeObserver(() => center());
    ro.observe(ladder);
    return () => ro.disconnect();
  }, [collapsed, book]);

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

  const maxTotal = Math.max(
    book.bids[book.bids.length - 1]?.total || 0,
    book.asks[book.asks.length - 1]?.total || 0,
    1
  );
  const asks = book.asks.slice(0, ROWS).reverse();
  const bids = book.bids.slice(0, ROWS);

  return (
    <aside className={`orderbook ${collapsed ? "is-collapsed" : ""}`}>
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
          <div className="orderbook__cols muted text-xs">
            <span>Cena</span>
            <span>Objem</span>
            <span>Σ</span>
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
            {asks.map((ask) => (
              <div key={`a-${ask.price}`} className="orderbook__row is-ask">
                <span
                  className="orderbook__depth"
                  style={{ width: `${(ask.total / maxTotal) * 100}%` }}
                />
                <span className="orderbook__px text-[var(--chart-down)]">{fmtPrice(ask.price)}</span>
                <span className="orderbook__amt">{fmtAmt(ask.amount)}</span>
                <span className="orderbook__tot muted">{fmtAmt(ask.total)}</span>
              </div>
            ))}

            <div className="orderbook__spread" ref={spreadRef}>
              <span className="text-[var(--text)] font-semibold">{fmtPrice(book.mid)}</span>
              <span className="muted text-xs">
                mid · Δ {book.spread != null ? fmtPrice(book.spread) : "—"}
              </span>
            </div>

            {bids.map((bid) => (
              <div key={`b-${bid.price}`} className="orderbook__row is-bid">
                <span
                  className="orderbook__depth"
                  style={{ width: `${(bid.total / maxTotal) * 100}%` }}
                />
                <span className="orderbook__px text-[var(--chart-up)]">{fmtPrice(bid.price)}</span>
                <span className="orderbook__amt">{fmtAmt(bid.amount)}</span>
                <span className="orderbook__tot muted">{fmtAmt(bid.total)}</span>
              </div>
            ))}
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
