"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { account, getCurrentUser } from "@/lib/appwrite";
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
  const size = compact ? 18 : NAV_ICON_SIZE;
  return (
    <span className={`nav-item ${compact ? "nav-item--compact" : ""}`}>
      <Icon size={size} />
      <span className="nav-item__label">{label}</span>
    </span>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [name, setName] = useState<string | null>(null);

  useEffect(() => {
    if (pathname === "/login") {
      setReady(true);
      return;
    }
    getCurrentUser().then((user) => {
      if (!user) {
        router.replace("/login");
        return;
      }
      setName(user.name || user.email || "Ty");
      setReady(true);
    });
  }, [pathname, router]);

  if (pathname === "/login") return <>{children}</>;
  if (!ready) {
    return (
      <div className="min-h-screen grid place-items-center muted">
        Načítám StockSense…
      </div>
    );
  }

  return (
    <div className="app-shell min-h-screen pb-24 md:pb-8">
      <header className="app-header sticky top-0 z-40 border-b border-[var(--line)] bg-[color-mix(in_srgb,var(--bg)_85%,transparent)] backdrop-blur-md">
        <div className="app-header__inner mx-auto flex max-w-6xl items-center gap-3 px-4 py-2.5">
          <div className="flex min-w-0 flex-1 items-center gap-5">
            <Link href="/" className="brand-logo app-no-drag shrink-0" aria-label="StockSense">
              <StockSenseLogo height={36} />
            </Link>
            <nav className="app-no-drag hidden md:flex items-center gap-0.5">
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
              onClick={async () => {
                await account.deleteSession({ sessionId: "current" });
                router.replace("/login");
              }}
            >
              Odhlásit
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--line)] bg-[color-mix(in_srgb,var(--bg)_92%,transparent)] backdrop-blur-md md:hidden">
        <div className="grid grid-cols-7 gap-0.5 px-0.5 pt-1.5 pb-2 text-[10px]">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`nav-link nav-link--mobile ${isActive(pathname, l.href) ? "nav-link--active" : ""}`}
            >
              <NavLabel href={l.href} label={l.label} compact />
            </Link>
          ))}
        </div>
      </nav>
    </div>
  );
}
