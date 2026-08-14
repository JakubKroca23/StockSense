import type { HistoryQuery, MarketDataAdapter, MarketInterval, OhlcvBar } from "../types";
import { asUnix } from "../indicators";

const BINANCE_INTERVAL: Record<MarketInterval, string> = {
  "1s": "1s",
  "1m": "1m",
  "5m": "5m",
  "15m": "15m",
  "30m": "30m",
  "1h": "1h",
  "4h": "4h",
  "1d": "1d",
  "1w": "1w",
};

function toSymbol(symbol: string) {
  return symbol.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

export const binanceAdapter: MarketDataAdapter = {
  id: "binance",
  label: "Binance",
  async fetchHistory(q: HistoryQuery): Promise<OhlcvBar[]> {
    const symbol = toSymbol(q.symbol);
    const interval = BINANCE_INTERVAL[q.interval] || "1m";
    const limit = Math.min(1000, Math.max(10, q.limit ?? 500));
    const params = new URLSearchParams({
      symbol,
      interval,
      limit: String(limit),
    });
    if (q.from) params.set("startTime", String(q.from));
    if (q.to) params.set("endTime", String(q.to));
    const res = await fetch(`https://api.binance.com/api/v3/klines?${params}`, {
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Binance klines ${res.status}`);
    const rows = (await res.json()) as [number, string, string, string, string, string][];
    return rows.map((r) => ({
      time: asUnix(r[0]),
      open: Number(r[1]),
      high: Number(r[2]),
      low: Number(r[3]),
      close: Number(r[4]),
      volume: Number(r[5]),
    }));
  },
  streamUrl: (symbol, interval) => {
    const iv = BINANCE_INTERVAL[interval] || "1m";
    return `wss://stream.binance.com:9443/ws/${toSymbol(symbol).toLowerCase()}@kline_${iv}`;
  },
  parseSocket: (raw) => {
    const msg = raw as { k?: { t: number; o: string; h: string; l: string; c: string; v: string; x: boolean } };
    const k = msg?.k;
    if (!k) return null;
    return {
      time: asUnix(k.t),
      open: Number(k.o),
      high: Number(k.h),
      low: Number(k.l),
      close: Number(k.c),
      volume: Number(k.v),
      closed: Boolean(k.x),
    };
  },
};
