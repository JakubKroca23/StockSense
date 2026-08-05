"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import {
  HomeData,
  PortfolioPosition,
  Tip,
  actionLabel,
  horizonLabel,
  riskLabel,
} from "@/lib/types";

function TipCard({ tip }: { tip: Tip }) {
  return (
    <Link href={`/instrument/${tip.instrument.symbol}`} className="card p-4 block rise hover:border-[var(--accent)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-lg">{tip.instrument.symbol}</h3>
            <span className={`badge ${tip.action}`}>{actionLabel[tip.action]}</span>
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
        <span className="badge">DQ {tip.data_quality}</span>
        {tip.suggested_size_pct != null && (
          <span className="badge">size {tip.suggested_size_pct}%</span>
        )}
      </div>
      {tip.narrative_cs && (
        <p className="mt-3 text-sm leading-relaxed line-clamp-3">{tip.narrative_cs}</p>
      )}
      <div className="mt-3 grid grid-cols-3 gap-2 text-xs muted">
        <div>Entry {tip.entry_low?.toFixed(2)}–{tip.entry_high?.toFixed(2)}</div>
        <div>Stop {tip.stop?.toFixed(2)}</div>
        <div>TP {tip.target_1?.toFixed(2)}</div>
      </div>
    </Link>
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
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const home = await apiFetch<HomeData>("/home");
      setData(home);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Chyba načtení");
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function runScoring() {
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
        <button className="btn btn-primary" onClick={runScoring} disabled={busy}>
          {busy ? "Počítám…" : "Přepočítat tipy"}
        </button>
      </section>

      {error && <div className="card p-4 text-[var(--danger)]">{error}</div>}

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
          <h2 className="display text-2xl rise">Top tipy dne</h2>
          {(data?.tips || []).length === 0 && (
            <div className="card p-5 muted">Žádné tipy — spusť přepočet nebo doplň watchlist.</div>
          )}
          {(data?.tips || []).map((tip) => (
            <TipCard key={tip.id} tip={tip} />
          ))}
        </section>
      </div>
    </div>
  );
}
