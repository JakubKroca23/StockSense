"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** Header tool (VP / DOM): open a settings flyout, keep the button lit while the tool is on. */
export function ChartToolPick({
  label,
  ariaLabel,
  title,
  active,
  children,
}: {
  label: string;
  ariaLabel: string;
  title?: string;
  active: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

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
    const width = 280;
    const left = Math.min(r.left, Math.max(8, window.innerWidth - width - 8));
    setPos({ top: r.bottom + 6, left: Math.max(8, left) });
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`desk-win__pick${active || open ? " is-active" : ""}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-pressed={active}
        aria-label={ariaLabel}
        title={title}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => setOpen((v) => !v)}
      >
        {label}
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            className="tf-menu desk-win__tool-menu"
            role="dialog"
            aria-label={ariaLabel}
            style={{ top: pos.top, left: pos.left }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            {children}
          </div>,
          document.body
        )}
    </>
  );
}
