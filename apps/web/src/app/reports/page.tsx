"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { Report } from "@/lib/types";

export default function ReportsPage() {
  const [reports, setReports] = useState<Report[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setReports(await apiFetch<Report[]>("/reports"));
  }

  useEffect(() => {
    load().catch((err) => setError(err.message));
  }, []);

  async function generate() {
    setBusy(true);
    try {
      await apiFetch("/reports/daily", { method: "POST" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Chyba");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="display text-3xl">Reporty</h1>
          <p className="muted">Denní briefing z tipů a portfolia.</p>
        </div>
        <button className="btn btn-primary" onClick={generate} disabled={busy}>
          {busy ? "Generuji…" : "Vygenerovat denní report"}
        </button>
      </div>
      {error && <div className="card p-4 text-[var(--danger)]">{error}</div>}
      {reports.length === 0 && <div className="card p-5 muted">Zatím žádné reporty.</div>}
      {reports.map((r) => (
        <article key={r.id} className="card p-5 space-y-2">
          <div className="flex justify-between gap-3">
            <h2 className="display text-2xl">{r.title}</h2>
            <span className="badge">{r.kind}</span>
          </div>
          <p className="muted text-xs">{new Date(r.created_at).toLocaleString("cs-CZ")}</p>
          <pre className="whitespace-pre-wrap text-sm leading-relaxed font-sans">{r.content_md}</pre>
        </article>
      ))}
    </div>
  );
}
