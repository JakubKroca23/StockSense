"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { HomeOverview } from "@/components/HomeOverview";
import { DataQualityBadge } from "@/components/DataQualityBadge";
import { downloadApiCsv } from "@/lib/csv";
import { cacheSnapshot, readSnapshot } from "@/lib/offline";
import {
  FeedbackResult,
  HomeData,
  PortfolioPosition,
  Tip,
  TipStatus,
  actionLabel,
  horizonLabel,
  riskLabel,
  tipStatusLabel,
} from "@/lib/types";

function TipCard({
  tip,
  busy,
  offline,
  onLifecycle,
  onPaper,
  onJournal,
}: {
  tip: Tip;
  busy: boolean;
  offline?: boolean;
  onLifecycle: (id: number, status: TipStatus, result?: FeedbackResult, notes?: string) => void;
  onPaper: (id: number) => void;
  onJournal: (id: number, entryNotes: string, exitNotes: string) => void;
}) {
  const status = tip.status || "proposed";
  const [entryNotes, setEntryNotes] = useState(tip.entry_notes || "");
  const [exitNotes, setExitNotes] = useState(tip.feedback?.notes || "");
  const [showJournal, setShowJournal] = useState(Boolean(tip.entry_notes || tip.feedback?.notes));

  useEffect(() => {
    setEntryNotes(tip.entry_notes || "");
    setExitNotes(tip.feedback?.notes || "");
  }, [tip.id, tip.entry_notes, tip.feedback?.notes]);

  return (
    <div className="card p-4 rise">
      <Link href={`/instrument/${tip.instrument.symbol}`} className="block hover:opacity-95">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold text-lg">{tip.instrument.symbol}</h3>
              <span className={`badge ${tip.action}`}>{actionLabel[tip.action]}</span>
              <span className="badge">{tipStatusLabel[status] || status}</span>
            </div>
            <p className="muted text-sm">{tip.instrument.name || tip.instrument.asset_class}</p>
          </div>
          <div className="text-right">
            <div className="text-xl font-semibold">{tip.score.toFixed(0)}</div>
            <div className="muted text-xs">score · conf {(tip.confidence * 100).toFixed(0)}%</div>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-xs muted">
          <span className="badge">{horizonLabel[tip.horizon]}</span>
          <DataQualityBadge quality={tip.data_quality} compact />
          {tip.suggested_size_pct != null && (
            <span className="badge">size {tip.suggested_size_pct}%</span>
          )}
        </div>
        {tip.narrative_cs && (
          <p className="mt-3 text-sm leading-relaxed line-clamp-3">{tip.narrative_cs}</p>
        )}
        <div className="mt-3 grid grid-cols-3 gap-2 text-xs muted">
          <div>
            Entry {tip.entry_low?.toFixed(2)}–{tip.entry_high?.toFixed(2)}
          </div>
          <div>Stop {tip.stop?.toFixed(2)}</div>
          <div>TP {tip.target_1?.toFixed(2)}</div>
        </div>
      </Link>

      {(tip.entry_notes || tip.feedback?.notes) && !showJournal && (
        <div className="mt-3 text-xs muted space-y-1">
          {tip.entry_notes && <p>Vstup: {tip.entry_notes}</p>}
          {tip.feedback?.notes && <p>Výstup: {tip.feedback.notes}</p>}
        </div>
      )}

      {showJournal && (
        <div className="tip-journal mt-3 space-y-2">
          <label className="block space-y-1">
            <span className="text-xs muted">Proč vstupuji / přijímám</span>
            <textarea
              className="input"
              value={entryNotes}
              disabled={offline || busy}
              onChange={(e) => setEntryNotes(e.target.value)}
              placeholder="Krátký zápis k vstupu…"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs muted">Proč vycházím / uzavírám</span>
            <textarea
              className="input"
              value={exitNotes}
              disabled={offline || busy}
              onChange={(e) => setExitNotes(e.target.value)}
              placeholder="Krátký zápis k výstupu…"
            />
          </label>
          <button
            type="button"
            className="btn text-xs px-2 py-1"
            disabled={offline || busy}
            onClick={() => onJournal(tip.id, entryNotes, exitNotes)}
          >
            Uložit journal
          </button>
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          className="btn text-xs px-2 py-1"
          onClick={() => setShowJournal((v) => !v)}
        >
          {showJournal ? "Skrýt journal" : "Journal"}
        </button>
        {status === "proposed" && (
          <>
            <button
              type="button"
              className="btn btn-primary text-xs px-2 py-1"
              disabled={busy || offline}
              onClick={() => onLifecycle(tip.id, "accepted", undefined, entryNotes)}
            >
              Přijmout
            </button>
            <button
              type="button"
              className="btn text-xs px-2 py-1"
              disabled={busy || offline}
              onClick={() => onLifecycle(tip.id, "rejected", undefined, entryNotes)}
            >
              Odmítnout
            </button>
          </>
        )}
        {(status === "proposed" || status === "accepted") && (
          <>
            <button
              type="button"
              className="btn text-xs px-2 py-1"
              disabled={busy || offline}
              onClick={() => onPaper(tip.id)}
            >
              Paper pozice
            </button>
            <Link
              href={`/chat?symbol=${encodeURIComponent(tip.instrument.symbol)}&prompt=pre-zaver&fresh=1`}
              className="btn text-xs px-2 py-1"
            >
              Analýza
            </Link>
            <button
              type="button"
              className="btn text-xs px-2 py-1"
              disabled={busy || offline}
              onClick={() => onLifecycle(tip.id, "closed", "hit", exitNotes)}
            >
              Hit
            </button>
            <button
              type="button"
              className="btn text-xs px-2 py-1"
              disabled={busy || offline}
              onClick={() => onLifecycle(tip.id, "closed", "partial", exitNotes)}
            >
              Partial
            </button>
            <button
              type="button"
              className="btn text-xs px-2 py-1"
              disabled={busy || offline}
              onClick={() => onLifecycle(tip.id, "closed", "miss", exitNotes)}
            >
              Miss
            </button>
          </>
        )}
        {tip.feedback && <span className="badge">feedback: {tip.feedback.result}</span>}
      </div>
    </div>
  );
}

function PositionRow({ p }: { p: PortfolioPosition }) {
  const pnl = p.pnl ?? 0;
  return (
    <Link
      href={`/instrument/${p.instrument.symbol}`}
      className="flex items-center justify-between gap-3 border-b border-[var(--line)] py-3 last:border-0"
    >
      <div>
        <div className="font-medium">
          {p.instrument.symbol} {p.is_paper && <span className="badge">paper</span>}
        </div>
        <div className="muted text-xs">
          {Number(p.quantity)} @ {Number(p.avg_cost).toFixed(2)}
        </div>
      </div>
      <div className="text-right">
        <div>{p.last_price != null ? p.last_price.toFixed(2) : "—"}</div>
        <div className={pnl >= 0 ? "text-[var(--ok)] text-sm" : "text-[var(--danger)] text-sm"}>
          {p.pnl != null ? `${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)} (${p.pnl_pct?.toFixed(1)}%)` : "—"}
        </div>
      </div>
    </Link>
  );
}

export default function HomePage() {
  const [data, setData] = useState<HomeData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [briefingBusy, setBriefingBusy] = useState(false);
  const [tipBusy, setTipBusy] = useState(false);
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
    load();
    const onOnline = () => void load();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, []);

  async function runScoring() {
    if (offline) return;
    setBusy(true);
    try {
      await apiFetch("/tips/run", { method: "POST" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Scoring selhal");
    } finally {
      setBusy(false);
    }
  }

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

  async function onLifecycle(
    id: number,
    status: TipStatus,
    result?: FeedbackResult,
    notes?: string
  ) {
    if (offline) return;
    setTipBusy(true);
    try {
      await apiFetch(`/tips/${id}/lifecycle`, {
        method: "POST",
        body: JSON.stringify({ status, result: result || null, notes: notes || null }),
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Úprava tipu selhala");
    } finally {
      setTipBusy(false);
    }
  }

  async function onJournal(id: number, entryNotes: string, exitNotes: string) {
    if (offline) return;
    setTipBusy(true);
    try {
      const tip = data?.tips.find((t) => t.id === id);
      await apiFetch(`/tips/${id}/journal`, {
        method: "PATCH",
        body: JSON.stringify({
          entry_notes: entryNotes,
          exit_notes: exitNotes || null,
          result: tip?.feedback?.result || (exitNotes ? "partial" : null),
        }),
      });
      setOkMsg("Journal uložen");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Journal selhal");
    } finally {
      setTipBusy(false);
    }
  }

  async function onPaper(id: number) {
    if (offline) return;
    setTipBusy(true);
    try {
      const res = await apiFetch<{
        preview: { quantity: number; avg_cost: number; size_pct: number; symbol: string };
      }>(`/tips/${id}/paper-position`, { method: "POST" });
      setError(null);
      setOkMsg(
        `Paper ${res.preview.symbol}: ${res.preview.quantity} @ ${res.preview.avg_cost} (${res.preview.size_pct}% equity)`
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Paper pozice selhala");
    } finally {
      setTipBusy(false);
    }
  }

  async function exportTips() {
    try {
      await downloadApiCsv("/export/tips.csv?include_inactive=true", "stocksense-tips.csv");
      setOkMsg("CSV tipů staženo");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export tipů selhal");
    }
  }

  async function exportPortfolio() {
    try {
      await downloadApiCsv("/export/portfolio.csv", "stocksense-portfolio.csv");
      setOkMsg("CSV portfolia staženo");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export portfolia selhal");
    }
  }

  if (!data && !error) {
    return <div className="muted">Načítám portfolio a tipy…</div>;
  }

  return (
    <div className="space-y-6">
      <section className="rise flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="display text-3xl md:text-4xl">Dnes na trhu</h1>
          <p className="muted mt-1">
            Risk profil: {data ? riskLabel[data.risk_profile] : "—"}
            {data && data.alerts_unread > 0 ? ` · ${data.alerts_unread} nepřečtených alertů` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn text-xs px-2 py-1" onClick={() => void exportPortfolio()} disabled={offline}>
            CSV portfolio
          </button>
          <button className="btn text-xs px-2 py-1" onClick={() => void exportTips()} disabled={offline}>
            CSV tipy
          </button>
          <button className="btn btn-primary" onClick={runScoring} disabled={busy || offline}>
            {busy ? "Počítám…" : "Přepočítat tipy"}
          </button>
        </div>
      </section>

      {offline && (
        <div className="offline-banner">
          Offline režim — zobrazuji poslední snapshot
          {cachedAt ? ` z ${new Date(cachedAt).toLocaleString("cs-CZ")}` : ""}. Mutace jsou vypnuté.
        </div>
      )}
      {error && <div className="card p-4 text-[var(--danger)]">{error}</div>}
      {okMsg && <div className="card p-4 text-[var(--ok)]">{okMsg}</div>}

      {data && (
        <HomeOverview
          portfolio={data.portfolio || []}
          tips={data.tips || []}
          alertsUnread={data.alerts_unread || 0}
          briefingCs={data.briefing_cs}
          briefingTitle={data.briefing_title}
          briefingAt={data.briefing_at}
          tipStats={data.tip_stats}
          equity={data.equity}
          onGenerateBriefing={offline ? undefined : () => void generateBriefing()}
          briefingBusy={briefingBusy}
        />
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card p-5 rise">
          <div className="flex items-center justify-between mb-3">
            <h2 className="display text-2xl">Portfolio</h2>
            <Link href="/portfolio" className="btn text-xs px-2 py-1">
              Spravovat
            </Link>
          </div>
          <div>
            {(data?.portfolio || []).length === 0 && (
              <p className="muted text-sm mb-3">
                Zatím prázdné —{" "}
                <Link href="/portfolio" className="text-[var(--accent)]">
                  přidej pozice
                </Link>
                .
              </p>
            )}
            {(data?.portfolio || []).slice(0, 6).map((p) => (
              <PositionRow key={p.id} p={p} />
            ))}
            {(data?.portfolio || []).length > 6 && (
              <Link href="/portfolio" className="muted text-sm mt-2 inline-block">
                +{(data?.portfolio.length || 0) - 6} dalších →
              </Link>
            )}
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="display text-2xl rise">Top tipy dne</h2>
            <Link href="/tips" className="btn text-xs px-2 py-1">
              Historie / TP·SL
            </Link>
          </div>
          {(data?.tips || []).length === 0 && (
            <div className="card p-5 muted">Žádné tipy — spusť přepočet nebo doplň watchlist.</div>
          )}
          {(data?.tips || []).map((tip) => (
            <TipCard
              key={tip.id}
              tip={tip}
              busy={tipBusy}
              offline={offline}
              onLifecycle={onLifecycle}
              onPaper={onPaper}
              onJournal={onJournal}
            />
          ))}
        </section>
      </div>
    </div>
  );
}
