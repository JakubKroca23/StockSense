"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { SymbolAutocomplete } from "@/components/SymbolAutocomplete";
import { AssetClass, Watchlist } from "@/lib/types";

export default function WatchlistPage() {
  const [lists, setLists] = useState<Watchlist[]>([]);
  const [symbol, setSymbol] = useState("");
  const [assetClass, setAssetClass] = useState<AssetClass>("stock");
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const data = await apiFetch<Watchlist[]>("/watchlists");
    setLists(data);
  }

  useEffect(() => {
    load().catch((err) => setError(err.message));
  }, []);

  async function addItem(e: FormEvent) {
    e.preventDefault();
    const wl = lists[0];
    if (!wl) return;
    try {
      await apiFetch(`/watchlists/${wl.id}/items`, {
        method: "POST",
        body: JSON.stringify({ symbol, asset_class: assetClass }),
      });
      setSymbol("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Chyba");
    }
  }

  async function removeItem(watchlistId: number, itemId: number) {
    await apiFetch(`/watchlists/${watchlistId}/items/${itemId}`, { method: "DELETE" });
    await load();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="display text-3xl">Watchlist</h1>
        <p className="muted">Universe pro scoring spolu s portfoliem a discovery setem.</p>
      </div>
      {error && <div className="card p-4 text-[var(--danger)]">{error}</div>}
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
        <button className="btn btn-primary">Přidat</button>
      </form>
      {lists.map((wl) => (
        <section key={wl.id} className="card p-4">
          <h2 className="font-semibold mb-3">{wl.name}</h2>
          <div className="divide-y divide-[var(--line)]">
            {wl.items.length === 0 && <p className="muted text-sm py-2">Prázdný watchlist</p>}
            {wl.items.map((item) => (
              <div key={item.id} className="flex items-center justify-between py-3">
                <Link href={`/instrument/${item.instrument.symbol}`} className="hover:text-[var(--accent)]">
                  <div className="font-medium">{item.instrument.symbol}</div>
                  <div className="muted text-xs">{item.instrument.asset_class}</div>
                </Link>
                <button className="btn" onClick={() => removeItem(wl.id, item.id)}>Odebrat</button>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
