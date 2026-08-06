"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { MarketSectorCard } from "@/components/MarketSectorCard";
import { useScreenContext } from "@/components/ScreenContext";
import { cacheSnapshot, readSnapshot } from "@/lib/offline";
import { MarketsOverview } from "@/lib/types";

export default function HomePage() {
  const { setScreen } = useScreenContext();
  const [data, setData] = useState<MarketsOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);

  async function load() {
    try {
      const overview = await apiFetch<MarketsOverview>("/markets/overview");
      setData(overview);
      setError(null);
      setOffline(false);
      setCachedAt(null);
      await cacheSnapshot("markets_overview_v1", overview);
    } catch (err) {
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
    void load();
    const onOnline = () => void load();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
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
            <MarketSectorCard key={sector.id} sector={sector} />
          ))}
        </div>
      )}
    </div>
  );
}
