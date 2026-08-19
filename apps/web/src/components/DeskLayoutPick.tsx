"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { IconSave } from "@/components/NavIcons";
import type { DeskSavedLayout } from "@/lib/deskLayouts";

export function DeskLayoutPick({
  name,
  items,
  activeId,
  dirty,
  onSave,
  onSelect,
  onNew,
  onRename,
  onDelete,
}: {
  name: string;
  items: DeskSavedLayout[];
  activeId: string;
  dirty: boolean;
  onSave: () => void;
  onSelect: (id: string) => void;
  onNew: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(name);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  useEffect(() => {
    if (!renaming) setDraft(name);
  }, [name, renaming]);

  useEffect(() => {
    if (!renaming) return;
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, [renaming]);

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
    const left = Math.min(r.left, Math.max(8, window.innerWidth - 240));
    setPos({ top: r.bottom + 6, left: Math.max(8, left) });
  }, [open]);

  const commitRename = () => {
    const next = draft.trim();
    setRenaming(false);
    if (next && next !== name) onRename(next);
    else setDraft(name);
  };

  return (
    <div className="desk-layout" role="group" aria-label="Layout">
      {renaming ? (
        <input
          ref={inputRef}
          className="desk-layout__input"
          value={draft}
          maxLength={40}
          aria-label="Název layoutu"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitRename();
            }
            if (e.key === "Escape") {
              setDraft(name);
              setRenaming(false);
            }
          }}
        />
      ) : (
        <button
          ref={btnRef}
          type="button"
          className={`desk-layout__name${open ? " is-open" : ""}`}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={`Layout ${name}`}
          title={name}
          onClick={() => setOpen((v) => !v)}
        >
          <span className="desk-layout__label">{name}</span>
          <svg className="desk-layout__caret" width="10" height="10" viewBox="0 0 12 12" aria-hidden>
            <path d="M2.4 4.2 6 8l3.6-3.8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
      <button
        type="button"
        className={`chart-chip chart-chip--soft chart-chip--icon desk-layout__save${dirty ? " is-dirty" : ""}`}
        disabled={!dirty}
        onClick={onSave}
        aria-label={dirty ? "Uložit layout" : "Layout je uložený"}
        title={dirty ? "Uložit layout" : "Layout je uložený"}
      >
        <IconSave size={18} />
      </button>
      {open &&
        createPortal(
          <div ref={menuRef} className="tf-menu desk-layout__menu" role="menu" style={{ top: pos.top, left: pos.left }}>
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                className={`tf-menu__item ${item.id === activeId ? "is-active" : ""}`}
                onClick={() => {
                  setOpen(false);
                  if (item.id !== activeId) onSelect(item.id);
                }}
              >
                {item.name}
              </button>
            ))}
            <div className="tf-menu__sep" />
            <button
              type="button"
              role="menuitem"
              className="tf-menu__item"
              onClick={() => {
                setOpen(false);
                onNew();
              }}
            >
              Nový layout
            </button>
            <button
              type="button"
              role="menuitem"
              className="tf-menu__item"
              onClick={() => {
                setOpen(false);
                setDraft(name);
                setRenaming(true);
              }}
            >
              Přejmenovat
            </button>
            <button
              type="button"
              role="menuitem"
              className="tf-menu__item tf-menu__item--danger"
              disabled={items.length < 2}
              onClick={() => {
                setOpen(false);
                onDelete();
              }}
            >
              Smazat
            </button>
          </div>,
          document.body
        )}
    </div>
  );
}
