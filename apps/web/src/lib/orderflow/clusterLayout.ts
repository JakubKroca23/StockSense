import type { OrderflowSettings } from "./types";

export type CandlePosition = "off" | "left" | "center" | "right";
export type ProfileSide = "off" | "left" | "right" | "both";

export function resolveCandlePosition(s: Pick<OrderflowSettings, "candlePosition" | "showCandle">): CandlePosition {
  if (s.candlePosition === "off" || s.candlePosition === "center" || s.candlePosition === "right") {
    return s.candlePosition;
  }
  if (s.showCandle === false) return "off";
  return "left";
}

export function resolveProfileSide(s: Pick<OrderflowSettings, "profileSide" | "cellMode" | "profileStyle">): ProfileSide {
  if (s.profileSide === "left" || s.profileSide === "right" || s.profileSide === "both") return s.profileSide;
  if (s.cellMode === "bidask-profile" || s.cellMode === "delta-profile") return "both";
  if (s.profileSide === "off") return "off";
  if (s.cellMode === "profile" && s.profileStyle === "bars") return "both";
  return "off";
}

export function clusterProfileMetric(
  s: Pick<OrderflowSettings, "cellMode" | "profileCellMetric">
): "volume" | "delta" {
  if (s.cellMode === "delta-profile") return "delta";
  if (s.cellMode === "bidask-profile") return "volume";
  return s.profileCellMetric === "delta" ? "delta" : "volume";
}

export function isBidAskCluster(mode: OrderflowSettings["cellMode"]) {
  return mode === "bidask" || mode === "bidask-ladder" || mode === "bidask-profile";
}

export function isDeltaCluster(mode: OrderflowSettings["cellMode"]) {
  return mode === "delta" || mode === "delta-ladder" || mode === "delta-profile";
}

export function clusterShowsText(s: Pick<OrderflowSettings, "showText" | "cellMode" | "profileStyle">) {
  if (!s.showText) return false;
  if (s.cellMode === "profile" && s.profileStyle !== "cells") return false;
  return true;
}

export type ClusterFormatId = "bidask-ladder" | "bidask-profile" | "delta-ladder" | "delta-profile";

export function clusterFormatPatch(id: ClusterFormatId): Partial<OrderflowSettings> {
  if (id === "bidask-ladder") {
    return { cellMode: "bidask-ladder", showText: true, profileSide: "off" };
  }
  if (id === "delta-ladder") {
    return { cellMode: "delta-ladder", showText: true, profileSide: "off" };
  }
  if (id === "bidask-profile") {
    return {
      cellMode: "bidask-profile",
      showText: false,
      profileSide: "both",
      profileStyle: "bars",
      profileCellMetric: "volume",
      heatMode: "off",
    };
  }
  return {
    cellMode: "delta-profile",
    showText: false,
    profileSide: "both",
    profileStyle: "bars",
    profileCellMetric: "delta",
    heatMode: "off",
  };
}

export function activeClusterFormat(
  s: Pick<OrderflowSettings, "cellMode">
): ClusterFormatId | null {
  if (s.cellMode === "bidask" || s.cellMode === "bidask-ladder") return "bidask-ladder";
  if (s.cellMode === "bidask-profile") return "bidask-profile";
  if (s.cellMode === "delta" || s.cellMode === "delta-ladder") return "delta-ladder";
  if (s.cellMode === "delta-profile") return "delta-profile";
  return null;
}

export function imbalanceCellFill(
  s: Pick<OrderflowSettings, "showImbalance" | "imbalanceHighlight">,
  cell: { stacked?: boolean }
) {
  if (!s.showImbalance) return false;
  if ((s.imbalanceHighlight ?? "all") === "stacked") return Boolean(cell.stacked);
  return true;
}

export type ClusterSlots = {
  candleX: number;
  candleW: number;
  sellX: number;
  sellW: number;
  buyX: number;
  buyW: number;
};

/** Split a footprint column into sell / candle / buy slots. */
export function clusterSlots(innerX: number, innerW: number, candlePos: CandlePosition): ClusterSlots {
  const candleW = candlePos === "off" ? 0 : Math.max(4, Math.min(10, innerW * 0.18));
  if (candlePos === "center") {
    const side = Math.max(2, (innerW - candleW) / 2);
    return {
      candleX: innerX + side,
      candleW,
      sellX: innerX,
      sellW: side,
      buyX: innerX + side + candleW,
      buyW: Math.max(2, innerW - side - candleW),
    };
  }
  if (candlePos === "right") {
    const clusterW = Math.max(2, innerW - candleW);
    const half = clusterW / 2;
    return {
      candleX: innerX + clusterW,
      candleW,
      sellX: innerX,
      sellW: half,
      buyX: innerX + half,
      buyW: clusterW - half,
    };
  }
  if (candlePos === "left") {
    const clusterW = Math.max(2, innerW - candleW);
    const half = clusterW / 2;
    return {
      candleX: innerX,
      candleW,
      sellX: innerX + candleW,
      sellW: half,
      buyX: innerX + candleW + half,
      buyW: clusterW - half,
    };
  }
  const half = innerW / 2;
  return {
    candleX: innerX + half,
    candleW: 0,
    sellX: innerX,
    sellW: half,
    buyX: innerX + half,
    buyW: half,
  };
}

/** Histogram strip(s) relative to the candle. */
export function profileSlots(
  slots: ClusterSlots,
  side: ProfileSide
): { x: number; w: number; kind: "sell" | "buy" | "split" }[] {
  if (side === "off") return [];
  if (side === "both") {
    return [
      { x: slots.sellX, w: slots.sellW, kind: "sell" },
      { x: slots.buyX, w: slots.buyW, kind: "buy" },
    ];
  }
  if (side === "left") {
    if (slots.sellW > 2) return [{ x: slots.sellX, w: slots.sellW, kind: "split" }];
    return [{ x: slots.buyX, w: slots.buyW, kind: "split" }];
  }
  if (slots.buyW > 2) return [{ x: slots.buyX, w: slots.buyW, kind: "split" }];
  return [{ x: slots.sellX, w: slots.sellW, kind: "split" }];
}

export type ProfileBar = { x: number; w: number; side: "buy" | "sell" };

/** Pixel bars for a cell histogram — volume (bid/ask) or signed delta. */
export function profileBarRects(
  strip: { x: number; w: number; kind: "sell" | "buy" | "split" },
  cell: { buy: number; sell: number; delta: number },
  metric: "volume" | "delta",
  maxVol: number,
  maxDelta: number
): ProfileBar[] {
  const vol = Math.max(1e-9, maxVol);
  const dlt = Math.max(1e-9, maxDelta);
  if (metric === "delta") {
    const mag = Math.abs(cell.delta);
    if (!(mag > 0)) return [];
    const w = Math.min(strip.w, (mag / dlt) * strip.w);
    if (strip.kind === "sell") {
      if (cell.delta >= 0) return [];
      return [{ x: strip.x + strip.w - w, w, side: "sell" }];
    }
    if (strip.kind === "buy") {
      if (cell.delta <= 0) return [];
      return [{ x: strip.x, w, side: "buy" }];
    }
    const mid = strip.x + strip.w / 2;
    if (cell.delta < 0) return [{ x: mid - w, w, side: "sell" }];
    return [{ x: mid, w, side: "buy" }];
  }
  if (strip.kind === "sell") {
    const w = Math.max(0, (cell.sell / vol) * strip.w);
    return w > 0 ? [{ x: strip.x + strip.w - w, w, side: "sell" }] : [];
  }
  if (strip.kind === "buy") {
    const w = Math.max(0, (cell.buy / vol) * strip.w);
    return w > 0 ? [{ x: strip.x, w, side: "buy" }] : [];
  }
  const sellW = Math.max(0, (cell.sell / vol) * (strip.w / 2));
  const buyW = Math.max(0, (cell.buy / vol) * (strip.w / 2));
  const mid = strip.x + strip.w / 2;
  const out: ProfileBar[] = [];
  if (sellW > 0) out.push({ x: mid - sellW, w: sellW, side: "sell" });
  if (buyW > 0) out.push({ x: mid, w: buyW, side: "buy" });
  return out;
}
