export type LinearDeskInfo = {
  id: string;
  title: string;
  navLabel: string;
  fallbackSymbol: string;
  liveTitle: string;
  priceDigits: number;
  tick: number;
};

/**
 * Shared Bybit linear desks. UI is always `BybitDesk` at `/desk/{id}`.
 * To add a symbol: append here AND in `apps/api/app/services/oil_bybit.py` `DESKS` (same `id`).
 */
export const LINEAR_DESKS: LinearDeskInfo[] = [
  {
    id: "btc",
    title: "BITCOIN",
    navLabel: "BTC",
    fallbackSymbol: "BTC",
    liveTitle: "Live Bybit BTCUSDT",
    priceDigits: 1,
    tick: 0.1,
  },
  {
    id: "oil",
    title: "ROPA WTI",
    navLabel: "ROPA WTI",
    fallbackSymbol: "WTI",
    liveTitle: "Live Bybit CLUSDT",
    priceDigits: 2,
    tick: 0.01,
  },
];

const BY_ID = Object.fromEntries(LINEAR_DESKS.map((d) => [d.id, d]));

export function getDesk(id: string): LinearDeskInfo | undefined {
  return BY_ID[(id || "").trim().toLowerCase()];
}

export function deskHref(id: string) {
  return `/desk/${id}`;
}
