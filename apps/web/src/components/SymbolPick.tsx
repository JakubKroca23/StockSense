"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { navIcons, IconDesk } from "@/components/NavIcons";
import { LINEAR_DESKS, deskHref } from "@/lib/desks";

export function SymbolPick({
  symbolId,
  onSelect,
}: {
  symbolId: string;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const current = LINEAR_DESKS.find((d) => d.id === symbolId) ?? LINEAR_DESKS[0];
  const Icon = navIcons[deskHref(current.id)] ?? IconDesk;

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
    setPos({ top: r.bottom + 6, left: Math.max(8, r.left) });
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`header-symbol${open ? " is-open" : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Vybrat symbol"
        title="Vybrat symbol"
        onClick={() => setOpen((v) => !v)}
      >
        <Icon size={20} />
        <span className="header-symbol__name">{current.navLabel}</span>
        <svg className="header-symbol__caret" width="10" height="10" viewBox="0 0 12 12" aria-hidden>
          <path
            d="M2.4 4.2 6 8l3.6-3.8"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {open &&
        createPortal(
          <div ref={menuRef} className="tf-menu symbol-pick__menu" role="menu" style={{ top: pos.top, left: pos.left }}>
            {LINEAR_DESKS.map((desk) => {
              const Glyph = navIcons[deskHref(desk.id)] ?? IconDesk;
              return (
                <button
                  key={desk.id}
                  type="button"
                  role="menuitem"
                  className={`tf-menu__item symbol-pick__item ${desk.id === current.id ? "is-active" : ""}`}
                  onClick={() => {
                    onSelect(desk.id);
                    setOpen(false);
                  }}
                >
                  <Glyph size={18} />
                  <span>{desk.navLabel}</span>
                </button>
              );
            })}
          </div>,
          document.body
        )}
    </>
  );
}
