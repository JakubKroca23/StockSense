"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { account, getCurrentUser } from "@/lib/appwrite";

const links = [
  { href: "/", label: "Home" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/watchlist", label: "Watchlist" },
  { href: "/chat", label: "Chat" },
  { href: "/reports", label: "Reporty" },
  { href: "/alerts", label: "Alerty" },
  { href: "/settings", label: "Nastavení" },
];

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
    <div className="min-h-screen pb-24 md:pb-8">
      <header className="sticky top-0 z-40 border-b border-[var(--line)] bg-[color-mix(in_srgb,var(--bg)_85%,transparent)] backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <Link href="/" className="display text-xl tracking-tight">
            Stock<span className="text-[var(--accent)]">Sense</span>
          </Link>
          <nav className="hidden md:flex items-center gap-1">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className={`rounded-lg px-3 py-2 text-sm ${
                  pathname === l.href || (l.href !== "/" && pathname.startsWith(l.href))
                    ? "bg-[var(--bg-soft)] text-[var(--accent)]"
                    : "muted hover:text-[var(--text)]"
                }`}
              >
                {l.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-3 text-sm">
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
        <div className="grid grid-cols-7 gap-0.5 px-0.5 py-2 text-[10px]">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`rounded-lg px-0.5 py-2 text-center leading-tight ${
                pathname === l.href || (l.href !== "/" && pathname.startsWith(l.href))
                  ? "text-[var(--accent)]"
                  : "muted"
              }`}
            >
              {l.label}
            </Link>
          ))}
        </div>
      </nav>
    </div>
  );
}
