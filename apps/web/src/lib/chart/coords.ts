import type { IChartApi, ISeriesApi, Time, UTCTimestamp } from "lightweight-charts";
import type { ChartPoint } from "./types";

export type PixelPoint = { x: number; y: number };

export function pixelToPoint(
  chart: IChartApi,
  series: ISeriesApi<"Candlestick">,
  x: number,
  y: number
): ChartPoint | null {
  const time = chart.timeScale().coordinateToTime(x);
  const price = series.coordinateToPrice(y);
  if (time == null || price == null || !Number.isFinite(price)) return null;
  const ts = typeof time === "number" ? time : Date.parse(String(time)) / 1000;
  if (!Number.isFinite(ts)) return null;
  return { time: ts as UTCTimestamp, price };
}

export function pointToPixel(
  chart: IChartApi,
  series: ISeriesApi<"Candlestick">,
  pt: ChartPoint
): PixelPoint | null {
  const x = chart.timeScale().timeToCoordinate(pt.time as Time);
  const y = series.priceToCoordinate(pt.price);
  if (x == null || y == null) return null;
  return { x, y };
}

export function priceToY(series: ISeriesApi<"Candlestick">, price: number): number | null {
  return series.priceToCoordinate(price);
}
