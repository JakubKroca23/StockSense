"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { downloadApiCsv } from "@/lib/csv";
import {
  CloseReason,
  FeedbackResult,
  TipHistory,
  TipStats,
  actionLabel,
  closeReasonLabel,
  feedbackResultLabel,
  horizonLabel,
} from "@/lib/types";

type ResultFilter = "all" | FeedbackResult;
type ReasonFilter = "all" | CloseReason | "tp" | "sl";

const RESULT_FILTERS: { id: ResultFilter; label: string }[] = [
  { id: "all", label: "Vše" },
  { id: "hit", label: "Hit" },
  { id: "miss", label: "Miss" },
  { id: "partial", label: "Partial" },
];

const REASON_FILTERS: { id: ReasonFilter; label: string }[] = [
  { id: "all", label: "Všechny výstupy" },
  { id: "tp", label: "TP (target)" },
  { id: "sl", label: "Stop loss" },
  { id: "ttl", label: "Expirace" },
  { id: "score_flip", label: "Scoring flip" },
  { id: "manual", label: "Manuálně" },
];

function pct(v: number | null | undefined) {
  if (v == null) return "—";
  return `${(v * 100).toFixed(0)}%`;
}

function reasonBadgeClass(reason: string | null | undefined) {
  if (reason === "stop") return "badge sell";
  if (reason === "target_1" || reason === "target_2") return "badge long";
  return "badge";
}

function resultBadgeClass(result: string) {
  if (result === "hit") return "badge long";
  if (result === "miss") return "badge sell";
  return "badge";
}

function StatsCards({ stats }: { stats: TipStats }) {
  const reasons = stats.by_close_reason || {};
  return (
    <div className="space-y-4">
      <div className="home-kpi-grid">
        <div className="home-kpi">
          <div className="home-kpi__label">Uzavřených tipů</div>
          <div className="home-kpi__value">{stats.total}</div>
        </div>
        <div className="home-kpi">
          <div className="home-kpi__label">Hit-rate</div>
          <div className="home-kpi__value">
            {pct(stats.hit_rate)}
            <span className="home-kpi__suffix">
              {stats.hits}H · {stats.partials}P · {stats.misses}M
            </span>
          </div>
        </div>
        <div className="home-kpi">
          <div className="home-kpi__label">Take profit</div>
          <div className="home-kpi__value text-[var(--ok)]">
            {stats.tp_hits ?? 0}
            <span className="home-kpi__suffix">
              TP1 {reasons.target_1 ?? 0} · TP2 {reasons.target_2 ?? 0}
            </span>
          </div>
        </div>
        <div className="home-kpi">
          <div className="home-kpi__label">Stop loss</div>
          <div className="home-kpi__value text-[var(--danger)]">
            {stats.sl_hits ?? 0}
            <span className="home-kpi__suffix">
              TP vs SL {pct(stats.tp_rate)}
            </span>
          </div>
        </div>
      </div>

      {Object.keys(reasons).length > 0 && (
        <div className="card p-4">
          <h3 className="home-chart-title mb-3">Podle důvodu uzavření</h3>
          <div className="flex flex-wrap gap-2">
            {Object.entries(reasons)
              .sort((a, b) => b[1] - a[1])
              .map(([reason, count]) => (
                <span key={reason} className={reasonBadgeClass(reason)}>
                  {closeReasonLabel[reason] || reason}: {count}
                </span>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function TipsHistoryPage() {
  const [data, setData] = useState<TipHistory | null>(null);
  const [resultFilter, setResultFilter] = useState<ResultFilter>("all");
  const [reasonFilter, setReasonFilter] = useState<ReasonFilter>("all");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: "200" });
      if (resultFilter !== "all") params.set("result", resultFilter);
      if (reasonFilter === "tp" || reasonFilter === "sl") {
        params.set("level", reasonFilter);
      } else if (reasonFilter !== "all") {
        params.set("close_reason", reasonFilter);
      }
      const res = await apiFetch<TipHistory>(`/tips/history?${params.toString()}`);
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Načtení selhalo");
    } finally {
      setLoading(false);
    }
  }, [resultFilter, reasonFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const tips = data?.tips || [];

  async function exportCsv() {
    await downloadApiCsv("/export/tips.csv?include_inactive=true", "stocksense-tips.csv");
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="display text-3xl">Historie tipů</h1>
          <p className="muted">
            Přehled úspěšnosti — kolik tipů trefilo take profit nebo stop loss.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn text-xs px-2 py-1" onClick={() => void exportCsv()}>
            CSV export
          </button>
          <button
            type="button"
            className="btn text-xs px-2 py-1"
            onClick={() => void load()}
            disabled={loading}
          >
            {loading ? "Načítám…" : "Obnovit"}
          </button>
        </div>
      </div>

      {error && <div className="card p-4 text-[var(--danger)]">{error}</div>}

      {data?.stats && <StatsCards stats={data.stats} />}

      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {RESULT_FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              className={`btn text-xs px-2 py-1 ${resultFilter === f.id ? "btn-primary" : ""}`}
              onClick={() => setResultFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {REASON_FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              className={`btn text-xs px-2 py-1 ${reasonFilter === f.id ? "btn-primary" : ""}`}
              onClick={() => setReasonFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {loading && !data && <div className="card p-5 muted">Načítám historii…</div>}
      {!loading && tips.length === 0 && (
        <div className="card p-5 muted">
          Žádné uzavřené tipy v tomto filtru. Po zásahu TP/SL nebo manuálním feedbacku se tu
          objeví.
        </div>
      )}

      <div className="space-y-3">
        {tips.map((tip) => {
          const fb = tip.feedback;
          const reason = fb?.close_reason || null;
          const closedAt = tip.closed_at || fb?.created_at;
          return (
            <div key={tip.id} className="card p-4 rise">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/instrument/${tip.instrument.symbol}`}
                      className="font-semibold text-lg hover:text-[var(--accent)]"
                    >
                      {tip.instrument.symbol}
                    </Link>
                    <span className={`badge ${tip.action}`}>{actionLabel[tip.action]}</span>
                    {fb && (
                      <span className={resultBadgeClass(fb.result)}>
                        {feedbackResultLabel[fb.result] || fb.result}
                      </span>
                    )}
                    {reason && (
                      <span className={reasonBadgeClass(reason)}>
                        {closeReasonLabel[reason] || reason}
                      </span>
                    )}
                  </div>
                  <p className="muted text-sm mt-1">
                    {tip.instrument.name || tip.instrument.asset_class} ·{" "}
                    {horizonLabel[tip.horizon]}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-xl font-semibold">{tip.score.toFixed(0)}</div>
                  <div className="muted text-xs">
                    conf {(tip.confidence * 100).toFixed(0)}%
                  </div>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs muted">
                <div>
                  Entry {tip.entry_low?.toFixed(2)}–{tip.entry_high?.toFixed(2)}
                </div>
                <div className={reason === "stop" ? "text-[var(--danger)]" : ""}>
                  SL {tip.stop?.toFixed(2) ?? "—"}
                </div>
                <div
                  className={
                    reason === "target_1" || reason === "target_2" ? "text-[var(--ok)]" : ""
                  }
                >
                  TP1 {tip.target_1?.toFixed(2) ?? "—"}
                </div>
                <div
                  className={reason === "target_2" ? "text-[var(--ok)]" : ""}
                >
                  TP2 {tip.target_2?.toFixed(2) ?? "—"}
                </div>
              </div>

              {fb?.notes && <p className="mt-3 text-sm leading-relaxed">{fb.notes}</p>}

              <p className="text-xs muted mt-3">
                Vytvořen {new Date(tip.created_at).toLocaleString("cs-CZ")}
                {closedAt
                  ? ` · Uzavřen ${new Date(closedAt).toLocaleString("cs-CZ")}`
                  : ""}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
