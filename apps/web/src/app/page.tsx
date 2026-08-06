"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { MarketSectorCard } from "@/components/MarketSectorCard";
import { useScreenContext } from "@/components/ScreenContext";
import { cacheSnapshot, readSnapshot } from "@/lib/offline";
import { MarketsOverview } from "@/lib/types";

type AiSummaries = {
  as_of: string;
  sectors: { id: string; summary: string; summary_source: string }[];
};

export default function HomePage() {
  const { setScreen } = useScreenContext();
  const [data, setData] = useState<MarketsOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiDone, setAiDone] = useState(false);

  async function loadAi(signal?: AbortSignal) {
    setAiBusy(true);
    setAiDone(false);
    try {
      const ai = await apiFetch<AiSummaries>("/markets/overview/ai");
      if (signal?.aborted) return;
      setData((prev) => {
        if (!prev) return prev;
        const byId = new Map(ai.sectors.map((s) => [s.id, s]));
        return {
          ...prev,
          sectors: prev.sectors.map((s) => {
            const hit = byId.get(s.id);
            if (!hit) return s;
            return {
              ...s,
              summary: hit.summary,
              summary_source: hit.summary_source || "llm",
            };
          }),
        };
      });
      setAiDone(true);
    } catch {
      if (!signal?.aborted) setAiDone(false);
    } finally {
      if (!signal?.aborted) setAiBusy(false);
    }
  }

  async function load(signal?: AbortSignal) {
    try {
      const overview = await apiFetch<MarketsOverview>("/markets/overview");
      if (signal?.aborted) return;
      setData(overview);
      setError(null);
      setOffline(false);
      setCachedAt(null);
      setAiDone(false);
      await cacheSnapshot("markets_overview_v1", overview);
      void loadAi(signal);
    } catch (err) {
      if (signal?.aborted) return;
      const snap = await readSnapshot<MarketsOverview>("markets_overview_v1");
      if (snap) {
        setData(snap.data);
        setOffline(true);
        setCachedAt(snap.savedAt);
        setError(null);
      } else {
        setError(err instanceof Error ? err.message : "Chyba načtení");
      }
    }
  }

  useEffect(() => {
    const ac = new AbortController();
    void load(ac.signal);
    const onOnline = () => void load(ac.signal);
    window.addEventListener("online", onOnline);
    return () => {
      ac.abort();
      window.removeEventListener("online", onOnline);
    };
  }, []);

  useEffect(() => {
    if (!data) {
      setScreen({ page: "home", title: "Homepage — tržní přehled" });
      return;
    }
    const detail = data.sectors
      .map(
        (s) =>
          `${s.label}: ${s.bias_label}` +
          (s.avg_change_pct != null ? ` (ø ${s.avg_change_pct.toFixed(2)}%)` : "") +
          ` — ${s.summary}`
      )
      .join("\n");
    setScreen({
      page: "home",
      title: "Homepage — tržní přehled",
      detail,
    });
  }, [data, setScreen]);

  if (!data && !error) {
    return <div className="muted">Načítám tržní přehled…</div>;
  }

  return (
    <div className="space-y-6">
      <div className="market-home__intro">
        <h1 className="market-home__title">Tržní přehled</h1>
        <p className="muted text-sm">
          Stručný stav krypta, akcií a komodit podle hlavních benchmarků.
        </p>
        {aiBusy && (
          <p className="market-home__ai-status">Generuji AI souhrny (Gemini)…</p>
        )}
        {aiDone && !aiBusy && (
          <p className="market-home__ai-status is-done">AI souhrny připraveny</p>
        )}
      </div>

      {offline && (
        <div className="offline-banner">
          Offline režim — zobrazuji poslední snapshot
          {cachedAt ? ` z ${new Date(cachedAt).toLocaleString("cs-CZ")}` : ""}.
        </div>
      )}
      {error && <div className="card p-4 text-[var(--danger)]">{error}</div>}

      {data && (
        <div className="market-sectors-grid">
          {data.sectors.map((sector) => (
            <MarketSectorCard
              key={sector.id}
              sector={sector}
              aiPending={aiBusy && sector.summary_source !== "llm"}
            />
          ))}
        </div>
      )}
    </div>
  );
}
