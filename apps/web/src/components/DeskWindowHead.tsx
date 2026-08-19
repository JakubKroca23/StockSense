"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { IconClose, IconSettings } from "@/components/NavIcons";

export function DeskWindowHead({
  title,
  extra,
  settings,
  onClose,
  onDragStart,
}: {
  title: ReactNode;
  extra?: ReactNode;
  settings?: ReactNode;
  onClose?: () => void;
  onDragStart?: (e: ReactPointerEvent<HTMLElement>) => void;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0, maxH: 420 });

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onPtr = (e: PointerEvent) => {
      const t = e.target;
      if (!(t instanceof Node)) return;
      if (btnRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPtr);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPtr);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const width = Math.min(22 * 16, window.innerWidth - 16);
    const left = Math.min(Math.max(8, r.right - width), window.innerWidth - width - 8);
    const spaceBelow = window.innerHeight - r.bottom - 12;
    const spaceAbove = r.top - 12;
    const openDown = spaceBelow >= 220 || spaceBelow >= spaceAbove;
    const maxH = Math.min(28 * 16, Math.max(180, openDown ? spaceBelow : spaceAbove));
    const top = openDown ? r.bottom + 6 : Math.max(8, r.top - maxH - 6);
    setPos({ top, left, maxH });
  }, [open]);

  return (
    <header
      className={`desk-win__head${onDragStart ? " is-draggable" : ""}`}
      onPointerDown={(e) => {
        if (!onDragStart) return;
        if ((e.target as HTMLElement).closest("button")) return;
        if ((e.target as HTMLElement).closest(".desk-win__menu")) return;
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
        {settings ? (
          <button
            ref={btnRef}
            type="button"
            className={`desk-win__btn${open ? " is-active" : ""}`}
            onClick={() => setOpen((v) => !v)}
            aria-haspopup="dialog"
            aria-expanded={open}
            aria-label="Nastavení"
            title="Nastavení"
          >
            <IconSettings size={14} />
          </button>
        ) : null}
        <button
          type="button"
          className="desk-win__btn"
          onClick={onClose}
          aria-label="Zavřít"
          title="Zavřít"
        >
          <IconClose size={14} />
        </button>
      </div>
      {open && settings
        ? createPortal(
            <div
              ref={menuRef}
              className="desk-win__menu"
              role="dialog"
              aria-label="Nastavení panelu"
              style={{ top: pos.top, left: pos.left, maxHeight: pos.maxH }}
            >
              {settings}
            </div>,
            document.body
          )
        : null}
    </header>
  );
}
