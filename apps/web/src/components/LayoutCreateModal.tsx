"use client";

import { useEffect, useRef, useState } from "react";
import { LAYOUT_ICONS } from "@/components/NavIcons";
import { LAYOUT_ICON_IDS, type LayoutIconId } from "@/lib/workspace";

export function LayoutCreateModal({
  open,
  title = "Nový layout",
  confirmLabel = "Vytvořit",
  initialName = "",
  initialIcon = "desk",
  onClose,
  onSubmit,
  onDelete,
}: {
  open: boolean;
  title?: string;
  confirmLabel?: string;
  initialName?: string;
  initialIcon?: LayoutIconId;
  onClose: () => void;
  onSubmit: (name: string, icon: LayoutIconId) => void;
  onDelete?: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [icon, setIcon] = useState<LayoutIconId>(initialIcon);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setName(initialName);
    setIcon(initialIcon);
    const id = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => window.clearTimeout(id);
  }, [open, initialName, initialIcon]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const submit = () => {
    const next = name.trim();
    if (!next) {
      inputRef.current?.focus();
      return;
    }
    onSubmit(next, icon);
  };

  return (
    <>
      <button type="button" className="settings-modal__backdrop" aria-label="Zavřít" onClick={onClose} />
      <div className="settings-modal layout-modal" role="dialog" aria-modal="true" aria-labelledby="layout-modal-title">
        <header className="settings-drawer__head">
          <h2 id="layout-modal-title">{title}</h2>
          <button type="button" className="settings-drawer__close" onClick={onClose} aria-label="Zavřít">
            ×
          </button>
        </header>
        <div className="layout-modal__body">
          <label className="layout-modal__field">
            <span>Název</span>
            <input
              ref={inputRef}
              value={name}
              maxLength={32}
              placeholder="např. Scalping"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submit();
                }
              }}
            />
          </label>
          <div className="layout-modal__field">
            <span>Ikona</span>
            <div className="layout-modal__icons" role="listbox" aria-label="Ikona layoutu">
              {LAYOUT_ICON_IDS.map((id) => {
                const Glyph = LAYOUT_ICONS[id];
                return (
                  <button
                    key={id}
                    type="button"
                    role="option"
                    aria-selected={icon === id}
                    className={`layout-modal__icon${icon === id ? " is-active" : ""}`}
                    onClick={() => setIcon(id)}
                  >
                    <Glyph size={22} />
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        <footer className="layout-modal__foot">
          {onDelete ? (
            <button
              type="button"
              className="layout-modal__btn layout-modal__btn--danger"
              onClick={onDelete}
            >
              Smazat
            </button>
          ) : (
            <span />
          )}
          <div className="layout-modal__foot-end">
            <button type="button" className="layout-modal__btn" onClick={onClose}>
              Zrušit
            </button>
            <button type="button" className="layout-modal__btn layout-modal__btn--primary" onClick={submit}>
              {confirmLabel}
            </button>
          </div>
        </footer>
      </div>
    </>
  );
}
