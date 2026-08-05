import type { DataQuality } from "@/lib/types";

const LABEL: Record<DataQuality, string> = {
  high: "Vysoká",
  medium: "Střední",
  low: "Nízká",
  proxy: "Proxy",
  unavailable: "Nedostupné",
};

export function DataQualityBadge({
  quality,
  compact,
}: {
  quality?: DataQuality | string | null;
  compact?: boolean;
}) {
  if (!quality) return null;
  const q = quality as DataQuality;
  const label = LABEL[q] || quality;
  return (
    <span className={`badge dq-badge dq-badge--${quality}`} title={`Data quality: ${label}`}>
      {compact ? `DQ ${quality}` : `DQ ${label}`}
    </span>
  );
}
