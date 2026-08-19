"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { DEFAULT_DESK_CHART_VIZ, type ChartVizSettings } from "@/components/PriceChart";

const KEY = "stocksense-desk-chart-viz";

type ChartVizContextValue = {
  viz: ChartVizSettings;
  setViz: (patch: Partial<ChartVizSettings>) => void;
  resetViz: () => void;
};

const ChartVizContext = createContext<ChartVizContextValue | null>(null);

export function ChartVizProvider({ children }: { children: ReactNode }) {
  const [viz, setVizState] = useState<ChartVizSettings>(DEFAULT_DESK_CHART_VIZ);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<ChartVizSettings>;
      if (parsed && typeof parsed === "object") {
        setVizState({ ...DEFAULT_DESK_CHART_VIZ, ...parsed });
      }
    } catch {
      /* ignore */
    }
  }, []);

  const setViz = useCallback((patch: Partial<ChartVizSettings>) => {
    setVizState((prev) => {
      const next = { ...prev, ...patch };
      try {
        window.localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const resetViz = useCallback(() => {
    setVizState(DEFAULT_DESK_CHART_VIZ);
    try {
      window.localStorage.setItem(KEY, JSON.stringify(DEFAULT_DESK_CHART_VIZ));
    } catch {
      /* ignore */
    }
  }, []);

  return (
    <ChartVizContext.Provider value={{ viz, setViz, resetViz }}>{children}</ChartVizContext.Provider>
  );
}

export function useChartViz() {
  const ctx = useContext(ChartVizContext);
  if (!ctx) throw new Error("useChartViz must be used within ChartVizProvider");
  return ctx;
}
