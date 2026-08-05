"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { SymbolAutocomplete } from "@/components/SymbolAutocomplete";
import { AssetClass, Tip, Watchlist, actionLabel } from "@/lib/types";

interface DigestItem {
  item_id: number;
  watchlist_id: number;
  symbol: string;
  name: string;
  asset_class: AssetClass;
  price: number | null;
  change_pct: number | null;
  tip: Tip | null;
  flags: string[];
}

interface Digest {
  digest_cs: string;
  movers: DigestItem[];
  as_of: string;
}

export default function WatchlistPage() {
  const [lists, setLists] = useState<Watchlist[]>([]);
  const [digest, setDigest] = useState<Digest | null>(null);
  const [symbol, setSymbol] = useState("");
  const [assetClass, setAssetClass] = useState<AssetClass>("stock");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const [data, dig] = await Promise.all([
      apiFetch<Watchlist[]>("/watchlists"),
      apiFetch<Digest>("/watchlists/digest"),
    ]);
    setLists(data);
    setDigest(dig);
  }

  useEffect(() => {
    load().catch((err) => setError(err.message));
  }, []);

  async function addItem(e: FormEvent) {
    e.preventDefault();
    const wl = lists[0];
    if (!wl) return;
    setBusy(true);
    try {
      await apiFetch(`/watchlists/${wl.id}/items`, {
        method: "POST",
        body: JSON.stringify({ symbol, asset_class: assetClass }),
      });
      setSymbol("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Chyba");
    } finally {
      setBusy(false);
    }
  }

  async function removeItem(watchlistId: number, itemId: number) {
    await apiFetch(`/watchlists/${watchlistId}/items/${itemId}`, { method: "DELETE" });
    await load();
  }

  const bySymbol = new Map((digest?.movers || []).map((m) => [m.symbol, m]));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="display text-3xl">Watchlist</h1>
        <p className="muted">Sense digest sledovaných — co se dnes hýbe.</p>
      </div>
      {error && <div className="card p-4 text-[var(--danger)]">{error}</div>}

      {digest && (
        <section className="card p-5 space-y-3 rise">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="display text-2xl">Sense digest</h2>
            <span className="muted text-xs">
              {new Date(digest.as_of).toLocaleString("cs-CZ")}
            </span>
          </div>
          <p className="leading-relaxed">{digest.digest_cs}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {(digest.movers || [])
              .filter((m) => (m.change_pct != null && Math.abs(m.change_pct) >= 1) || m.tip)
              .slice(0, 8)
              .map((m) => {
                const ch = m.change_pct;
                return (
                  <Link
                    key={`${m.watchlist_id}-${m.item_id}`}
                    href={`/instrument/${m.symbol}`}
                    className="card p-3 hover:border-[var(--accent)]"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-semibold">{m.symbol}</div>
                        <div className="muted text-xs">{m.name || m.asset_class}</div>
                      </div>
                      <div
                        className={`text-sm font-medium ${
                          ch != null && ch >= 0 ? "text-[var(--ok)]" : "text-[var(--danger)]"
                        }`}
                      >
                        {ch != null ? `${ch >= 0 ? "+" : ""}${ch.toFixed(2)}%` : "—"}
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1 text-xs">
                      {m.price != null && <span className="badge">{m.price.toFixed(2)}</span>}
                      {m.tip && (
                        <span className={`badge ${m.tip.action}`}>
                          {actionLabel[m.tip.action]} {m.tip.score.toFixed(0)}
                        </span>
                      )}
                      {m.flags
                        .filter((f) => f.startsWith("near_") || f === "rally" || f === "selloff")
                        .map((f) => (
                          <span key={f} className="badge">
                            {f}
                          </span>
                        ))}
                    </div>
                  </Link>
                );
              })}
          </div>
        </section>
      )}

      <form onSubmit={addItem} className="card p-4 grid gap-2 sm:grid-cols-[1fr_160px_auto]">
        <SymbolAutocomplete
          value={symbol}
          onChange={(sym, suggestion) => {
            setSymbol(sym);
            if (suggestion?.asset_class) {
              setAssetClass(suggestion.asset_class as AssetClass);
            }
          }}
          required
        />
        <select className="input" value={assetClass} onChange={(e) => setAssetClass(e.target.value as AssetClass)}>
          <option value="stock">Akcie</option>
          <option value="etf">ETF</option>
          <option value="crypto">Crypto</option>
          <option value="commodity">Komodita</option>
        </select>
        <button className="btn btn-primary" disabled={busy}>
          {busy ? "…" : "Přidat"}
        </button>
      </form>
      {lists.map((wl) => (
        <section key={wl.id} className="card p-4">
          <h2 className="font-semibold mb-3">{wl.name}</h2>
          <div className="divide-y divide-[var(--line)]">
            {wl.items.length === 0 && <p className="muted text-sm py-2">Prázdný watchlist</p>}
            {wl.items.map((item) => {
              const m = bySymbol.get(item.instrument.symbol);
              const ch = m?.change_pct;
              return (
                <div key={item.id} className="flex items-center justify-between gap-3 py-3">
                  <Link
                    href={`/instrument/${item.instrument.symbol}`}
                    className="min-w-0 hover:text-[var(--accent)]"
                  >
                    <div className="font-medium flex flex-wrap items-center gap-2">
                      {item.instrument.symbol}
                      {m?.tip && (
                        <span className={`badge ${m.tip.action}`}>{actionLabel[m.tip.action]}</span>
                      )}
                    </div>
                    <div className="muted text-xs">
                      {item.instrument.asset_class}
                      {m?.price != null ? ` · ${m.price.toFixed(2)}` : ""}
                      {ch != null ? ` · ${ch >= 0 ? "+" : ""}${ch.toFixed(2)}%` : ""}
                    </div>
                  </Link>
                  <div className="flex items-center gap-2 shrink-0">
                    <Link
                      href={`/chat?symbol=${encodeURIComponent(item.instrument.symbol)}&prompt=pre-zaver&fresh=1`}
                      className="btn text-xs px-2 py-1"
                    >
                      Sense
                    </Link>
                    <button className="btn" onClick={() => removeItem(wl.id, item.id)}>
                      Odebrat
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
