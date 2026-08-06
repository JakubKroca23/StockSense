"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { StockSenseLogo } from "@/components/StockSenseLogo";
import { SenseBot } from "@/components/SenseBot";
import { SettingsPanel } from "@/components/SettingsPanel";
import { ScreenContextProvider } from "@/components/ScreenContext";
import {
  IconClose,
  IconMenu,
  IconSettings,
  NAV_ICON_SIZE,
  navIcons,
} from "@/components/NavIcons";

const links = [
  { href: "/", label: "Home" },
  { href: "/cryptosense", label: "CryptoSense" },
] as const;

function isActive(pathname: string, href: string) {
  return pathname === href || (href !== "/" && pathname.startsWith(href));
}

function NavLabel({
  href,
  label,
}: {
  href: (typeof links)[number]["href"];
  label: string;
}) {
  const Icon = navIcons[href];
  return (
    <span className="nav-item">
      <Icon size={NAV_ICON_SIZE} />
      <span className="nav-item__label">{label}</span>
    </span>
  );
}

function useLockPageZoom() {
  useEffect(() => {
    const isChartTouch = (target: EventTarget | null) => {
      if (!(target instanceof Element)) return false;
      return Boolean(target.closest(".price-chart, .crypto-chart-stage"));
    };

    const preventGesture = (e: Event) => {
      if (isChartTouch(e.target)) return;
      e.preventDefault();
    };
    const preventMultiTouch = (e: TouchEvent) => {
      if (e.touches.length <= 1) return;
      if (isChartTouch(e.target)) return;
      for (let i = 0; i < e.touches.length; i++) {
        const node = document.elementFromPoint(
          e.touches[i].clientX,
          e.touches[i].clientY
        );
        if (isChartTouch(node)) return;
      }
      e.preventDefault();
    };

    document.addEventListener("gesturestart", preventGesture, { passive: false });
    document.addEventListener("gesturechange", preventGesture, { passive: false });
    document.addEventListener("gestureend", preventGesture, { passive: false });
    document.addEventListener("touchmove", preventMultiTouch, { passive: false });

    return () => {
      document.removeEventListener("gesturestart", preventGesture);
      document.removeEventListener("gesturechange", preventGesture);
      document.removeEventListener("gestureend", preventGesture);
      document.removeEventListener("touchmove", preventMultiTouch);
    };
  }, []);
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  useLockPageZoom();

  const activeLink = links.find((l) => isActive(pathname, l.href)) || links[0];

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [menuOpen]);

  return (
    <ScreenContextProvider>
      <div className={`app-shell min-h-screen pb-8 ${menuOpen ? "is-menu-open" : ""}`}>
        <header className="app-header sticky top-0 z-40">
          <div className="app-header__inner mx-auto grid max-w-6xl items-center gap-2 px-4 py-2">
            <Link href="/" className="brand-logo app-no-drag shrink-0 justify-self-start" aria-label="StockSense">
              <StockSenseLogo height={36} />
            </Link>

            <nav className="app-nav app-nav--desktop app-no-drag justify-self-center" aria-label="Hlavní navigace">
              {links.map((l) => {
                const active = isActive(pathname, l.href);
                return (
                  <Link
                    key={l.href}
                    href={l.href}
                    className={`nav-link ${active ? "nav-link--active" : ""}`}
                    aria-current={active ? "page" : undefined}
                  >
                    <NavLabel href={l.href} label={l.label} />
                  </Link>
                );
              })}
            </nav>

            <p className="app-page-title app-no-drag" aria-current="page">
              <NavLabel href={activeLink.href} label={activeLink.label} />
            </p>

            <div className="app-header__actions app-no-drag justify-self-end">
              <button
                type="button"
                className={`settings-gear ${settingsOpen ? "settings-gear--active" : ""}`}
                aria-label="Nastavení"
                aria-expanded={settingsOpen}
                title="Nastavení"
                onClick={() => {
                  setMenuOpen(false);
                  setSettingsOpen((v) => !v);
                }}
              >
                <IconSettings size={22} />
              </button>
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>

        <div className="mobile-nav-fab">
          <button
            type="button"
            className={`mobile-nav-fab__btn ${menuOpen ? "is-open" : ""}`}
            aria-label={menuOpen ? "Zavřít menu" : "Otevřít menu"}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
          >
            {menuOpen ? <IconClose size={22} /> : <IconMenu size={22} />}
            <span className="mobile-nav-fab__label">{menuOpen ? "Zavřít" : "Menu"}</span>
          </button>
        </div>

        {menuOpen && (
          <div className="nav-sheet" role="dialog" aria-modal="true" aria-label="Menu">
            <button
              type="button"
              className="nav-sheet__backdrop"
              aria-label="Zavřít"
              onClick={() => setMenuOpen(false)}
            />
            <div className="nav-sheet__panel">
              <div className="nav-sheet__handle" aria-hidden />
              <p className="nav-sheet__title">Menu</p>
              <nav className="nav-sheet__nav" aria-label="Mobilní navigace">
                {links.map((l) => {
                  const active = isActive(pathname, l.href);
                  return (
                    <Link
                      key={l.href}
                      href={l.href}
                      className={`nav-sheet__link ${active ? "is-active" : ""}`}
                      aria-current={active ? "page" : undefined}
                      onClick={() => setMenuOpen(false)}
                    >
                      <NavLabel href={l.href} label={l.label} />
                    </Link>
                  );
                })}
                <button
                  type="button"
                  className={`nav-sheet__link ${settingsOpen ? "is-active" : ""}`}
                  onClick={() => {
                    setMenuOpen(false);
                    setSettingsOpen(true);
                  }}
                >
                  <span className="nav-item">
                    <IconSettings size={NAV_ICON_SIZE} />
                    <span className="nav-item__label">Nastavení</span>
                  </span>
                </button>
              </nav>
            </div>
          </div>
        )}

        <SenseBot />
        <SettingsPanel open={settingsOpen} onClose={closeSettings} />
      </div>
    </ScreenContextProvider>
  );
}
