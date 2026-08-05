"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { DailyReportView } from "@/components/DailyReportView";
import { Report } from "@/lib/types";

export default function ReportsPage() {
  const [reports, setReports] = useState<Report[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const rows = await apiFetch<Report[]>("/reports");
    setReports(rows);
    if (rows.length && selectedId == null) setSelectedId(rows[0].id);
    else if (rows.length && !rows.some((r) => r.id === selectedId)) setSelectedId(rows[0].id);
  }

  useEffect(() => {
    load().catch((err) => setError(err.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const created = await apiFetch<Report>("/reports/daily", { method: "POST" });
      await load();
      setSelectedId(created.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Chyba");
    } finally {
      setBusy(false);
    }
  }

  const selected = reports.find((r) => r.id === selectedId) || reports[0] || null;

  return (
    <div className="space-y-6 report-layout">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="display text-3xl">Denní Sense</h1>
          <p className="muted">Infografický briefing tipů, portfolia a makra.</p>
        </div>
        <button className="btn btn-primary" onClick={generate} disabled={busy}>
          {busy ? "Generuji…" : "Vygenerovat denní report"}
        </button>
      </div>

      {error && <div className="card p-4 text-[var(--danger)]">{error}</div>}

      {reports.length === 0 && !busy && (
        <div className="card p-8 text-center space-y-3">
          <p className="display text-2xl">Zatím žádný report</p>
          <p className="muted">Vygeneruj první denní Sense — vznikne přehledná stránka s tipy a makrem.</p>
          <button className="btn btn-primary" onClick={generate} disabled={busy}>
            Vygenerovat teď
          </button>
        </div>
      )}

      {reports.length > 1 && (
        <div className="report-archive">
          {reports.map((r) => (
            <button
              key={r.id}
              type="button"
              className={`report-archive__item ${selected?.id === r.id ? "is-active" : ""}`}
              onClick={() => setSelectedId(r.id)}
            >
              <span>{r.title}</span>
              <span className="muted text-xs">
                {new Date(r.created_at).toLocaleDateString("cs-CZ")}
              </span>
            </button>
          ))}
        </div>
      )}

      {selected && <DailyReportView report={selected} />}
    </div>
  );
}
