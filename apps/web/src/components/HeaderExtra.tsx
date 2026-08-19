"use client";

import { useLayoutEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

const SLOT_ID = "app-header-extra";
const QUOTE_SLOT_ID = "app-header-quote";

function useHeaderSlot(id: string) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    setSlot(document.getElementById(id));
  }, [id]);
  return slot;
}

export function HeaderExtraSlot() {
  return <div id={SLOT_ID} className="app-header__extra app-no-drag" />;
}

export function HeaderQuoteSlot() {
  return <div id={QUOTE_SLOT_ID} className="header-quote-slot app-no-drag" />;
}

/** Renders `children` into the app titlebar. */
export function HeaderExtra({ children }: { children: ReactNode }) {
  const slot = useHeaderSlot(SLOT_ID);
  if (!slot) return null;
  return createPortal(children, slot);
}

/** Renders quote under the page name in the titlebar. */
export function HeaderQuote({ children }: { children: ReactNode }) {
  const slot = useHeaderSlot(QUOTE_SLOT_ID);
  if (!slot) return null;
  return createPortal(children, slot);
}
