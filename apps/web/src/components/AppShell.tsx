"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { StockSenseLogo } from "@/components/StockSenseLogo";
import { SettingsPanel } from "@/components/SettingsPanel";
import { HeaderExtraSlot, HeaderQuoteSlot } from "@/components/HeaderExtra";
import { LayoutCreateModal } from "@/components/LayoutCreateModal";
import { SymbolPick } from "@/components/SymbolPick";
import { WorkspaceProvider, useWorkspace } from "@/components/WorkspaceProvider";
import {
  IconClose,
  IconHome,
  IconPlus,
  IconSettings,
  LAYOUT_ICONS,
  RAIL_ICON_SIZE,
} from "@/components/NavIcons";
import { applyTheme, ColorMode, getStoredTheme } from "@/lib/theme";
import { ChartVizProvider } from "@/lib/chartViz";
import { deskHref } from "@/lib/desks";
import type { LayoutIconId, WorkspaceLayout } from "@/lib/workspace";

const RAIL_KEY = "stocksense-rail-collapsed";
const DESKTOP_MQ = "(min-width: 768px)";

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
  return (
    <ChartVizProvider>
      <WorkspaceProvider>
        <AppShellInner>{children}</AppShellInner>
      </WorkspaceProvider>
    </ChartVizProvider>
  );
}

function AppShellInner({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { catalog, active, createLayout, updateLayout, deleteLayout } = useWorkspace();
  const [menuOpen, setMenuOpen] = useState(false);
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [desktop, setDesktop] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [theme, setTheme] = useState<ColorMode>("dark");
  const [modal, setModal] = useState<null | { mode: "create" } | { mode: "edit"; item: WorkspaceLayout }>(
    null
  );
  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  useLockPageZoom();

  useEffect(() => {
    const stored = getStoredTheme();
    setTheme(stored);
    applyTheme(stored);
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

  function setThemeMode(mode: ColorMode) {
    setTheme(mode);
    applyTheme(mode);
  }

  const homeActive = pathname === "/";

  return (
    <div
      className={`app-shell min-h-screen pb-8 ${menuOpen ? "is-menu-open" : ""} ${
        railCollapsed ? "is-rail-collapsed" : ""
      }${settingsOpen ? " is-settings-open" : ""}`}
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
              <StockSenseLogo height={28} />
            </button>
            {homeActive ? (
              <span className="header-symbol-stack">
                <span className="header-symbol">
                  <IconHome size={20} />
                  <span className="header-symbol__name">Home</span>
                </span>
              </span>
            ) : active ? (
              <span className="header-symbol-stack">
                <SymbolPick
                  symbolId={active.symbolId}
                  onSelect={(id) => updateLayout(active.id, { symbolId: id })}
                />
                <HeaderQuoteSlot />
              </span>
            ) : null}
          </div>

          <HeaderExtraSlot />
          <div className="app-header__actions app-no-drag">
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
              <IconSettings size={18} />
            </button>
          </div>
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
              aria-label="Zavřít"
              onClick={() => setMenuOpen(false)}
            >
              <IconClose size={18} />
            </button>
          </div>
          <nav className="app-rail__nav">
            <Link
              href="/"
              className={`app-rail__link ${homeActive ? "is-active" : ""}`}
              aria-current={homeActive ? "page" : undefined}
              title="Home"
              onClick={() => setMenuOpen(false)}
            >
              <span className="nav-item">
                <IconHome size={RAIL_ICON_SIZE} />
                <span className="nav-item__label">Home</span>
              </span>
            </Link>
            {catalog.items.map((item) => {
              const href = deskHref(item.id);
              const isOn = pathname === href || pathname.startsWith(`${href}/`);
              const Icon = LAYOUT_ICONS[item.icon] ?? LAYOUT_ICONS.desk;
              return (
                <Link
                  key={item.id}
                  href={href}
                  className={`app-rail__link ${isOn ? "is-active" : ""}`}
                  aria-current={isOn ? "page" : undefined}
                  title={`${item.name} — pravý klik pro úpravu`}
                  onClick={() => setMenuOpen(false)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setModal({ mode: "edit", item });
                  }}
                >
                  <span className="nav-item">
                    <Icon size={RAIL_ICON_SIZE} />
                    <span className="nav-item__label">{item.name}</span>
                  </span>
                </Link>
              );
            })}
            <button
              type="button"
              className="app-rail__link app-rail__add"
              title="Nový layout"
              onClick={() => {
                setMenuOpen(false);
                setModal({ mode: "create" });
              }}
            >
              <span className="nav-item">
                <IconPlus size={RAIL_ICON_SIZE} />
                <span className="nav-item__label">Nový layout</span>
              </span>
            </button>
          </nav>
        </div>
      </aside>

      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>

      <SettingsPanel
        open={settingsOpen}
        onClose={closeSettings}
        theme={theme}
        onThemeChange={setThemeMode}
      />

      <LayoutCreateModal
        open={modal !== null}
        title={modal?.mode === "edit" ? "Upravit layout" : "Nový layout"}
        confirmLabel={modal?.mode === "edit" ? "Uložit" : "Vytvořit"}
        initialName={modal?.mode === "edit" ? modal.item.name : ""}
        initialIcon={modal?.mode === "edit" ? modal.item.icon : "desk"}
        onClose={() => setModal(null)}
        onSubmit={(name, icon: LayoutIconId) => {
          if (modal?.mode === "edit") {
            updateLayout(modal.item.id, { name, icon });
            setModal(null);
            return;
          }
          createLayout(name, icon);
          setModal(null);
        }}
        onDelete={
          modal?.mode === "edit" && catalog.items.length > 1
            ? () => {
                if (!window.confirm(`Smazat layout „${modal.item.name}“?`)) return;
                deleteLayout(modal.item.id);
                setModal(null);
              }
            : undefined
        }
      />
    </div>
  );
}
