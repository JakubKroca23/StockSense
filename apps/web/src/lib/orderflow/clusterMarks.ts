import { alpha } from "./theme";
import type { ClusterSlots } from "./clusterLayout";

/** Small marker on the bid/ask edge of a cluster cell. */
export function drawImbalanceDot(
  ctx: CanvasRenderingContext2D,
  slots: ClusterSlots,
  cellY: number,
  cellH: number,
  side: "buy" | "sell",
  color: string,
  stacked: boolean
) {
  const r = Math.max(2.4, Math.min(stacked ? 5 : 3.6, cellH * (stacked ? 0.34 : 0.26)));
  const cy = cellY + cellH / 2;
  const cx = side === "buy" ? slots.buyX + slots.buyW - r - 1 : slots.sellX + r + 1;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = stacked ? 1.4 : 1;
  ctx.strokeStyle = stacked ? "rgba(255,255,255,0.55)" : "rgba(6,10,18,0.45)";
  ctx.stroke();
}

/** Exhaustion chevron — buy fade at the high, sell fade at the low. */
export function drawFadeMark(
  ctx: CanvasRenderingContext2D,
  slots: ClusterSlots,
  cellY: number,
  cellH: number,
  side: "buy" | "sell",
  color: string
) {
  const h = Math.max(8, Math.min(16, cellH * 0.9));
  const w = Math.max(7, Math.min(12, Math.max(slots.buyW, slots.sellW) * 0.42));
  ctx.beginPath();
  if (side === "buy") {
    const x = slots.buyX + slots.buyW - 1.5;
    const y = cellY + 1;
    ctx.moveTo(x - w, y);
    ctx.lineTo(x, y);
    ctx.lineTo(x - w / 2, y + h);
  } else {
    const x = slots.sellX + 1.5;
    const y = cellY + cellH - 1;
    ctx.moveTo(x, y);
    ctx.lineTo(x + w, y);
    ctx.lineTo(x + w / 2, y - h);
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 1.25;
  ctx.strokeStyle = "rgba(6,10,18,0.55)";
  ctx.stroke();
}

/** Stronger absorption box: fill, thick dash, corner ticks. */
export function drawAbsorptionMark(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string
) {
  if (w < 4 || h < 4) return;
  ctx.save();
  ctx.fillStyle = alpha(color, 0.2);
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.setLineDash([5, 3]);
  ctx.strokeRect(x + 1, y + 1, Math.max(1, w - 2), Math.max(1, h - 2));
  ctx.setLineDash([]);
  const tick = Math.max(5, Math.min(11, Math.min(w, h) * 0.28));
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.moveTo(x, y + tick);
  ctx.lineTo(x, y);
  ctx.lineTo(x + tick, y);
  ctx.moveTo(x + w, y + tick);
  ctx.lineTo(x + w, y);
  ctx.lineTo(x + w - tick, y);
  ctx.moveTo(x, y + h - tick);
  ctx.lineTo(x, y + h);
  ctx.lineTo(x + tick, y + h);
  ctx.moveTo(x + w, y + h - tick);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x + w - tick, y + h);
  ctx.stroke();
  ctx.restore();
}

export function drawCurrentPriceRow(
  ctx: CanvasRenderingContext2D,
  y: number,
  rowH: number,
  width: number,
  color: string
) {
  const top = y - rowH / 2;
  ctx.fillStyle = alpha(color, 0.12);
  ctx.fillRect(0, top, width, Math.max(2, rowH));
  ctx.strokeStyle = alpha(color, 0.9);
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.moveTo(0, Math.round(y) + 0.5);
  ctx.lineTo(width, Math.round(y) + 0.5);
  ctx.stroke();
  ctx.setLineDash([]);
}
