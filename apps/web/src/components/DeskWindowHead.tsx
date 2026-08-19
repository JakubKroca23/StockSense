"use client";

import {
  useEffect,
  useState,
  type CSSProperties,
  type ElementType,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { IconClose, IconSettings } from "@/components/NavIcons";
import { LinkGroupPick } from "@/components/LinkGroupPick";
import type { LinkGroup } from "@/lib/linkGroup";

const DOCK_KEY = "stocksense-desk-dock-w";
const DOCK_MIN = 240;
const DOCK_MAX = 560;
const DOCK_DEFAULT = 288;

function readDockW() {
  try {
    const n = Number(window.localStorage.getItem(DOCK_KEY));
    if (Number.isFinite(n) && n >= DOCK_MIN && n <= DOCK_MAX) return n;
  } catch {
    /* ignore */
  }
  return DOCK_DEFAULT;
}

function writeDockW(n: number) {
  try {
    window.localStorage.setItem(DOCK_KEY, String(n));
  } catch {
    /* ignore */
  }
}

type HeadProps = {
  title: ReactNode;
  extra?: ReactNode;
  settings?: ReactNode;
  settingsOpen?: boolean;
  onToggleSettings?: () => void;
  linkGroup?: LinkGroup | null;
  onLinkGroupChange?: (next: LinkGroup | null) => void;
  onClose?: () => void;
  onDragStart?: (e: ReactPointerEvent<HTMLElement>) => void;
};

export function DeskWindow({
  as: Tag = "div",
  className,
  children,
  ...head
}: HeadProps & {
  as?: ElementType;
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [dockW, setDockW] = useState(DOCK_DEFAULT);
  const [resizing, setResizing] = useState(false);
  const hasSettings = Boolean(head.settings);

  useEffect(() => {
    setDockW(readDockW());
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const onDockResize = (e: ReactPointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const win = e.currentTarget.closest(".desk-win");
    const startX = e.clientX;
    const startW = dockW;
    const max = win ? Math.min(DOCK_MAX, Math.max(DOCK_MIN + 40, win.clientWidth * 0.62)) : DOCK_MAX;
    setResizing(true);
    const onMove = (ev: PointerEvent) => {
      const next = Math.min(max, Math.max(DOCK_MIN, startW + (startX - ev.clientX)));
      setDockW(next);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setResizing(false);
      setDockW((w) => {
        writeDockW(w);
        return w;
      });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <Tag
      className={`desk-win${open && hasSettings ? " is-settings" : ""}${resizing ? " is-dock-resize" : ""}${className ? ` ${className}` : ""}`}
      style={
        open && hasSettings
          ? ({ ["--desk-dock"]: `${dockW}px` } as CSSProperties)
          : undefined
      }
    >
      <div className="desk-win__stage">
        <DeskWindowHead
          {...head}
          settingsOpen={open}
          onToggleSettings={() => setOpen((v) => !v)}
        />
        {children}
      </div>
      {hasSettings ? (
        <aside className="desk-win__dock" aria-label="Nastavení panelu" aria-hidden={!open}>
          {open ? (
            <button
              type="button"
              className="desk-win__dock-resize"
              aria-label="Šířka nastavení"
              title="Táhni pro šířku nastavení"
              onPointerDown={onDockResize}
            />
          ) : null}
          {head.settings}
        </aside>
      ) : null}
    </Tag>
  );
}

export function DeskWindowHead({
  title,
  extra,
  settings,
  settingsOpen = false,
  onToggleSettings,
  linkGroup = null,
  onLinkGroupChange,
  onClose,
  onDragStart,
}: HeadProps) {
  return (
    <header
      className={`desk-win__head${onDragStart ? " is-draggable" : ""}`}
      onPointerDown={(e) => {
        if (!onDragStart) return;
        if ((e.target as HTMLElement).closest("button")) return;
        if ((e.target as HTMLElement).closest(".desk-win__dock")) return;
        e.preventDefault();
        window.getSelection()?.removeAllRanges();
        const sx = e.clientX;
        const sy = e.clientY;
        const start = onDragStart;
        const onMove = (ev: PointerEvent) => {
          if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return;
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", onUp);
          start({
            ...e,
            clientX: ev.clientX,
            clientY: ev.clientY,
          } as typeof e);
        };
        const onUp = () => {
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", onUp);
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
      }}
    >
      {typeof title === "string" ? (
        <p className="desk-win__title">{title}</p>
      ) : (
        <div className="desk-win__title">{title}</div>
      )}
      {extra ? <div className="desk-win__extra">{extra}</div> : <div className="desk-win__extra" />}
      <div className="desk-win__actions">
        {onLinkGroupChange ? <LinkGroupPick value={linkGroup} onChange={onLinkGroupChange} /> : null}
        {settings && onToggleSettings ? (
          <button
            type="button"
            className={`desk-win__btn${settingsOpen ? " is-active" : ""}`}
            onClick={onToggleSettings}
            aria-expanded={settingsOpen}
            aria-label="Nastavení"
            title="Nastavení"
          >
            <IconSettings size={14} />
          </button>
        ) : null}
        {onClose ? (
          <button
            type="button"
            className="desk-win__btn"
            onClick={onClose}
            aria-label="Zavřít"
            title="Zavřít"
          >
            <IconClose size={14} />
          </button>
        ) : null}
      </div>
    </header>
  );
}
