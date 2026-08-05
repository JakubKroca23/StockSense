"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { AlertItem } from "@/lib/types";

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="display text-3xl">Alerty</h1>
        <p className="muted">Nové tipy, změny úrovní, reporty.</p>
      </div>
      {error && <div className="card p-4 text-[var(--danger)]">{error}</div>}
      {alerts.length === 0 && <div className="card p-5 muted">Žádné alerty.</div>}
      <div className="space-y-3">
        {alerts.map((a) => (
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
