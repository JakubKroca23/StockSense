"use client";

import { useEffect, useRef } from "react";
import type { CandleTick, MarketDataAdapter, MarketInterval, TradeTick } from "./types";

type SocketMsg = CandleTick | TradeTick;

/**
 * Connects to a public market websocket (Binance kline by default via adapter.streamUrl).
 * Callers feed `series.update()` from `onTick`.
 */
export function useMarketWebsocket({
  adapter,
  symbol,
  interval,
  enabled = true,
  onTick,
}: {
  adapter: MarketDataAdapter | null;
  symbol: string;
  interval: MarketInterval;
  enabled?: boolean;
  onTick: (msg: SocketMsg) => void;
}) {
  const onTickRef = useRef(onTick);
  onTickRef.current = onTick;

  useEffect(() => {
    if (!enabled || !adapter?.streamUrl) return;
    const url = adapter.streamUrl(symbol, interval);
    let closed = false;
    let retry: number | null = null;
    let ws: WebSocket | null = null;

    const connect = () => {
      if (closed) return;
      ws = new WebSocket(url);
      ws.onmessage = (ev) => {
        try {
          const parsed = adapter.parseSocket?.(JSON.parse(String(ev.data)));
          if (parsed) onTickRef.current(parsed);
        } catch {
          /* ignore malformed frames */
        }
      };
      ws.onclose = () => {
        if (!closed) retry = window.setTimeout(connect, 1500);
      };
    };
    connect();
    return () => {
      closed = true;
      if (retry) window.clearTimeout(retry);
      ws?.close();
    };
  }, [adapter, symbol, interval, enabled]);
}
