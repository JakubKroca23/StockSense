"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { StockSenseLogo } from "@/components/StockSenseLogo";
import { SenseBot } from "@/components/SenseBot";
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
    const preventGesture = (e: Event) => {
      e.preventDefault();
    };
    const preventMultiTouch = (e: TouchEvent) => {
      if (e.touches.length > 1) e.preventDefault();
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
  const settingsActive = isActive(pathname, "/settings");
  const [menuOpen, setMenuOpen] = useState(false);
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
      <div className="app-shell min-h-screen pb-8">
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

            <nav className="app-nav app-nav--mobile-active app-no-drag justify-self-center" aria-label="Aktivní stránka">
              <span className="nav-link nav-link--active" aria-current="page">
                <NavLabel href={activeLink.href} label={activeLink.label} />
              </span>
            </nav>

            <div className="app-header__actions app-no-drag justify-self-end">
              <Link
                href="/settings"
                className={`settings-gear ${settingsActive ? "settings-gear--active" : ""}`}
                aria-label="Nastavení"
                aria-current={settingsActive ? "page" : undefined}
                title="Nastavení"
              >
                <IconSettings size={22} />
              </Link>
              <button
                type="button"
                className="nav-burger"
                aria-label={menuOpen ? "Zavřít menu" : "Otevřít menu"}
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((v) => !v)}
              >
                {menuOpen ? <IconClose size={22} /> : <IconMenu size={22} />}
              </button>
            </div>
          </div>
        </header>

        {menuOpen && (
          <div className="nav-drawer" role="dialog" aria-modal="true" aria-label="Menu">
            <button
              type="button"
              className="nav-drawer__backdrop"
              aria-label="Zavřít"
              onClick={() => setMenuOpen(false)}
            />
            <div className="nav-drawer__panel">
              <p className="nav-drawer__title">Menu</p>
              <nav className="nav-drawer__nav" aria-label="Mobilní navigace">
                {links.map((l) => {
                  const active = isActive(pathname, l.href);
                  return (
                    <Link
                      key={l.href}
                      href={l.href}
                      className={`nav-drawer__link ${active ? "is-active" : ""}`}
                      aria-current={active ? "page" : undefined}
                      onClick={() => setMenuOpen(false)}
                    >
                      <NavLabel href={l.href} label={l.label} />
                    </Link>
                  );
                })}
                <Link
                  href="/settings"
                  className={`nav-drawer__link ${settingsActive ? "is-active" : ""}`}
                  aria-current={settingsActive ? "page" : undefined}
                  onClick={() => setMenuOpen(false)}
                >
                  <span className="nav-item">
                    <IconSettings size={NAV_ICON_SIZE} />
                    <span className="nav-item__label">Nastavení</span>
                  </span>
                </Link>
              </nav>
            </div>
          </div>
        )}

        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
        <SenseBot />
      </div>
    </ScreenContextProvider>
  );
}
