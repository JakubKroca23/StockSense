import {
  cloneDesk,
  collectChartLeaves,
  DEFAULT_DESK_LAYOUT,
  isDeskNode,
  promoteFootprintLeaves,
  unifyMarketPanels,
} from "@/lib/deskLayout";
import { LINEAR_DESKS } from "@/lib/desks";
import {
  canonicalizeSnapshot,
  newLayoutId,
  parseLayoutCatalog,
  type DeskLayoutSnapshot,
} from "@/lib/deskLayouts";
import { DEFAULT_DOM_SETTINGS, type DomSettings } from "@/lib/orderflow";
import { readDomDefaults } from "@/lib/deskDefaults";

export const LAYOUT_ICON_IDS = [
  "desk",
  "btc",
  "oil",
  "gold",
  "book",
  "tape",
  "dom",
  "footprint",
  "draw",
  "home",
] as const;

export type LayoutIconId = (typeof LAYOUT_ICON_IDS)[number];

export type WorkspaceLayout = {
  id: string;
  name: string;
  icon: LayoutIconId;
  symbolId: string;
  savedAt: number;
  snapshot: DeskLayoutSnapshot;
};

export type WorkspaceCatalog = {
  activeId: string;
  items: WorkspaceLayout[];
};

export const WORKSPACE_KEY = "stocksense-workspace";
export const WORKSPACE_EVENT = "stocksense-workspace";

const DESK_STORE = "stocksense-desk";

function lsGet(key: string) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function lsSet(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

export function isLayoutIconId(value: unknown): value is LayoutIconId {
  return typeof value === "string" && (LAYOUT_ICON_IDS as readonly string[]).includes(value);
}

export function iconForSymbol(symbolId: string): LayoutIconId {
  return isLayoutIconId(symbolId) ? symbolId : "desk";
}

function captureWorkingSnapshot(deskId: string): DeskLayoutSnapshot {
  let mosaic = cloneDesk(DEFAULT_DESK_LAYOUT);
  try {
    const raw = lsGet(`${DESK_STORE}-${deskId}-layout`);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (isDeskNode(parsed)) mosaic = unifyMarketPanels(promoteFootprintLeaves(parsed));
    }
  } catch {
    /* ignore */
  }
  const panes: Record<string, unknown> = {};
  for (const leaf of collectChartLeaves(mosaic)) {
    try {
      const raw = lsGet(`${DESK_STORE}-${deskId}-pane-${leaf.id}`);
      if (raw) panes[leaf.id] = JSON.parse(raw) as unknown;
    } catch {
      /* ignore */
    }
  }
  let domViz: DomSettings = { ...DEFAULT_DOM_SETTINGS };
  try {
    const raw = lsGet(`${DESK_STORE}-${deskId}-dom-viz`);
    if (raw) domViz = { ...DEFAULT_DOM_SETTINGS, ...(JSON.parse(raw) as Partial<DomSettings>) };
  } catch {
    /* ignore */
  }
  return { mosaic, panes, domViz };
}

function writeWorkingSnapshot(deskId: string, snap: DeskLayoutSnapshot) {
  lsSet(`${DESK_STORE}-${deskId}-layout`, JSON.stringify(snap.mosaic));
  lsSet(`${DESK_STORE}-${deskId}-dom-viz`, JSON.stringify(snap.domViz));
  for (const [leafId, prefs] of Object.entries(snap.panes)) {
    lsSet(`${DESK_STORE}-${deskId}-pane-${leafId}`, JSON.stringify(prefs));
  }
}

function emptySnapshot(): DeskLayoutSnapshot {
  const mosaic = cloneDesk(DEFAULT_DESK_LAYOUT);
  return { mosaic, panes: {}, domViz: readDomDefaults() };
}

function parseWorkspace(raw: string | null): WorkspaceCatalog | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<WorkspaceCatalog>;
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.items)) return null;
    const items = parsed.items
      .filter((item) => item && typeof item.id === "string" && typeof item.name === "string")
      .filter((item) => item.snapshot && isDeskNode(item.snapshot.mosaic))
      .map((item) => ({
        id: item.id,
        name: item.name,
        icon: isLayoutIconId(item.icon) ? item.icon : iconForSymbol(item.symbolId),
        symbolId: typeof item.symbolId === "string" && item.symbolId ? item.symbolId : "btc",
        savedAt: typeof item.savedAt === "number" ? item.savedAt : Date.now(),
        snapshot: {
          mosaic: unifyMarketPanels(promoteFootprintLeaves(item.snapshot.mosaic)),
          panes:
            item.snapshot.panes && typeof item.snapshot.panes === "object" ? item.snapshot.panes : {},
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

function migrateWorkspace(): WorkspaceCatalog {
  const items: WorkspaceLayout[] = [];
  for (const desk of LINEAR_DESKS) {
    const old = parseLayoutCatalog(lsGet(`${DESK_STORE}-${desk.id}-layouts`));
    if (old?.items.length) {
      old.items.forEach((entry, index) => {
        items.push({
          id: index === 0 ? desk.id : entry.id,
          name: entry.name,
          icon: iconForSymbol(desk.id),
          symbolId: desk.id,
          savedAt: entry.savedAt || Date.now(),
          snapshot: entry.snapshot,
        });
      });
      continue;
    }
    const snap = captureWorkingSnapshot(desk.id);
    items.push({
      id: desk.id,
      name: desk.navLabel,
      icon: iconForSymbol(desk.id),
      symbolId: desk.id,
      savedAt: Date.now(),
      snapshot: snap,
    });
  }
  if (!items.length) {
    const id = "btc";
    items.push({
      id,
      name: "BTC",
      icon: "btc",
      symbolId: "btc",
      savedAt: Date.now(),
      snapshot: emptySnapshot(),
    });
  }
  return { activeId: items[0].id, items };
}

let cache: { raw: string; catalog: WorkspaceCatalog } | null = null;

export const EMPTY_CATALOG: WorkspaceCatalog = { activeId: "", items: [] };

/** Side-effect free. Used by `useSyncExternalStore`. */
export function loadWorkspace(): WorkspaceCatalog {
  const raw = lsGet(WORKSPACE_KEY);
  if (cache && cache.raw === (raw ?? "")) return cache.catalog;
  const parsed = parseWorkspace(raw);
  const catalog = parsed ?? EMPTY_CATALOG;
  cache = { raw: raw ?? "", catalog };
  return catalog;
}

export function ensureWorkspace(): WorkspaceCatalog {
  const current = loadWorkspace();
  if (current.items.length) return current;
  const migrated = migrateWorkspace();
  saveWorkspace(migrated);
  return migrated;
}

export function saveWorkspace(catalog: WorkspaceCatalog) {
  const raw = JSON.stringify(catalog);
  lsSet(WORKSPACE_KEY, raw);
  cache = { raw, catalog };
  try {
    window.dispatchEvent(new Event(WORKSPACE_EVENT));
  } catch {
    /* ignore */
  }
}

export function snapshotsEqual(a: DeskLayoutSnapshot, b: DeskLayoutSnapshot) {
  return canonicalizeSnapshot(a) === canonicalizeSnapshot(b);
}

export function createWorkspaceLayout(name: string, icon: LayoutIconId, symbolId = "btc"): WorkspaceLayout {
  const id = newLayoutId();
  const snapshot = emptySnapshot();
  writeWorkingSnapshot(id, snapshot);
  return {
    id,
    name: name.trim() || "Layout",
    icon,
    symbolId,
    savedAt: Date.now(),
    snapshot,
  };
}

export { writeWorkingSnapshot, emptySnapshot, captureWorkingSnapshot };
