"use client";

import { useEffect, useId, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import type { AssetClass } from "@/lib/types";

export type SymbolSuggestion = {
  symbol: string;
  name: string;
  asset_class: AssetClass | string;
  currency?: string;
  exchange?: string;
  source?: string;
};

type Props = {
  value: string;
  onChange: (symbol: string, suggestion?: SymbolSuggestion) => void;
  placeholder?: string;
  required?: boolean;
  className?: string;
  id?: string;
  /** Kde otevřít nápovědu — default nahoru (nad pole) */
  placement?: "top" | "bottom";
};

export function SymbolAutocomplete({
  value,
  onChange,
  placeholder = "Symbol (AAPL, BTC-USD…)",
  required,
  className = "input",
  id,
  placement = "top",
}: Props) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<SymbolSuggestion[]>([]);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const q = value.trim();
    if (q.length < 1) {
      setItems([]);
      setOpen(false);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await apiFetch<SymbolSuggestion[]>(
          `/instruments/search?q=${encodeURIComponent(q)}&limit=8`
        );
        if (!cancelled) {
          setItems(res);
          setOpen(res.length > 0);
          setActive(0);
        }
      } catch {
        if (!cancelled) {
          setItems([]);
          setOpen(false);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 220);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [value]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  function pick(item: SymbolSuggestion) {
    onChange(item.symbol, item);
    setOpen(false);
  }

  return (
    <div ref={rootRef} className="symbol-autocomplete relative">
      <input
        id={id}
        className={className}
        value={value}
        required={required}
        autoComplete="off"
        placeholder={placeholder}
        aria-autocomplete="list"
        aria-controls={listId}
        aria-expanded={open}
        onFocus={() => items.length > 0 && setOpen(true)}
        onChange={(e) => onChange(e.target.value.toUpperCase())}
        onKeyDown={(e) => {
          if (!open || items.length === 0) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((i) => (i + 1) % items.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => (i - 1 + items.length) % items.length);
          } else if (e.key === "Enter" && items[active]) {
            e.preventDefault();
            pick(items[active]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      {open && (
        <ul
          id={listId}
          role="listbox"
          className={`symbol-autocomplete__list absolute z-[80] max-h-64 w-full overflow-auto rounded-xl border border-[var(--line)] bg-[var(--bg-elevated)] shadow-lg ${
            placement === "top" ? "symbol-autocomplete__list--top" : "symbol-autocomplete__list--bottom"
          }`}
        >
          {items.map((item, idx) => (
            <li key={`${item.symbol}-${item.source || "x"}`}>
              <button
                type="button"
                role="option"
                aria-selected={idx === active}
                className={`flex w-full items-start justify-between gap-3 px-3 py-2 text-left text-sm ${
                  idx === active ? "bg-[var(--bg-soft)]" : "hover:bg-[var(--bg-soft)]"
                }`}
                onMouseEnter={() => setActive(idx)}
                onClick={() => pick(item)}
              >
                <span>
                  <span className="font-semibold">{item.symbol}</span>
                  <span className="muted block text-xs line-clamp-1">{item.name}</span>
                </span>
                <span className="badge shrink-0">
                  {item.currency ? `${item.currency} · ` : ""}
                  {item.asset_class}
                </span>
              </button>
            </li>
          ))}
          {loading && <li className="muted px-3 py-2 text-xs">Hledám…</li>}
        </ul>
      )}
    </div>
  );
}
