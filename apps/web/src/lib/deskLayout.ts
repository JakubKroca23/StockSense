export type DeskPanelId = "chart" | "orderbook" | "tape";

export type DropZone = "center" | "left" | "right" | "top" | "bottom";

export type DeskLeaf = {
  type: "leaf";
  id: string;
  panel: DeskPanelId;
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

const PANELS: DeskPanelId[] = ["chart", "orderbook", "tape"];

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
  sizes: [72, 28],
  children: [
    { type: "leaf", id: "chart", panel: "chart" },
    {
      type: "split",
      id: "side",
      dir: "col",
      sizes: [50, 50],
      children: [
        { type: "leaf", id: "orderbook", panel: "orderbook" },
        { type: "leaf", id: "tape", panel: "tape" },
      ],
    },
  ],
};

export function cloneDesk(node: DeskNode): DeskNode {
  return JSON.parse(JSON.stringify(node)) as DeskNode;
}

export function isDeskNode(v: unknown): v is DeskNode {
  if (!v || typeof v !== "object") return false;
  const n = v as DeskNode;
  if (n.type === "leaf") {
    return PANELS.includes(n.panel) && typeof n.id === "string";
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

export function collectChartLeaves(node: DeskNode): DeskLeaf[] {
  const out: DeskLeaf[] = [];
  const walk = (n: DeskNode) => {
    if (n.type === "leaf") {
      if (n.panel === "chart") out.push(n);
      return;
    }
    n.children.forEach(walk);
  };
  walk(node);
  return out;
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
  if (id === "orderbook" || id.startsWith("orderbook-")) return "orderbook";
  if (id === "tape" || id.startsWith("tape-")) return "tape";
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

export function addPanel(root: DeskNode, panel: DeskPanelId): DeskNode {
  if (panel === "chart") return addChart(root);
  if (hasPanel(root, panel)) return root;
  const incoming = leafOf(panel);
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
};
