import { isDeskNode, promoteFootprintLeaves, unifyMarketPanels, type DeskNode } from "@/lib/deskLayout";
import { DEFAULT_DOM_SETTINGS, type DomSettings } from "@/lib/orderflow";

export type DeskLayoutSnapshot = {
  mosaic: DeskNode;
  panes: Record<string, unknown>;
  domViz: DomSettings;
};

export type DeskSavedLayout = {
  id: string;
  name: string;
  savedAt: number;
  snapshot: DeskLayoutSnapshot;
};

export type DeskLayoutCatalog = {
  activeId: string;
  items: DeskSavedLayout[];
};

export function newLayoutId() {
  return `lay-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function nextLayoutName(items: { name: string }[]): string {
  const used = new Set(items.map((item) => item.name));
  let n = 1;
  while (used.has(`Layout ${n}`)) n += 1;
  return `Layout ${n}`;
}

export function canonicalizeSnapshot(snap: DeskLayoutSnapshot): string {
  const panes = Object.fromEntries(
    Object.entries(snap.panes).sort(([a], [b]) => a.localeCompare(b))
  );
  return JSON.stringify({ mosaic: snap.mosaic, panes, domViz: snap.domViz });
}

function isSavedLayout(value: unknown): value is DeskSavedLayout {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<DeskSavedLayout>;
  if (typeof item.id !== "string" || typeof item.name !== "string") return false;
  if (!item.snapshot || typeof item.snapshot !== "object") return false;
  return isDeskNode(item.snapshot.mosaic);
}

export function parseLayoutCatalog(raw: string | null): DeskLayoutCatalog | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<DeskLayoutCatalog>;
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.items)) return null;
    const items = parsed.items.filter(isSavedLayout).map((item) => ({
      ...item,
      snapshot: {
        mosaic: unifyMarketPanels(promoteFootprintLeaves(item.snapshot.mosaic)),
        panes: item.snapshot.panes && typeof item.snapshot.panes === "object" ? item.snapshot.panes : {},
        domViz: { ...DEFAULT_DOM_SETTINGS, ...(item.snapshot.domViz ?? {}) },
      },
    }));
    if (!items.length) return null;
    const activeId =
      typeof parsed.activeId === "string" && items.some((item) => item.id === parsed.activeId)
        ? parsed.activeId
        : items[0].id;
    return { activeId, items };
  } catch {
    return null;
  }
}
