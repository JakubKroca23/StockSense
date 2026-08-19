"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import {
  sameLinkedScale,
  type LinkGroup,
  type LinkedPriceScale,
} from "@/lib/linkGroup";

type PriceLinkApi = {
  scaleOf: (group: LinkGroup) => LinkedPriceScale | null;
  publish: (group: LinkGroup, scale: Omit<LinkedPriceScale, "leadUntil">, holdMs?: number) => void;
};

const PriceLinkCtx = createContext<PriceLinkApi | null>(null);

export function PriceLinkProvider({ children }: { children: ReactNode }) {
  const [scales, setScales] = useState<Partial<Record<LinkGroup, LinkedPriceScale>>>({});

  const publish = useCallback(
    (group: LinkGroup, scale: Omit<LinkedPriceScale, "leadUntil">, holdMs = 0) => {
      setScales((prev) => {
        const next: LinkedPriceScale = {
          ...scale,
          leadUntil: holdMs > 0 ? Date.now() + holdMs : prev[group]?.leadUntil ?? 0,
        };
        const cur = prev[group];
        if (cur && sameLinkedScale({ ...cur, sourceId: next.sourceId, leadUntil: 0 }, { ...next, leadUntil: 0 })) {
          if (holdMs <= 0 || cur.leadUntil >= next.leadUntil) return prev;
        }
        return { ...prev, [group]: next };
      });
    },
    []
  );

  const api = useMemo<PriceLinkApi>(
    () => ({
      scaleOf: (group) => scales[group] ?? null,
      publish,
    }),
    [scales, publish]
  );

  return <PriceLinkCtx.Provider value={api}>{children}</PriceLinkCtx.Provider>;
}

export function usePriceLink() {
  return useContext(PriceLinkCtx);
}

export function useLinkedScale(group: LinkGroup | null): LinkedPriceScale | null {
  const api = usePriceLink();
  if (!api || !group) return null;
  return api.scaleOf(group);
}
