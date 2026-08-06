"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { getCurrentUser } from "@/lib/auth";
import { StockSenseLogo } from "@/components/StockSenseLogo";
import { IconSettings, NAV_ICON_SIZE, navIcons } from "@/components/NavIcons";

const links = [
  { href: "/", label: "Home" },
  { href: "/tips", label: "Tipy" },
  { href: "/chat", label: "Analýza" },
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

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [name, setName] = useState<string | null>(null);
  const settingsActive = isActive(pathname, "/settings");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const user = await getCurrentUser();
      if (cancelled) return;
      setName(user.name || user.email || "Ty");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="app-shell min-h-screen pb-8">
      <header className="app-header sticky top-0 z-40">
        <div className="app-header__inner mx-auto flex max-w-6xl items-center gap-2 px-4 py-2 sm:gap-3">
          <Link href="/" className="brand-logo app-no-drag shrink-0" aria-label="StockSense">
            <StockSenseLogo height={36} />
          </Link>

          <nav className="app-nav app-no-drag" aria-label="Hlavní navigace">
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

          <div
            className={`user-pill app-no-drag ml-auto ${settingsActive ? "user-pill--active" : ""}`}
          >
            <span className="user-pill__name">{name || "…"}</span>
            <Link
              href="/settings"
              className="user-pill__settings"
              aria-label="Nastavení"
              aria-current={settingsActive ? "page" : undefined}
              title="Nastavení"
            >
              <IconSettings size={16} />
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
