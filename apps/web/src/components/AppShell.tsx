"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { StockSenseLogo } from "@/components/StockSenseLogo";
import { SettingsPanel } from "@/components/SettingsPanel";
import { HeaderExtraSlot } from "@/components/HeaderExtra";
import {
  IconAnalysis,
  IconClose,
  IconDesk,
  IconMenu,
  IconMoon,
  IconSettings,
  IconSun,
  RAIL_ICON_SIZE,
  NAV_ICON_SIZE,
  navIcons,
} from "@/components/NavIcons";
import { applyTheme, ColorMode, getStoredTheme } from "@/lib/theme";
import { LINEAR_DESKS, deskHref } from "@/lib/desks";

const homeLink = { href: "/", label: "Home" };
const visionLink = { href: "/trading", label: "Trading Vision" };
const deskLinks = LINEAR_DESKS.map((d) => ({ href: deskHref(d.id), label: d.navLabel }));
const stocksenseLinks = [homeLink, ...deskLinks];
const links = [homeLink, visionLink, ...deskLinks];

const RAIL_KEY = "stocksense-rail-collapsed";
const DESKTOP_MQ = "(min-width: 768px)";

function isActive(pathname: string, href: string) {
  return pathname === href || (href !== "/" && pathname.startsWith(href));
}

function NavLabel({
  href,
  label,
  size = NAV_ICON_SIZE,
}: {
  href: string;
  label: string;
  size?: number;
}) {
  const Icon = navIcons[href] ?? IconDesk;
  return (
    <span className="nav-item">
      <Icon size={size} />
      <span className="nav-item__label">{label}</span>
    </span>
  );
}

function useLockPageZoom() {
  useEffect(() => {
    const isChartTouch = (target: EventTarget | null) => {
      if (!(target instanceof Element)) return false;
      return Boolean(
        target.closest(".price-chart, .crypto-chart-stage, .gold-page__chart-pane")
      );
    };

    const preventGesture = (e: Event) => {
      if (isChartTouch(e.target)) return;
      e.preventDefault();
    };
    const preventMultiTouch = (e: TouchEvent) => {
      if (e.touches.length <= 1) return;
      if (isChartTouch(e.target)) return;
      for (let i = 0; i < e.touches.length; i++) {
        const node = document.elementFromPoint(e.touches[i].clientX, e.touches[i].clientY);
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
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [desktop, setDesktop] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [legacyMenuOpen, setLegacyMenuOpen] = useState(false);
  const [theme, setTheme] = useState<ColorMode>(() => getStoredTheme());
  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  useLockPageZoom();

  useEffect(() => {
    applyTheme(getStoredTheme());
    try {
      setRailCollapsed(window.localStorage.getItem(RAIL_KEY) === "1");
    } catch {
      /* ignore */
    }
    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
    const mq = window.matchMedia(DESKTOP_MQ);
    const sync = () => {
      setDesktop(mq.matches);
      if (mq.matches) setMenuOpen(false);
    };
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    setMenuOpen(false);
    setLegacyMenuOpen(false);
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

  function toggleNav() {
    setSettingsOpen(false);
    if (window.matchMedia(DESKTOP_MQ).matches) {
      setRailCollapsed((v) => {
        const next = !v;
        try {
          window.localStorage.setItem(RAIL_KEY, next ? "1" : "0");
        } catch {
          /* ignore */
        }
        return next;
      });
      return;
    }
    setMenuOpen((v) => !v);
  }

  const isTradingVision = pathname.startsWith("/trading");

  function toggleTheme() {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    applyTheme(next);
  }

  return (
    <div
      className={`app-shell min-h-screen pb-8 ${menuOpen ? "is-menu-open" : ""} ${
        railCollapsed ? "is-rail-collapsed" : ""
      } ${isTradingVision ? "is-trading-vision" : ""}`}
    >
      <header className="app-header sticky top-0 z-40">
        <div className="app-header__inner">
          <div className="app-header__brand app-no-drag">
            <button
              type="button"
              className={`header-menu-btn ${menuOpen ? "is-open" : ""}`}
              aria-label={
                desktop
                  ? railCollapsed
                    ? "Rozbalit menu"
                    : "Sbalit menu"
                  : menuOpen
                    ? "Zavřít menu"
                    : "Otevřít menu"
              }
              aria-expanded={desktop ? !railCollapsed : menuOpen}
              title="Menu"
              onClick={toggleNav}
            >
              {menuOpen ? <IconClose size={22} /> : <IconMenu size={22} />}
            </button>
            <Link
              href={pathname.startsWith("/trading") ? "/trading" : "/"}
              className="brand-logo shrink-0"
              aria-label={pathname.startsWith("/trading") ? "Trading Vision" : "StockSense"}
            >
              <StockSenseLogo
                height={36}
                variant={pathname.startsWith("/trading") ? "trading-vision" : "stocksense"}
              />
            </Link>
          </div>

          <HeaderExtraSlot />

          {!isTradingVision ? (
            <div className="app-header__actions app-no-drag">
              <button
                type="button"
                className="theme-toggle"
                aria-label={theme === "light" ? "Přepnout na tmavý režim" : "Přepnout na světlý režim"}
                title={theme === "light" ? "Tmavý režim" : "Světlý režim"}
                onClick={toggleTheme}
              >
                {theme === "light" ? <IconMoon size={22} /> : <IconSun size={22} />}
              </button>
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
          ) : null}
        </div>
      </header>

      <aside className="app-rail" aria-label="Hlavní navigace">
        <button
          type="button"
          className="app-rail__backdrop"
          aria-label="Zavřít"
          onClick={() => setMenuOpen(false)}
        />
        <div className="app-rail__panel">
          <div className="app-rail__head">
            <p className="app-rail__title">Menu</p>
            <button
              type="button"
              className="app-rail__close"
              aria-label="Zavřít menu"
              onClick={() => setMenuOpen(false)}
            >
              <IconClose size={18} />
            </button>
          </div>
          <nav className="app-rail__nav">
            {(isTradingVision ? [visionLink] : links).map((l) => {
              const active = isActive(pathname, l.href);
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  className={`app-rail__link ${active ? "is-active" : ""}`}
                  aria-current={active ? "page" : undefined}
                  title={l.label}
                  onClick={() => setMenuOpen(false)}
                >
                  <NavLabel href={l.href} label={l.label} size={RAIL_ICON_SIZE} />
                </Link>
              );
            })}
            {!isTradingVision ? (
              <button
                type="button"
                className={`app-rail__link app-rail__link--settings ${settingsOpen ? "is-active" : ""}`}
                title="Nastavení"
                onClick={() => {
                  setMenuOpen(false);
                  setSettingsOpen(true);
                }}
              >
                <span className="nav-item">
                  <IconSettings size={RAIL_ICON_SIZE} />
                  <span className="nav-item__label">Nastavení</span>
                </span>
              </button>
            ) : null}
          </nav>
          {isTradingVision ? (
            <div className="app-rail__foot">
              <div className={`app-rail__legacy ${legacyMenuOpen ? "is-open" : ""}`}>
                {legacyMenuOpen ? (
                  <div className="app-rail__legacy-list" role="menu">
                    {stocksenseLinks.map((l) => {
                      const active = isActive(pathname, l.href);
                      return (
                        <Link
                          key={l.href}
                          href={l.href}
                          className={`app-rail__link ${active ? "is-active" : ""}`}
                          role="menuitem"
                          aria-current={active ? "page" : undefined}
                          title={l.label}
                          onClick={() => {
                            setLegacyMenuOpen(false);
                            setMenuOpen(false);
                          }}
                        >
                          <NavLabel href={l.href} label={l.label} size={RAIL_ICON_SIZE} />
                        </Link>
                      );
                    })}
                  </div>
                ) : null}
                <button
                  type="button"
                  className={`app-rail__link ${legacyMenuOpen ? "is-active" : ""}`}
                  aria-label="Staré menu"
                  aria-expanded={legacyMenuOpen}
                  title="Staré menu"
                  onClick={() => setLegacyMenuOpen((v) => !v)}
                >
                  <span className="nav-item">
                    <IconAnalysis size={RAIL_ICON_SIZE} />
                    <span className="nav-item__label">Staré menu</span>
                  </span>
                </button>
              </div>
              <button
                type="button"
                className="app-rail__link"
                aria-label={theme === "light" ? "Přepnout na tmavý režim" : "Přepnout na světlý režim"}
                title={theme === "light" ? "Tmavý režim" : "Světlý režim"}
                onClick={toggleTheme}
              >
                <span className="nav-item">
                  {theme === "light" ? (
                    <IconMoon size={RAIL_ICON_SIZE} />
                  ) : (
                    <IconSun size={RAIL_ICON_SIZE} />
                  )}
                  <span className="nav-item__label">
                    {theme === "light" ? "Tmavý režim" : "Světlý režim"}
                  </span>
                </span>
              </button>
              <button
                type="button"
                className={`app-rail__link ${settingsOpen ? "is-active" : ""}`}
                aria-label="Nastavení"
                aria-expanded={settingsOpen}
                title="Nastavení"
                onClick={() => {
                  setMenuOpen(false);
                  setSettingsOpen((v) => !v);
                }}
              >
                <span className="nav-item">
                  <IconSettings size={RAIL_ICON_SIZE} />
                  <span className="nav-item__label">Nastavení</span>
                </span>
              </button>
            </div>
          ) : null}
        </div>
      </aside>

      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>

      <SettingsPanel open={settingsOpen} onClose={closeSettings} />
    </div>
  );
}
