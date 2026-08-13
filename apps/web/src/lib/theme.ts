"use client";

import { useEffect, useState } from "react";

export type ColorMode = "dark" | "light";

export const THEME_STORAGE_KEY = "stocksense-theme";
export const THEME_EVENT = "stocksense-theme";

export function getStoredTheme(): ColorMode {
  if (typeof window === "undefined") return "dark";
  try {
    return window.localStorage.getItem(THEME_STORAGE_KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export function applyTheme(mode: ColorMode) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.dataset.theme = mode;
  root.style.colorScheme = mode;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    /* ignore quota / private mode */
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", mode === "light" ? "#eef3f8" : "#0b1220");
  window.dispatchEvent(new Event(THEME_EVENT));
}

export function themeFromUnknown(value: unknown): ColorMode | null {
  return value === "light" || value === "dark" ? value : null;
}

export function useThemeRevision() {
  const [rev, setRev] = useState(0);
  useEffect(() => {
    const bump = () => setRev((n) => n + 1);
    window.addEventListener(THEME_EVENT, bump);
    return () => window.removeEventListener(THEME_EVENT, bump);
  }, []);
  return rev;
}
