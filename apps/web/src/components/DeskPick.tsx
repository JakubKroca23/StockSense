"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/** Compact dropdown used in desk window headers (chart type, timeframe, lookback). */
export function DeskPick({
  label,
  ariaLabel,
  value,
  options,
  onSelect,
  className,
}: {
  label: string;
  ariaLabel: string;
  value: string;
  options: { id: string; label: string }[];
  onSelect: (id: string) => void;
  className?: string;
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
    const left = Math.min(r.left, Math.max(8, window.innerWidth - 148));
    setPos({ top: r.bottom + 6, left: Math.max(8, left) });
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`${className ?? "chart-chip header-desk__tf-btn"}${open ? " is-active" : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((v) => !v)}
      >
        {label}
      </button>
      {open &&
        createPortal(
          <div ref={menuRef} className="tf-menu" role="menu" style={{ top: pos.top, left: pos.left }}>
            {options.map((opt) => (
              <button
                key={opt.id}
                type="button"
                role="menuitem"
                className={`tf-menu__item ${value === opt.id ? "is-active" : ""}`}
                onClick={() => {
                  onSelect(opt.id);
                  setOpen(false);
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>,
          document.body
        )}
    </>
  );
}
