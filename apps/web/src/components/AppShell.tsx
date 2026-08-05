"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import {
  clearAuthTokens,
  ensureApiAuth,
  getCurrentUser,
} from "@/lib/auth";
import { StockSenseLogo } from "@/components/StockSenseLogo";
import { NAV_ICON_SIZE, navIcons } from "@/components/NavIcons";

const links = [
  { href: "/", label: "Home" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/watchlist", label: "Watchlist" },
  { href: "/chat", label: "Analýza" },
  { href: "/reports", label: "Reporty" },
  { href: "/alerts", label: "Alerty" },
  { href: "/settings", label: "Nastavení" },
] as const;

function isActive(pathname: string, href: string) {
  return pathname === href || (href !== "/" && pathname.startsWith(href));
}

function NavLabel({
  href,
  label,
  compact,
}: {
  href: (typeof links)[number]["href"];
  label: string;
  compact?: boolean;
}) {
  const Icon = navIcons[href];
  const size = compact ? 22 : NAV_ICON_SIZE;
  return (
    <span className={`nav-item ${compact ? "nav-item--compact" : ""}`}>
      <Icon size={size} />
      <span className="nav-item__label">{label}</span>
    </span>
  );
}

function MenuGlyph({ open }: { open: boolean }) {
  return (
    <span className={`menu-glyph ${open ? "menu-glyph--open" : ""}`} aria-hidden>
      <span />
      <span />
      <span />
    </span>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const menuId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [name, setName] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPath, setMenuPath] = useState(pathname);

  const activeLink = links.find((l) => isActive(pathname, l.href)) ?? links[0];

  // Close the panel when the route changes (adjust state during render).
  if (menuPath !== pathname) {
    setMenuPath(pathname);
    if (menuOpen) setMenuOpen(false);
  }

  useEffect(() => {
    if (pathname === "/login") return;
    let cancelled = false;
    (async () => {
      const ok = await ensureApiAuth();
      if (cancelled) return;
      if (!ok) {
        router.replace("/login");
        return;
      }
      const user = await getCurrentUser();
      if (cancelled) return;
      if (!user) {
        clearAuthTokens();
        router.replace("/login");
        return;
      }
      setName(user.name || user.email || "Ty");
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [pathname, router]);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    const onPointer = (e: MouseEvent | TouchEvent) => {
      const t = e.target as Node | null;
      if (panelRef.current && t && !panelRef.current.contains(t)) {
        setMenuOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onPointer);
    };
  }, [menuOpen]);

  if (pathname === "/login") return <>{children}</>;
  if (!ready) {
    return (
      <div className="min-h-screen grid place-items-center muted">
        Načítám StockSense…
      </div>
    );
  }

  return (
    <div className="app-shell min-h-screen pb-8">
      <header className="app-header sticky top-0 z-40">
        <div className="app-header__inner mx-auto flex max-w-6xl items-center gap-2.5 px-4 py-2">
          <div className="flex min-w-0 flex-1 items-center gap-2.5 sm:gap-3">
            <Link href="/" className="brand-logo app-no-drag shrink-0" aria-label="StockSense">
              <StockSenseLogo height={28} />
            </Link>

            <div className="app-no-drag nav-roll" ref={panelRef}>
              <div className={`nav-roll__sheet ${menuOpen ? "is-open" : ""}`}>
                <div
                  id={menuId}
                  className="nav-roll__panel"
                  aria-hidden={!menuOpen}
                >
                  <div className="nav-roll__list">
                    {links.map((l) => (
                      <Link
                        key={l.href}
                        href={l.href}
                        className={`nav-roll__link ${isActive(pathname, l.href) ? "is-active" : ""}`}
                        tabIndex={menuOpen ? 0 : -1}
                        onClick={() => setMenuOpen(false)}
                      >
                        <NavLabel href={l.href} label={l.label} />
                      </Link>
                    ))}
                  </div>
                </div>
                <button
                  type="button"
                  className={`nav-toggle ${menuOpen ? "is-open" : ""}`}
                  aria-label={menuOpen ? "Zavřít menu" : "Otevřít menu"}
                  aria-expanded={menuOpen}
                  aria-controls={menuId}
                  onClick={() => setMenuOpen((v) => !v)}
                >
                  <MenuGlyph open={menuOpen} />
                </button>
              </div>
            </div>

            <Link
              href={activeLink.href}
              className="nav-link nav-link--active nav-link--current app-no-drag"
              aria-current="page"
            >
              <NavLabel href={activeLink.href} label={activeLink.label} />
            </Link>
          </div>

          <div className="app-no-drag flex shrink-0 items-center gap-2 sm:gap-3 text-sm">
            <span className="muted hidden sm:inline">{name}</span>
            <button
              className="btn"
              onClick={() => {
                clearAuthTokens();
                router.replace("/login");
              }}
            >
              Odhlásit
            </button>
          </div>
        </div>
      </header>

      <button
        type="button"
        className={`nav-flyout-scrim ${menuOpen ? "nav-flyout-scrim--open" : ""}`}
        aria-label="Zavřít menu"
        aria-hidden={!menuOpen}
        tabIndex={menuOpen ? 0 : -1}
        onClick={() => setMenuOpen(false)}
      />

      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
