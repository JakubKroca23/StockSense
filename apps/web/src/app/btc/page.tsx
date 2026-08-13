"use client";

import { BybitDesk, type BybitDeskConfig } from "@/components/BybitDesk";

const BTC_DESK: BybitDeskConfig = {
  title: "BITCOIN",
  fallbackSymbol: "BTC",
  apiBase: "/btc",
  storagePrefix: "stocksense-btc",
  liveTitle: "Live Bybit BTCUSDT",
  priceDigits: 1,
  loadError: "Načtení BTC selhalo",
  loadingLabel: "Stahuji BTC…",
  tickFallback: 0.1,
};

export default function BtcPage() {
  return <BybitDesk config={BTC_DESK} />;
}
