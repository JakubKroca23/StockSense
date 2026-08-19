import type { OrderflowSettings } from "./types";

export const FP_STAT_ROW_H = 18;

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

/** Spodní tabulka footprintu v grafu (bez časové osy — tu má lightweight-charts). */
export function footprintFooterHeight(settings: Pick<
  OrderflowSettings,
  "showDeltaRow" | "showMaxDeltaRow" | "showMinDeltaRow" | "showVolumeRow" | "showCvd" | "cvdHeight"
>): number {
  const statRows =
    (settings.showDeltaRow ? 1 : 0) +
    (settings.showMaxDeltaRow ? 1 : 0) +
    (settings.showMinDeltaRow ? 1 : 0) +
    (settings.showVolumeRow ? 1 : 0);
  const cvdH = settings.showCvd ? clamp(settings.cvdHeight, 28, 180) : 0;
  return statRows * FP_STAT_ROW_H + cvdH;
}

export function footprintFooterEnabled(settings: Pick<
  OrderflowSettings,
  "showDeltaRow" | "showMaxDeltaRow" | "showMinDeltaRow" | "showVolumeRow" | "showCvd"
>): boolean {
  return (
    settings.showDeltaRow ||
    settings.showMaxDeltaRow ||
    settings.showMinDeltaRow ||
    settings.showVolumeRow ||
    settings.showCvd
  );
}
