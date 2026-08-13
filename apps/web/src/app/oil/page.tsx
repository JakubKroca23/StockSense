"use client";

import { BybitDesk, type BybitDeskConfig } from "@/components/BybitDesk";

const OIL_DESK: BybitDeskConfig = {
  title: "ROPA WTI",
  fallbackSymbol: "WTI",
  apiBase: "/oil",
  storagePrefix: "stocksense-oil",
  liveTitle: "Live Bybit CLUSDT",
  priceDigits: 2,
  loadError: "Načtení WTI selhalo",
  loadingLabel: "Stahuji WTI…",
  tickFallback: 0.01,
};

export default function OilPage() {
  return <BybitDesk config={OIL_DESK} />;
}
