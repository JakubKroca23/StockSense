"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type ScreenSnapshot = {
  page: string;
  title?: string;
  symbol?: string | null;
  detail?: string;
};

type ScreenContextValue = {
  screen: ScreenSnapshot;
  setScreen: (next: ScreenSnapshot) => void;
  screenContextText: string;
};

const DEFAULT: ScreenSnapshot = { page: "home", title: "Homepage" };

const ScreenContext = createContext<ScreenContextValue | null>(null);

export function ScreenContextProvider({ children }: { children: ReactNode }) {
  const [screen, setScreenState] = useState<ScreenSnapshot>(DEFAULT);

  const setScreen = useCallback((next: ScreenSnapshot) => {
    setScreenState(next);
  }, []);

  const screenContextText = useMemo(() => {
    const lines = [
      `Stránka: ${screen.title || screen.page}`,
      `Route key: ${screen.page}`,
    ];
    if (screen.symbol) lines.push(`Aktivní symbol: ${screen.symbol}`);
    if (screen.detail) lines.push(screen.detail);
    return lines.join("\n");
  }, [screen]);

  const value = useMemo(
    () => ({ screen, setScreen, screenContextText }),
    [screen, setScreen, screenContextText]
  );

  return <ScreenContext.Provider value={value}>{children}</ScreenContext.Provider>;
}

export function useScreenContext() {
  const ctx = useContext(ScreenContext);
  if (!ctx) {
    return {
      screen: DEFAULT,
      setScreen: () => {},
      screenContextText: "Stránka: neznámá",
    };
  }
  return ctx;
}
