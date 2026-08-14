"use client";

import { useMemo } from "react";
import { buildSmartTape, type SmartPrint, type TradeTick } from "@/lib/orderflow";

export type TradePrint = {
  id: string;
  ts: string;
  ts_ms: number;
  price: number;
  amount: number;
  cost: number;
  side: "buy" | "sell";
  exchange: string;
};

export type TradesTapeData = {
  symbol: string;
  exchanges: string[];
  execution_exchange: string;
  trades: TradePrint[];
  count: number;
  buy_count: number;
  sell_count: number;
  buy_volume: number;
  sell_volume: number;
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
  if (n >= 1) return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
  return n.toLocaleString("en-US", { maximumFractionDigits: 5 });
}

function fmtTime(ts: number) {
  try {
    return new Date(ts).toLocaleTimeString("cs-CZ", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  } catch {
    return "—";
  }
}

function toTick(t: TradePrint): TradeTick {
  return {
    id: `${t.exchange}-${t.id}-${t.ts_ms}`,
    ts: t.ts_ms,
    price: t.price,
    size: t.amount,
    aggressorSide: t.side,
  };
}

export function TradesTapePanel({
  tape,
  collapsed = false,
  onToggle,
  smart = true,
  blockSize = 0,
  onBlockSize,
  onSmart,
}: {
  tape: TradesTapeData | null;
  collapsed?: boolean;
  onToggle?: () => void;
  smart?: boolean;
  blockSize?: number;
  onBlockSize?: (n: number) => void;
  onSmart?: (on: boolean) => void;
}) {
  const prints = useMemo<SmartPrint[]>(() => {
    if (!tape?.trades.length) return [];
    return buildSmartTape(tape.trades.map(toTick), { smart, blockSize });
  }, [tape, smart, blockSize]);

  const visible = useMemo(
    () => (blockSize > 0 ? prints.filter((p) => p.size >= blockSize) : prints),
    [prints, blockSize]
  );

  const title = (
    <p className="trades-tape__title">
      {onToggle ? <span className="desk-panel__caret">{collapsed ? "▸" : "▾"}</span> : null}
      Tape
    </p>
  );

  const head = onToggle ? (
    <button
      type="button"
      className="desk-panel__toggle"
      onClick={onToggle}
      aria-expanded={!collapsed}
    >
      {title}
      {!collapsed && tape && (
        <p className="muted text-xs">
          {tape.exchanges.join(" + ")} · {visible.length}
          {smart ? " smart" : " prints"}
        </p>
      )}
    </button>
  ) : (
    <div className="trades-tape__head">
      {title}
      {tape && (
        <p className="muted text-xs">
          {tape.exchanges.join(" + ")} · {visible.length}
        </p>
      )}
    </div>
  );

  if (!tape) {
    return (
      <aside className={`trades-tape ${collapsed ? "is-collapsed" : ""}`}>
        {head}
        {!collapsed && <p className="muted text-sm mt-2">Načítám obchody…</p>}
      </aside>
    );
  }

  const maxAmt = Math.max(...visible.map((t) => t.size), 0.0001);
  const buyShare =
    tape.buy_volume + tape.sell_volume > 0
      ? tape.buy_volume / (tape.buy_volume + tape.sell_volume)
      : 0.5;

  return (
    <aside className={`trades-tape ${collapsed ? "is-collapsed" : ""}`}>
      {head}

      {!collapsed && (
        <>
          <div className="trades-tape__flow" aria-hidden>
            <span
              className="trades-tape__flow-buy"
              style={{ width: `${Math.round(buyShare * 100)}%` }}
            />
            <span
              className="trades-tape__flow-sell"
              style={{ width: `${Math.round((1 - buyShare) * 100)}%` }}
            />
          </div>
          <div className="trades-tape__flow-labels muted text-xs">
            <span className="is-buy">buy {fmtAmt(tape.buy_volume)}</span>
            <span className="is-sell">sell {fmtAmt(tape.sell_volume)}</span>
          </div>
          <div className="trades-tape__tools">
            <label className="viz-menu__check">
              <input
                type="checkbox"
                checked={smart}
                onChange={(e) => onSmart?.(e.target.checked)}
              />
              Smart
            </label>
            <label className="trades-tape__block">
              Block
              <input
                type="number"
                min={0}
                step="any"
                value={blockSize || ""}
                placeholder="0"
                onChange={(e) => onBlockSize?.(Math.max(0, Number(e.target.value) || 0))}
              />
            </label>
          </div>

          <div className="trades-tape__cols muted text-xs">
            <span>Čas</span>
            <span>Cena</span>
            <span>Objem</span>
          </div>

          <div className="trades-tape__list">
            {visible.map((t) => {
              const w = Math.max(8, Math.min(100, (t.size / maxAmt) * 100));
              return (
                <div
                  key={t.id}
                  className={`trades-tape__row is-${t.aggressorSide}${t.block ? " is-block" : ""}`}
                >
                  <span className="trades-tape__bar" style={{ width: `${w}%` }} aria-hidden />
                  <span className="trades-tape__time">{fmtTime(t.ts)}</span>
                  <span className="trades-tape__px">{fmtPrice(t.price)}</span>
                  <span className="trades-tape__amt">
                    {fmtAmt(t.size)}
                    {t.count > 1 ? <span className="trades-tape__n">×{t.count}</span> : null}
                  </span>
                </div>
              );
            })}
            {!visible.length && (
              <p className="muted text-sm px-1 py-2">
                {blockSize > 0 ? "Žádné block trady nad prahem." : "Žádné recent trady."}
              </p>
            )}
          </div>
        </>
      )}
    </aside>
  );
}
