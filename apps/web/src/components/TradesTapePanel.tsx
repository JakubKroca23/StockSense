"use client";

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

function fmtTime(ts: string) {
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString("cs-CZ", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  } catch {
    return "—";
  }
}

export function TradesTapePanel({ tape }: { tape: TradesTapeData | null }) {
  if (!tape) {
    return (
      <aside className="trades-tape">
        <p className="trades-tape__title">Trady</p>
        <p className="muted text-sm mt-2">Načítám obchody…</p>
      </aside>
    );
  }

  const maxAmt = Math.max(...tape.trades.map((t) => t.amount), 0.0001);
  const buyShare =
    tape.buy_volume + tape.sell_volume > 0
      ? tape.buy_volume / (tape.buy_volume + tape.sell_volume)
      : 0.5;

  return (
    <aside className="trades-tape">
      <div className="trades-tape__head">
        <p className="trades-tape__title">Trady v čase</p>
        <p className="muted text-xs">
          {tape.exchanges.join(" + ")} · {tape.count} prints
        </p>
      </div>

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

      <div className="trades-tape__cols muted text-xs">
        <span>Čas</span>
        <span>Cena</span>
        <span>Objem</span>
      </div>

      <div className="trades-tape__list">
        {tape.trades.map((t) => {
          const w = Math.max(8, Math.min(100, (t.amount / maxAmt) * 100));
          return (
            <div
              key={`${t.exchange}-${t.id}-${t.ts_ms}`}
              className={`trades-tape__row is-${t.side}`}
            >
              <span
                className="trades-tape__bar"
                style={{ width: `${w}%` }}
                aria-hidden
              />
              <span className="trades-tape__time">{fmtTime(t.ts)}</span>
              <span className="trades-tape__px">{fmtPrice(t.price)}</span>
              <span className="trades-tape__amt">{fmtAmt(t.amount)}</span>
            </div>
          );
        })}
        {!tape.trades.length && (
          <p className="muted text-sm px-1 py-2">Žádné recent trady.</p>
        )}
      </div>
    </aside>
  );
}
