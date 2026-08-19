import type { OrderflowSettings } from "./types";

export const FP_STAT_ROW_H = 18;
export const FP_FOOTER_MAX = 420;

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function footerStatRows(
  settings: Pick<
    OrderflowSettings,
    "showDeltaRow" | "showMaxDeltaRow" | "showMinDeltaRow" | "showVolumeRow"
  >
): number {
  return (
    (settings.showDeltaRow ? 1 : 0) +
    (settings.showMaxDeltaRow ? 1 : 0) +
    (settings.showMinDeltaRow ? 1 : 0) +
    (settings.showVolumeRow ? 1 : 0)
  );
}

export function footprintFooterMinHeight(
  settings: Pick<
    OrderflowSettings,
    "showDeltaRow" | "showMaxDeltaRow" | "showMinDeltaRow" | "showVolumeRow" | "showCvd"
  >
): number {
  const stats = footerStatRows(settings);
  const minCvd = settings.showCvd ? 28 : 0;
  return Math.max(FP_STAT_ROW_H, stats * FP_STAT_ROW_H + minCvd);
}

/** Spodní tabulka footprintu v grafu (bez časové osy — tu má lightweight-charts). */
export function footprintFooterHeight(
  settings: Pick<
    OrderflowSettings,
    | "showDeltaRow"
    | "showMaxDeltaRow"
    | "showMinDeltaRow"
    | "showVolumeRow"
    | "showCvd"
    | "cvdHeight"
    | "footerHeight"
  >
): number {
  const minH = footprintFooterMinHeight(settings);
  if (typeof settings.footerHeight === "number" && Number.isFinite(settings.footerHeight)) {
    return clamp(Math.round(settings.footerHeight), minH, FP_FOOTER_MAX);
  }
  const statRows = footerStatRows(settings);
  const cvdH = settings.showCvd ? clamp(settings.cvdHeight, 28, 180) : 0;
  return statRows * FP_STAT_ROW_H + cvdH;
}

/** Split footer height across stat rows and CVD so dragging grows the whole table. */
export function footprintFooterLayout(
  settings: Pick<
    OrderflowSettings,
    | "showDeltaRow"
    | "showMaxDeltaRow"
    | "showMinDeltaRow"
    | "showVolumeRow"
    | "showCvd"
    | "cvdHeight"
    | "footerHeight"
  >,
  totalH: number
): { rowH: number; cvdH: number } {
  const stats = footerStatRows(settings);
  const hasCvd = settings.showCvd;
  const dragged =
    typeof settings.footerHeight === "number" && Number.isFinite(settings.footerHeight);
  if (!dragged) {
    return {
      rowH: FP_STAT_ROW_H,
      cvdH: hasCvd ? clamp(settings.cvdHeight, 28, 180) : 0,
    };
  }
  const minH = footprintFooterMinHeight(settings);
  const h = clamp(Math.round(totalH), minH, FP_FOOTER_MAX);
  const extra = Math.max(0, h - minH);
  const parts = stats + (hasCvd ? 1 : 0);
  if (parts <= 0) return { rowH: FP_STAT_ROW_H, cvdH: 0 };
  const share = extra / parts;
  return {
    rowH: stats > 0 ? FP_STAT_ROW_H + share : FP_STAT_ROW_H,
    cvdH: hasCvd ? (stats > 0 ? 28 + share : h) : 0,
  };
}

export function footprintFooterEnabled(
  settings: Pick<
    OrderflowSettings,
    "showDeltaRow" | "showMaxDeltaRow" | "showMinDeltaRow" | "showVolumeRow" | "showCvd"
  >
): boolean {
  return (
    settings.showDeltaRow ||
    settings.showMaxDeltaRow ||
    settings.showMinDeltaRow ||
    settings.showVolumeRow ||
    settings.showCvd
  );
}
