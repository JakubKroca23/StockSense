"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import { AlertItem } from "@/lib/types";

const FILTERS: { id: string; label: string; match: (kind: string) => boolean }[] = [
  { id: "all", label: "Vše", match: () => true },
  { id: "new_tip", label: "Tipy", match: (k) => k === "new_tip" },
  { id: "price_stop", label: "Stop", match: (k) => k.includes("stop") },
  { id: "price_target", label: "Target", match: (k) => k.includes("target") },
  { id: "price_rule", label: "Hlídače", match: (k) => k.startsWith("rule_") },
  { id: "daily_report", label: "Report", match: (k) => k === "daily_report" },
  { id: "tip_invalidated", label: "Invalidace", match: (k) => k === "tip_invalidated" },
];

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [filter, setFilter] = useState("all");
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setAlerts(await apiFetch<AlertItem[]>("/alerts"));
  }

  useEffect(() => {
    load().catch((err) => setError(err.message));
  }, []);

  async function markRead(id: number) {
    await apiFetch(`/alerts/${id}/read`, { method: "POST" });
    await load();
  }

  async function markAllRead() {
    await apiFetch("/alerts/read-all", { method: "POST" });
    await load();
  }

  const filtered = useMemo(() => {
    const fn = FILTERS.find((f) => f.id === filter)?.match || (() => true);
    return alerts.filter((a) => fn(a.kind));
  }, [alerts, filter]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="display text-3xl">Alerty</h1>
          <p className="muted">
            Filtruj podle druhu · kanály a tiché hodiny v{" "}
            <Link href="/settings" className="text-[var(--accent)]">
              Nastavení
            </Link>
            .
          </p>
        </div>
        {alerts.some((a) => !a.is_read) && (
          <button className="btn" onClick={() => markAllRead().catch((e) => setError(e.message))}>
            Označit vše přečtené
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            className={`btn text-xs px-2 py-1 ${filter === f.id ? "btn-primary" : ""}`}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error && <div className="card p-4 text-[var(--danger)]">{error}</div>}
      {filtered.length === 0 && <div className="card p-5 muted">Žádné alerty v tomto filtru.</div>}
      <div className="space-y-3">
        {filtered.map((a) => (
          <div key={a.id} className={`card p-4 ${a.is_read ? "opacity-60" : ""}`}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-medium">{a.title}</div>
                <p className="text-sm muted mt-1">{a.body}</p>
                <p className="text-xs muted mt-2">
                  {a.kind} · {new Date(a.created_at).toLocaleString("cs-CZ")}
                </p>
              </div>
              {!a.is_read && (
                <button className="btn" onClick={() => markRead(a.id)}>
                  Přečteno
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
