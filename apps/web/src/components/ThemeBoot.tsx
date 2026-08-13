"use client";

import { useServerInsertedHTML } from "next/navigation";
import { THEME_STORAGE_KEY } from "@/lib/theme";

const THEME_BOOT = `(function(){try{var t=localStorage.getItem("${THEME_STORAGE_KEY}");if(t==="light"||t==="dark"){document.documentElement.setAttribute("data-theme",t);document.documentElement.style.colorScheme=t;}}catch(e){}})();`;

/** Injects theme before paint without a React-rendered <script> (Next 16 / React 19). */
export function ThemeBoot() {
  useServerInsertedHTML(() => (
    <script id="theme-boot" dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
  ));
  return null;
}
