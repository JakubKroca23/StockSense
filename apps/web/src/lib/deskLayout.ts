import { isLinkGroup, type LinkGroup } from "@/lib/linkGroup";

export type DeskPanelId = "chart" | "orderbook" | "tape" | "footprint" | "dom";

export type DropZone = "center" | "left" | "right" | "top" | "bottom";

export type DeskLeaf = {
  type: "leaf";
  id: string;
  panel: DeskPanelId;
  /** Panels with the same letter share price-scale settings (row height / visible range). */
  linkGroup?: LinkGroup;
};

export type DeskSplit = {
  type: "split";
  id: string;
  dir: "row" | "col";
  sizes: number[];
  children: DeskNode[];
};

export type DeskNode = DeskLeaf | DeskSplit;

export const NEW_CHART_DRAG = "__new-chart__";

const PANELS: DeskPanelId[] = ["chart", "orderbook", "tape", "footprint", "dom"];

let splitSeq = 0;
function newSplitId() {
  splitSeq += 1;
  return `split-${Date.now().toString(36)}-${splitSeq}`;
}

let leafSeq = 0;
export function newChartLeaf(): DeskLeaf {
  leafSeq += 1;
  return { type: "leaf", id: `chart-${Date.now().toString(36)}-${leafSeq}`, panel: "chart" };
}

export const DEFAULT_DESK_LAYOUT: DeskNode = {
  type: "split",
  id: "root",
  dir: "row",
  sizes: [68, 32],
  children: [
    { type: "leaf", id: "chart", panel: "chart" },
    { type: "leaf", id: "dom", panel: "dom" },
  ],
};

export function cloneDesk(node: DeskNode): DeskNode {
  return JSON.parse(JSON.stringify(node)) as DeskNode;
}

export function isDeskNode(v: unknown): v is DeskNode {
  if (!v || typeof v !== "object") return false;
  const n = v as DeskNode;
  if (n.type === "leaf") {
    if (!PANELS.includes(n.panel) || typeof n.id !== "string") return false;
    if (n.linkGroup != null && !isLinkGroup(n.linkGroup)) return false;
    return true;
  }
  if (n.type === "split") {
    return (
      (n.dir === "row" || n.dir === "col") &&
      Array.isArray(n.children) &&
      Array.isArray(n.sizes) &&
      n.children.length >= 1 &&
      n.children.every(isDeskNode)
    );
  }
  return false;
}

export function unifyMarketPanels(node: DeskNode): DeskNode {
  const hasBook = hasPanel(node, "orderbook");
  const hasTape = hasPanel(node, "tape");
  if (!hasBook && !hasTape) return node;
  let next = node;
  if (!hasPanel(next, "dom")) {
    let converted = false;
    const walk = (n: DeskNode): DeskNode => {
      if (n.type === "leaf") {
        if (!converted && (n.panel === "orderbook" || n.panel === "tape")) {
          converted = true;
          return { type: "leaf", id: "dom", panel: "dom", linkGroup: n.linkGroup };
        }
        return n;
      }
      return { ...n, children: n.children.map(walk) };
    };
    next = walk(next);
  }
  next = removePanel(next, "orderbook") ?? next;
  next = removePanel(next, "tape") ?? next;
  return next;
}

export function hasPanel(node: DeskNode, panel: DeskPanelId): boolean {
  if (node.type === "leaf") return node.panel === panel;
  return node.children.some((ch) => hasPanel(ch, panel));
}

export function collectPanels(node: DeskNode): Set<DeskPanelId> {
  const out = new Set<DeskPanelId>();
  const walk = (n: DeskNode) => {
    if (n.type === "leaf") out.add(n.panel);
    else n.children.forEach(walk);
  };
  walk(node);
  return out;
}

export function collectLeaves(node: DeskNode): DeskLeaf[] {
  const out: DeskLeaf[] = [];
  const walk = (n: DeskNode) => {
    if (n.type === "leaf") out.push(n);
    else n.children.forEach(walk);
  };
  walk(node);
  return out;
}

export function collectChartLeaves(node: DeskNode): DeskLeaf[] {
  return collectLeaves(node).filter((leaf) => leaf.panel === "chart");
}

/** Old dedicated footprint windows become chart panes — footprint is a chart type now. */
export function promoteFootprintLeaves(node: DeskNode): DeskNode {
  if (node.type === "leaf") {
    if (node.panel !== "footprint") return node;
    return { type: "leaf", id: node.id, panel: "chart", linkGroup: node.linkGroup };
  }
  return { ...node, children: node.children.map(promoteFootprintLeaves) };
}

export function footprintLeafIds(node: DeskNode): string[] {
  return collectLeaves(node)
    .filter((leaf) => leaf.panel === "footprint")
    .map((leaf) => leaf.id);
}

export function findLeaf(node: DeskNode, id: string): DeskLeaf | null {
  if (node.type === "leaf") return node.id === id ? node : null;
  for (const ch of node.children) {
    const found = findLeaf(ch, id);
    if (found) return found;
  }
  return null;
}

export function firstLeafOf(node: DeskNode, panel: DeskPanelId): DeskLeaf | null {
  if (node.type === "leaf") return node.panel === panel ? node : null;
  for (const ch of node.children) {
    const found = firstLeafOf(ch, panel);
    if (found) return found;
  }
  return null;
}

export function panelKindFromId(id: string): DeskPanelId {
  for (const panel of PANELS) {
    if (panel === "chart") continue;
    if (id === panel || id.startsWith(`${panel}-`)) {
      if (panel === "orderbook" || panel === "tape") return "dom";
      return panel;
    }
  }
  return "chart";
}

function leafOf(panel: DeskPanelId): DeskLeaf {
  if (panel === "chart") return newChartLeaf();
  return { type: "leaf", id: panel, panel };
}

function normalizeSizes(sizes: number[]) {
  const sum = sizes.reduce((a, b) => a + b, 0) || 1;
  return sizes.map((s) => (s / sum) * 100);
}

export function removePanel(node: DeskNode, panel: DeskPanelId): DeskNode | null {
  if (node.type === "leaf") return node.panel === panel ? null : node;
  const children: DeskNode[] = [];
  const sizes: number[] = [];
  node.children.forEach((ch, i) => {
    const next = removePanel(ch, panel);
    if (next) {
      children.push(next);
      sizes.push(node.sizes[i] ?? 1);
    }
  });
  if (!children.length) return null;
  if (children.length === 1) return children[0];
  return { ...node, children, sizes: normalizeSizes(sizes) };
}

export function removeLeaf(node: DeskNode, id: string): DeskNode | null {
  if (node.type === "leaf") return node.id === id ? null : node;
  const children: DeskNode[] = [];
  const sizes: number[] = [];
  node.children.forEach((ch, i) => {
    const next = removeLeaf(ch, id);
    if (next) {
      children.push(next);
      sizes.push(node.sizes[i] ?? 1);
    }
  });
  if (!children.length) return null;
  if (children.length === 1) return children[0];
  return { ...node, children, sizes: normalizeSizes(sizes) };
}

function wrap(target: DeskLeaf, incoming: DeskLeaf, zone: DropZone): DeskSplit {
  const dir: "row" | "col" = zone === "left" || zone === "right" ? "row" : "col";
  const incomingFirst = zone === "left" || zone === "top";
  return {
    type: "split",
    id: newSplitId(),
    dir,
    sizes: [50, 50],
    children: incomingFirst ? [incoming, target] : [target, incoming],
  };
}

function insertAt(node: DeskNode, targetId: string, incoming: DeskLeaf, zone: DropZone): DeskNode {
  if (node.type === "leaf") {
    if (node.id !== targetId) return node;
    return wrap(node, incoming, zone);
  }
  return {
    ...node,
    children: node.children.map((ch) => insertAt(ch, targetId, incoming, zone)),
  };
}

function swapLeaves(node: DeskNode, a: string, b: string): DeskNode {
  const leafA = findLeaf(node, a);
  const leafB = findLeaf(node, b);
  if (!leafA || !leafB) return node;
  const walk = (n: DeskNode): DeskNode => {
    if (n.type === "leaf") {
      if (n.id === a) return { ...leafB };
      if (n.id === b) return { ...leafA };
      return n;
    }
    return { ...n, children: n.children.map(walk) };
  };
  return walk(node);
}

function incomingFromDrag(root: DeskNode, sourceId: string): DeskLeaf {
  const existing = findLeaf(root, sourceId);
  if (existing) return { ...existing };
  if (sourceId === NEW_CHART_DRAG) return newChartLeaf();
  return leafOf(panelKindFromId(sourceId));
}

export function movePanel(root: DeskNode, sourceId: string, targetId: string, zone: DropZone): DeskNode {
  if (sourceId === targetId) return root;
  if (zone === "center") {
    if (findLeaf(root, sourceId) && findLeaf(root, targetId)) {
      return swapLeaves(root, sourceId, targetId);
    }
    zone = "right";
  }
  const incoming = incomingFromDrag(root, sourceId);
  const stripped = findLeaf(root, incoming.id) ? removeLeaf(root, incoming.id) : root;
  const base = stripped ?? root;
  if (!findLeaf(base, targetId)) {
    return incoming.panel === "chart" ? addChart(base) : addPanel(base, incoming.panel);
  }
  return insertAt(base, targetId, incoming, zone);
}

export function attachLeaf(root: DeskNode, incoming: DeskLeaf): DeskNode {
  if (findLeaf(root, incoming.id)) return root;
  if (incoming.panel === "chart" || incoming.panel === "footprint") {
    const target = firstLeafOf(root, "chart");
    if (target) return insertAt(root, target.id, incoming, "bottom");
  }
  if (root.type === "split" && root.dir === "row") {
    const lastIdx = root.children.length - 1;
    const last = root.children[lastIdx];
    if (last.type === "split" && last.dir === "col") {
      const n = last.children.length;
      const sizes = last.sizes.map((s) => (s * n) / (n + 1));
      const stacked: DeskSplit = {
        ...last,
        children: [...last.children, incoming],
        sizes: normalizeSizes([...sizes, 100 / (n + 1)]),
      };
      const children = root.children.slice();
      children[lastIdx] = stacked;
      return { ...root, children };
    }
    if (last.type === "leaf" && last.panel !== "chart") {
      const stacked: DeskSplit = {
        type: "split",
        id: newSplitId(),
        dir: "col",
        sizes: [50, 50],
        children: [last, incoming],
      };
      return { ...root, children: [...root.children.slice(0, -1), stacked] };
    }
    const scaled = root.sizes.map((s) => s * 0.72);
    return {
      ...root,
      children: [...root.children, incoming],
      sizes: normalizeSizes([...scaled, 28]),
    };
  }
  return {
    type: "split",
    id: newSplitId(),
    dir: "row",
    sizes: [72, 28],
    children: [root, incoming],
  };
}

export function addPanel(root: DeskNode, panel: DeskPanelId): DeskNode {
  if (panel === "chart") return addChart(root);
  if (hasPanel(root, panel)) return root;
  return attachLeaf(root, leafOf(panel));
}

export function restoreMissingLeaves(working: DeskNode, saved: DeskNode): DeskNode {
  const have = new Set(collectLeaves(working).map((leaf) => leaf.id));
  let next = working;
  for (const leaf of collectLeaves(saved)) {
    if (have.has(leaf.id)) continue;
    next = attachLeaf(next, leaf);
  }
  return next;
}

export function addChart(root: DeskNode): DeskNode {
  const incoming = newChartLeaf();
  const target = firstLeafOf(root, "chart");
  if (!target) {
    return {
      type: "split",
      id: newSplitId(),
      dir: "row",
      sizes: [50, 50],
      children: [incoming, root],
    };
  }
  return insertAt(root, target.id, incoming, "right");
}

export function togglePanel(root: DeskNode, panel: DeskPanelId): DeskNode {
  if (panel === "chart") return addChart(root);
  if (hasPanel(root, panel)) {
    return removePanel(root, panel) ?? newChartLeaf();
  }
  return addPanel(root, panel);
}

export function resizeSplit(node: DeskNode, splitId: string, sizes: number[]): DeskNode {
  if (node.type === "leaf") return node;
  if (node.id === splitId) return { ...node, sizes: normalizeSizes(sizes) };
  return { ...node, children: node.children.map((ch) => resizeSplit(ch, splitId, sizes)) };
}

export function setLeafLinkGroup(node: DeskNode, id: string, group: LinkGroup | null): DeskNode {
  if (node.type === "leaf") {
    if (node.id !== id) return node;
    if (!group) {
      return { type: "leaf", id: node.id, panel: node.panel };
    }
    return { ...node, linkGroup: group };
  }
  return { ...node, children: node.children.map((ch) => setLeafLinkGroup(ch, id, group)) };
}

export function dropZoneFromPoint(rect: DOMRect, x: number, y: number): DropZone {
  const px = (x - rect.left) / Math.max(rect.width, 1);
  const py = (y - rect.top) / Math.max(rect.height, 1);
  const edge = 0.26;
  if (px < edge) return "left";
  if (px > 1 - edge) return "right";
  if (py < edge) return "top";
  if (py > 1 - edge) return "bottom";
  return "center";
}

export const PANEL_LABEL: Record<DeskPanelId, string> = {
  chart: "Chart",
  orderbook: "Orderbook",
  tape: "Tape",
  footprint: "Footprint",
  dom: "DOM",
};
