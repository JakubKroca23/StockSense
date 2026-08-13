"use client";

import { useLayoutEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

const SLOT_ID = "app-header-extra";

export function HeaderExtraSlot() {
  return <div id={SLOT_ID} className="app-header__extra app-no-drag" />;
}

/** Renders `children` into the app titlebar. */
export function HeaderExtra({ children }: { children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    setSlot(document.getElementById(SLOT_ID));
  }, []);
  if (!slot) return null;
  return createPortal(children, slot);
}
