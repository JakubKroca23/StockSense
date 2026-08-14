import type { HistoryQuery, MarketDataAdapter, OhlcvBar } from "../types";
import { asUnix } from "../indicators";

/**
 * Polygon.io stocks adapter. Set `NEXT_PUBLIC_POLYGON_KEY` (or pass `apiKey`).
 * Docs: https://polygon.io/docs/stocks/get_v2_aggs_ticker__stocksticker__range__multiplier___timespan___from___to
 */
export function createPolygonAdapter(apiKey = process.env.NEXT_PUBLIC_POLYGON_KEY || ""): MarketDataAdapter {
  const SPAN: Record<string, { multiplier: number; timespan: string }> = {
    "1m": { multiplier: 1, timespan: "minute" },
    "5m": { multiplier: 5, timespan: "minute" },
    "15m": { multiplier: 15, timespan: "minute" },
    "1h": { multiplier: 1, timespan: "hour" },
    "1d": { multiplier: 1, timespan: "day" },
    "1w": { multiplier: 1, timespan: "week" },
  };

  return {
    id: "polygon",
    label: "Polygon.io",
    async fetchHistory(q: HistoryQuery): Promise<OhlcvBar[]> {
      if (!apiKey) throw new Error("Chybí NEXT_PUBLIC_POLYGON_KEY");
      const span = SPAN[q.interval] || SPAN["1d"];
      const to = q.to ? new Date(q.to).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
      const from = q.from
        ? new Date(q.from).toISOString().slice(0, 10)
        : new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
      const url =
        `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(q.symbol)}` +
        `/range/${span.multiplier}/${span.timespan}/${from}/${to}` +
        `?adjusted=true&sort=asc&limit=${q.limit ?? 500}&apiKey=${apiKey}`;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(`Polygon ${res.status}`);
      const body = (await res.json()) as { results?: { t: number; o: number; h: number; l: number; c: number; v: number }[] };
      return (body.results || []).map((r) => ({
        time: asUnix(r.t),
        open: r.o,
        high: r.h,
        low: r.l,
        close: r.c,
        volume: r.v,
      }));
    },
  };
}
