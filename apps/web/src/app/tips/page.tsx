"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { TipCard } from "@/components/TipCard";
import {
  CloseReason,
  FeedbackResult,
  Tip,
  TipAction,
  TipHistory,
  TipStats,
  TipStatus,
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

const ACTION_ORDER: TipAction[] = ["long", "short", "hold", "sell"];
const ACTION_COLORS = ["#5dde8a", "#ff6b7a", "#f0c14a", "#6ea8ff"];

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

function TipActionsDonut({ tips }: { tips: Tip[] }) {
  const counts: Record<string, number> = Object.fromEntries(ACTION_ORDER.map((k) => [k, 0]));
  for (const t of tips) {
    counts[t.action] = (counts[t.action] || 0) + 1;
  }
  const slices = ACTION_ORDER.map((key, i) => ({
    key,
    label: actionLabel[key],
    value: counts[key] || 0,
    color: ACTION_COLORS[i],
  })).filter((s) => s.value > 0);
  const total = slices.reduce((s, x) => s + x.value, 0);

  if (!total) {
    return <p className="muted text-sm">Zatím žádné aktivní tipy.</p>;
  }

  const size = 148;
  const thickness = 22;
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;

  return (
    <div className="home-chart-block">
      <div className="home-donut">
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="var(--line)"
            strokeWidth={thickness}
            opacity={0.45}
          />
          {slices.map((slice) => {
            const len = (slice.value / total) * c;
            const el = (
              <circle
                key={slice.key}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={slice.color}
                strokeWidth={thickness}
                strokeDasharray={`${len} ${c - len}`}
                strokeDashoffset={-offset}
                strokeLinecap="butt"
                transform={`rotate(-90 ${size / 2} ${size / 2})`}
              />
            );
            offset += len;
            return el;
          })}
        </svg>
        <div className="home-donut__center">
          <div className="home-donut__value">{total}</div>
          <div className="home-donut__sub">tipů</div>
        </div>
      </div>
      <ul className="home-legend">
        {slices.map((s) => (
          <li key={s.key}>
            <span className="home-legend__swatch" style={{ background: s.color }} />
            <span className="home-legend__label">{s.label}</span>
            <span className="home-legend__pct">{((s.value / total) * 100).toFixed(0)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
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
            <span className="home-kpi__suffix">TP vs SL {pct(stats.tp_rate)}</span>
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

export default function TipsPage() {
  const [activeTips, setActiveTips] = useState<Tip[]>([]);
  const [history, setHistory] = useState<TipHistory | null>(null);
  const [resultFilter, setResultFilter] = useState<ResultFilter>("all");
  const [reasonFilter, setReasonFilter] = useState<ReasonFilter>("all");
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tipBusy, setTipBusy] = useState(false);

  const loadActive = useCallback(async () => {
    const tips = await apiFetch<Tip[]>("/tips");
    setActiveTips(tips);
  }, []);

  const loadHistory = useCallback(async () => {
    const params = new URLSearchParams({ limit: "200" });
    if (resultFilter !== "all") params.set("result", resultFilter);
    if (reasonFilter === "tp" || reasonFilter === "sl") {
      params.set("level", reasonFilter);
    } else if (reasonFilter !== "all") {
      params.set("close_reason", reasonFilter);
    }
    const res = await apiFetch<TipHistory>(`/tips/history?${params.toString()}`);
    setHistory(res);
  }, [resultFilter, reasonFilter]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await Promise.all([loadActive(), loadHistory()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Načtení selhalo");
    } finally {
      setLoading(false);
    }
  }, [loadActive, loadHistory]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  async function onLifecycle(
    id: number,
    status: TipStatus,
    result?: FeedbackResult,
    notes?: string
  ) {
    setTipBusy(true);
    try {
      await apiFetch(`/tips/${id}/lifecycle`, {
        method: "POST",
        body: JSON.stringify({ status, result: result || null, notes: notes || null }),
      });
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Úprava tipu selhala");
    } finally {
      setTipBusy(false);
    }
  }

  async function onJournal(id: number, entryNotes: string, exitNotes: string) {
    setTipBusy(true);
    try {
      const tip = activeTips.find((t) => t.id === id);
      await apiFetch(`/tips/${id}/journal`, {
        method: "PATCH",
        body: JSON.stringify({
          entry_notes: entryNotes,
          exit_notes: exitNotes || null,
          result: tip?.feedback?.result || (exitNotes ? "partial" : null),
        }),
      });
      setOkMsg("Journal uložen");
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Journal selhal");
    } finally {
      setTipBusy(false);
    }
  }

  async function onPaper(id: number) {
    setTipBusy(true);
    try {
      const res = await apiFetch<{
        preview: { quantity: number; avg_cost: number; size_pct: number; symbol: string };
      }>(`/tips/${id}/paper-position`, { method: "POST" });
      setOkMsg(
        `Paper ${res.preview.symbol}: ${res.preview.quantity} @ ${res.preview.avg_cost} (${res.preview.size_pct}% equity)`
      );
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Paper pozice selhala");
    } finally {
      setTipBusy(false);
    }
  }

  const closedTips = history?.tips || [];

  return (
    <div className="space-y-8">
      {error && <div className="card p-4 text-[var(--danger)]">{error}</div>}
      {okMsg && <div className="card p-4 text-[var(--ok)]">{okMsg}</div>}

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="display text-3xl">Top tipy dne</h1>
          <button
            type="button"
            className="btn btn-primary"
            disabled
            title="Generování tipů je dočasně vypnuté"
          >
            Přepočítat tipy (vypnuto)
          </button>
        </div>
        <p className="muted text-sm">
          Automatické tipy a cron jsou vypnuté — scoring se předělává.
        </p>

        <div className="card p-4 sm:p-5">
          <h2 className="home-chart-title">Tipy podle akce</h2>
          <div className="mt-3">
            <TipActionsDonut tips={activeTips} />
          </div>
        </div>

        {loading && activeTips.length === 0 && (
          <div className="card p-5 muted">Načítám tipy…</div>
        )}
        {!loading && activeTips.length === 0 && (
          <div className="card p-5 muted">Žádné tipy — spusť přepočet.</div>
        )}
        {activeTips.map((tip) => (
          <TipCard
            key={tip.id}
            tip={tip}
            busy={tipBusy}
            onLifecycle={onLifecycle}
            onPaper={onPaper}
            onJournal={onJournal}
          />
        ))}
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="display text-2xl">Historie tipů</h2>
          <p className="muted">
            Přehled úspěšnosti — kolik tipů trefilo take profit nebo stop loss.
          </p>
        </div>

        {history?.stats && <StatsCards stats={history.stats} />}

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

        {loading && !history && <div className="card p-5 muted">Načítám historii…</div>}
        {!loading && closedTips.length === 0 && (
          <div className="card p-5 muted">
            Žádné uzavřené tipy v tomto filtru. Po zásahu TP/SL nebo manuálním feedbacku se tu
            objeví.
          </div>
        )}

        <div className="space-y-3">
          {closedTips.map((tip) => {
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
                    <div className="muted text-xs">conf {(tip.confidence * 100).toFixed(0)}%</div>
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
                  <div className={reason === "target_2" ? "text-[var(--ok)]" : ""}>
                    TP2 {tip.target_2?.toFixed(2) ?? "—"}
                  </div>
                </div>

                {fb?.notes && <p className="mt-3 text-sm leading-relaxed">{fb.notes}</p>}

                <p className="text-xs muted mt-3">
                  Vytvořen {new Date(tip.created_at).toLocaleString("cs-CZ")}
                  {closedAt ? ` · Uzavřen ${new Date(closedAt).toLocaleString("cs-CZ")}` : ""}
                </p>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
