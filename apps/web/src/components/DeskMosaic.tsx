"use client";

import {
  createContext,
  Fragment,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  movePanel,
  panelKindFromId,
  resizeSplit,
  type DeskLeaf,
  type DeskNode,
  type DeskSplit,
  type DropZone,
  PANEL_LABEL,
  dropZoneFromPoint,
} from "@/lib/deskLayout";

type Dragging = {
  id: string;
  x: number;
  y: number;
  over: { id: string; zone: DropZone } | null;
};

type DeskDragApi = {
  beginDrag: (id: string, x: number, y: number) => void;
  dragging: string | null;
  over: { id: string; zone: DropZone } | null;
  resizeById: (splitId: string, sizes: number[]) => void;
};

const DeskDragCtx = createContext<DeskDragApi | null>(null);

export function useDeskDrag() {
  return useContext(DeskDragCtx);
}

export function DeskWorkspace({
  layout,
  onLayout,
  children,
}: {
  layout: DeskNode;
  onLayout: (next: DeskNode) => void;
  children: ReactNode;
}) {
  const [drag, setDrag] = useState<Dragging | null>(null);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const leafEls = useRef(new Map<string, HTMLElement>());
  const dropRef = useRef<Dragging["over"]>(null);
  const panelRef = useRef<string | null>(null);

  const setLeafEl = useCallback((id: string, el: HTMLElement | null) => {
    if (el) leafEls.current.set(id, el);
    else leafEls.current.delete(id);
  }, []);

  const beginDrag = useCallback((id: string, x: number, y: number) => {
    panelRef.current = id;
    dropRef.current = null;
    setDrag({ id, x, y, over: null });
  }, []);

  const resizeById = useCallback(
    (splitId: string, sizes: number[]) => {
      onLayout(resizeSplit(layoutRef.current, splitId, sizes));
    },
    [onLayout]
  );

  useEffect(() => {
    if (!drag) return;
    const prevSelect = document.body.style.userSelect;
    document.body.style.userSelect = "none";
    document.body.classList.add("desk-dragging");
    window.getSelection()?.removeAllRanges();
    const onMove = (e: PointerEvent) => {
      let over: Dragging["over"] = null;
      for (const [id, el] of leafEls.current) {
        if (id === panelRef.current) continue;
        const r = el.getBoundingClientRect();
        if (
          e.clientX >= r.left &&
          e.clientX <= r.right &&
          e.clientY >= r.top &&
          e.clientY <= r.bottom
        ) {
          over = { id, zone: dropZoneFromPoint(r, e.clientX, e.clientY) };
          break;
        }
      }
      dropRef.current = over;
      setDrag((d) => (d ? { ...d, x: e.clientX, y: e.clientY, over } : d));
    };
    const onUp = () => {
      const over = dropRef.current;
      const panel = panelRef.current;
      setDrag(null);
      panelRef.current = null;
      dropRef.current = null;
      if (over && panel && panel !== over.id) {
        onLayout(movePanel(layoutRef.current, panel, over.id, over.zone));
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      document.body.style.userSelect = prevSelect;
      document.body.classList.remove("desk-dragging");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [drag?.id, onLayout]);

  return (
    <DeskDragCtx.Provider
      value={{ beginDrag, dragging: drag?.id ?? null, over: drag?.over ?? null, resizeById }}
    >
      <DeskLeafReg.Provider value={setLeafEl}>
        {children}
        {drag
          ? createPortal(
              <div className="desk-mod__ghost" style={{ left: drag.x + 12, top: drag.y + 12 }}>
                {PANEL_LABEL[panelKindFromId(drag.id)]}
              </div>,
              document.body
            )
          : null}
      </DeskLeafReg.Provider>
    </DeskDragCtx.Provider>
  );
}

const DeskLeafReg = createContext<(id: string, el: HTMLElement | null) => void>(() => {});

export function DeskMosaic({
  layout,
  onLayout,
  renderPanel,
}: {
  layout: DeskNode;
  onLayout: (next: DeskNode) => void;
  renderPanel: (leaf: DeskLeaf) => ReactNode;
}) {
  const drag = useDeskDrag();
  return (
    <div className={`desk-mod${drag?.dragging ? " is-dragging" : ""}`}>
      <DeskNodeView node={layout} onLayout={onLayout} renderPanel={renderPanel} />
    </div>
  );
}

function DeskNodeView({
  node,
  onLayout,
  renderPanel,
}: {
  node: DeskNode;
  onLayout: (next: DeskNode) => void;
  renderPanel: (leaf: DeskLeaf) => ReactNode;
}) {
  const setLeafEl = useContext(DeskLeafReg);
  const drag = useDeskDrag();
  if (node.type === "leaf") {
    const hint = drag?.over?.id === node.id ? drag.over.zone : null;
    return (
      <div
        className={`desk-mod__leaf${drag?.dragging === node.id ? " is-source" : ""}`}
        ref={(el) => setLeafEl(node.id, el)}
      >
        {renderPanel(node)}
        {hint ? <div className={`desk-mod__hint is-${hint}`} /> : null}
      </div>
    );
  }
  return <DeskSplitView node={node} onLayout={onLayout} renderPanel={renderPanel} />;
}

function DeskSplitView({
  node,
  onLayout,
  renderPanel,
}: {
  node: DeskSplit;
  onLayout: (next: DeskNode) => void;
  renderPanel: (leaf: DeskLeaf) => ReactNode;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const nodeRef = useRef(node);
  nodeRef.current = node;
  const api = useDeskDrag();

  const onResize = (index: number, e: ReactPointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const box = boxRef.current;
    if (!box) return;
    const start = node.sizes.slice();
    const startPos = node.dir === "row" ? e.clientX : e.clientY;
    const onMove = (ev: PointerEvent) => {
      const rect = box.getBoundingClientRect();
      const span = node.dir === "row" ? rect.width : rect.height;
      if (span < 8) return;
      const deltaPct = (((node.dir === "row" ? ev.clientX : ev.clientY) - startPos) / span) * 100;
      const next = start.slice();
      const a = Math.max(12, start[index] + deltaPct);
      const b = Math.max(12, start[index + 1] - deltaPct);
      const orig = start[index] + start[index + 1];
      next[index] = (a / (a + b)) * orig;
      next[index + 1] = (b / (a + b)) * orig;
      api?.resizeById(node.id, next);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.body.classList.remove("desk-dragging");
    };
    document.body.style.cursor = node.dir === "row" ? "col-resize" : "row-resize";
    document.body.style.userSelect = "none";
    document.body.classList.add("desk-dragging");
    window.getSelection()?.removeAllRanges();
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <div ref={boxRef} className={`desk-mod__split-box is-${node.dir}`}>
      {node.children.map((ch, i) => (
        <Fragment key={ch.id}>
          {i > 0 ? (
            <div
              className={`desk-mod__resizer is-${node.dir}`}
              role="separator"
              aria-orientation={node.dir === "row" ? "vertical" : "horizontal"}
              aria-label="Změnit velikost"
              onPointerDown={(ev) => onResize(i - 1, ev)}
            />
          ) : null}
          <div className="desk-mod__cell" style={{ flexGrow: node.sizes[i] ?? 1 }}>
            <DeskNodeView node={ch} onLayout={onLayout} renderPanel={renderPanel} />
          </div>
        </Fragment>
      ))}
    </div>
  );
}

export function bindToolDrag(
  panel: string,
  beginDrag: (panel: string, x: number, y: number) => void,
  onClick: () => void
) {
  return (e: ReactPointerEvent) => {
    e.preventDefault();
    window.getSelection()?.removeAllRanges();
    const prevSelect = document.body.style.userSelect;
    document.body.style.userSelect = "none";
    const sx = e.clientX;
    const sy = e.clientY;
    let started = false;
    const onMove = (ev: PointerEvent) => {
      if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 7) return;
      started = true;
      beginDrag(panel, ev.clientX, ev.clientY);
      window.removeEventListener("pointermove", onMove);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (!started) {
        document.body.style.userSelect = prevSelect;
        onClick();
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };
}
