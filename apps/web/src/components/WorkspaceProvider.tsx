"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { deskHref } from "@/lib/desks";
import {
  createWorkspaceLayout,
  EMPTY_CATALOG,
  ensureWorkspace,
  loadWorkspace,
  saveWorkspace,
  WORKSPACE_EVENT,
  type LayoutIconId,
  type WorkspaceCatalog,
  type WorkspaceLayout,
} from "@/lib/workspace";
import type { DeskLayoutSnapshot } from "@/lib/deskLayouts";

type WorkspaceApi = {
  catalog: WorkspaceCatalog;
  active: WorkspaceLayout | null;
  createLayout: (name: string, icon: LayoutIconId) => WorkspaceLayout;
  updateLayout: (id: string, patch: Partial<Pick<WorkspaceLayout, "name" | "icon" | "symbolId">>) => void;
  deleteLayout: (id: string) => void;
  saveSnapshot: (id: string, snapshot: DeskLayoutSnapshot) => void;
};

const WorkspaceCtx = createContext<WorkspaceApi | null>(null);

function subscribe(cb: () => void) {
  window.addEventListener(WORKSPACE_EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(WORKSPACE_EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

function getSnapshot() {
  return loadWorkspace();
}

function getServerSnapshot() {
  return EMPTY_CATALOG;
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const catalog = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  useEffect(() => {
    ensureWorkspace();
  }, []);
  const pathname = usePathname();
  const router = useRouter();

  const routeId = pathname.startsWith("/desk/") ? pathname.slice("/desk/".length).split("/")[0] : "";
  const active = catalog.items.find((item) => item.id === routeId) ?? null;

  const persist = useCallback((next: WorkspaceCatalog) => {
    saveWorkspace(next);
  }, []);

  const createLayout = useCallback(
    (name: string, icon: LayoutIconId) => {
      const symbolId = active?.symbolId ?? catalog.items[0]?.symbolId ?? "btc";
      const item = createWorkspaceLayout(name, icon, symbolId);
      persist({ activeId: item.id, items: [...catalog.items, item] });
      router.push(deskHref(item.id));
      return item;
    },
    [active?.symbolId, catalog.items, persist, router]
  );

  const updateLayout = useCallback(
    (id: string, patch: Partial<Pick<WorkspaceLayout, "name" | "icon" | "symbolId">>) => {
      persist({
        ...catalog,
        items: catalog.items.map((item) => (item.id === id ? { ...item, ...patch } : item)),
      });
    },
    [catalog, persist]
  );

  const deleteLayout = useCallback(
    (id: string) => {
      if (catalog.items.length < 2) return;
      const items = catalog.items.filter((item) => item.id !== id);
      const nextActive = catalog.activeId === id ? items[0].id : catalog.activeId;
      persist({ activeId: nextActive, items });
      if (routeId === id) router.push(deskHref(nextActive));
    },
    [catalog, persist, routeId, router]
  );

  const saveSnapshot = useCallback(
    (id: string, snapshot: DeskLayoutSnapshot) => {
      persist({
        ...catalog,
        activeId: id,
        items: catalog.items.map((item) =>
          item.id === id ? { ...item, savedAt: Date.now(), snapshot } : item
        ),
      });
    },
    [catalog, persist]
  );

  const value = useMemo<WorkspaceApi>(
    () => ({ catalog, active, createLayout, updateLayout, deleteLayout, saveSnapshot }),
    [catalog, active, createLayout, updateLayout, deleteLayout, saveSnapshot]
  );

  return <WorkspaceCtx.Provider value={value}>{children}</WorkspaceCtx.Provider>;
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceCtx);
  if (!ctx) throw new Error("useWorkspace must be used within WorkspaceProvider");
  return ctx;
}
