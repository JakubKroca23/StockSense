"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { DataQualityBadge } from "@/components/DataQualityBadge";
import {
  FeedbackResult,
  Tip,
  TipStatus,
  actionLabel,
  horizonLabel,
  tipStatusLabel,
} from "@/lib/types";

export function TipCard({
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
