"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { SenseBriefing } from "@/components/SenseBriefing";
import { cacheSnapshot, readSnapshot } from "@/lib/offline";
import { HomeData } from "@/lib/types";

export default function HomePage() {
  const [data, setData] = useState<HomeData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [briefingBusy, setBriefingBusy] = useState(false);
  const [offline, setOffline] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);

  async function load() {
    try {
      const home = await apiFetch<HomeData>("/home");
      setData(home);
      setError(null);
      setOffline(false);
      setCachedAt(null);
      await cacheSnapshot("home_v1", home);
    } catch (err) {
      const snap = await readSnapshot<HomeData>("home_v1");
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

  async function generateBriefing() {
    if (offline) return;
    setBriefingBusy(true);
    try {
      await apiFetch("/reports/daily", { method: "POST" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Report selhal");
    } finally {
      setBriefingBusy(false);
    }
  }

  if (!data && !error) {
    return <div className="muted">Načítám…</div>;
  }

  return (
    <div className="space-y-6">
      {offline && (
        <div className="offline-banner">
          Offline režim — zobrazuji poslední snapshot
          {cachedAt ? ` z ${new Date(cachedAt).toLocaleString("cs-CZ")}` : ""}. Mutace jsou vypnuté.
        </div>
      )}
      {error && <div className="card p-4 text-[var(--danger)]">{error}</div>}

      {data && (
        <SenseBriefing
          briefingCs={data.briefing_cs}
          briefingTitle={data.briefing_title}
          briefingAt={data.briefing_at}
          onGenerateBriefing={offline ? undefined : () => void generateBriefing()}
          briefingBusy={briefingBusy}
        />
      )}
    </div>
  );
}
