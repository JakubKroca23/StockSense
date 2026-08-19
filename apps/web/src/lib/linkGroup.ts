export const LINK_GROUPS = ["A", "B", "C"] as const;

export type LinkGroup = (typeof LINK_GROUPS)[number];

export function isLinkGroup(v: unknown): v is LinkGroup {
  return v === "A" || v === "B" || v === "C";
}

export function readLinkGroup(v: unknown): LinkGroup | null {
  return isLinkGroup(v) ? v : null;
}

/** Visible price window shared by panels tagged with the same letter. */
export type LinkedPriceScale = {
  top: number;
  bottom: number;
  /** CSS pixels covering `top` → `bottom`. */
  height: number;
  /** CSS pixels per 1.0 price unit. */
  pxPerPrice: number;
  /** Viewport Y of the plot top — used to pixel-align side-by-side panels. */
  screenTop: number;
  sourceId: string;
  leadUntil: number;
};

export function sameLinkedScale(a: LinkedPriceScale, b: LinkedPriceScale) {
  const span = Math.max(1e-9, Math.abs(a.top - a.bottom));
  return (
    Math.abs(a.top - b.top) / span < 0.002 &&
    Math.abs(a.bottom - b.bottom) / span < 0.002 &&
    Math.abs(a.height - b.height) < 1 &&
    Math.abs(a.screenTop - b.screenTop) < 1 &&
    a.sourceId === b.sourceId
  );
}
