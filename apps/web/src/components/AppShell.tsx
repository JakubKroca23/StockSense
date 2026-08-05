"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";
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

function BurgerIcon({ open }: { open: boolean }) {
  return (
    <span className={`burger-icon ${open ? "burger-icon--open" : ""}`} aria-hidden>
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
  const [ready, setReady] = useState(false);
  const [name, setName] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPath, setMenuPath] = useState(pathname);

  // Close the sheet when the route changes (adjust state during render).
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
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
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
    <div className="app-shell min-h-screen pb-28 md:pb-8">
      <header className="app-header sticky top-0 z-40 border-b border-[var(--line)] bg-[color-mix(in_srgb,var(--bg)_85%,transparent)] backdrop-blur-md">
        <div className="app-header__inner mx-auto flex max-w-6xl items-center gap-3 px-4 py-2.5">
          <div className="flex min-w-0 flex-1 items-center gap-5">
            <Link href="/" className="brand-logo app-no-drag shrink-0" aria-label="StockSense">
              <StockSenseLogo height={36} />
            </Link>
            <nav className="app-no-drag hidden md:flex items-center gap-3 lg:gap-4">
              {links.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  className={`nav-link ${isActive(pathname, l.href) ? "nav-link--active" : ""}`}
                >
                  <NavLabel href={l.href} label={l.label} />
                </Link>
              ))}
            </nav>
          </div>
          <div className="app-no-drag flex shrink-0 items-center gap-3 text-sm">
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

      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>

      <div className="md:hidden">
        <button
          type="button"
          className={`fab-burger ${menuOpen ? "fab-burger--open" : ""}`}
          aria-label={menuOpen ? "Zavřít menu" : "Otevřít menu"}
          aria-expanded={menuOpen}
          aria-controls={menuId}
          onClick={() => setMenuOpen((v) => !v)}
        >
          <BurgerIcon open={menuOpen} />
        </button>

        <div
          className={`nav-sheet-backdrop ${menuOpen ? "nav-sheet-backdrop--open" : ""}`}
          onClick={() => setMenuOpen(false)}
          aria-hidden={!menuOpen}
        />

        <nav
          id={menuId}
          className={`nav-sheet ${menuOpen ? "nav-sheet--open" : ""}`}
          aria-hidden={!menuOpen}
          aria-label="Hlavní menu"
        >
          <div className="nav-sheet__handle" aria-hidden />
          <p className="nav-sheet__title">Menu</p>
          <div className="nav-sheet__grid">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className={`nav-sheet__link ${isActive(pathname, l.href) ? "nav-sheet__link--active" : ""}`}
                onClick={() => setMenuOpen(false)}
              >
                <NavLabel href={l.href} label={l.label} compact />
              </Link>
            ))}
          </div>
        </nav>
      </div>
    </div>
  );
}
