"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import { SymbolAutocomplete } from "@/components/SymbolAutocomplete";
import { PortfolioPosition } from "@/lib/types";

type EditState = {
  id: number;
  quantity: string;
  avg_cost: string;
  is_paper: boolean;
  notes: string;
};

export default function PortfolioPage() {
  const [positions, setPositions] = useState<PortfolioPosition[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [symbol, setSymbol] = useState("");
  const [qty, setQty] = useState("1");
  const [cost, setCost] = useState("");
  const [paper, setPaper] = useState(false);
  const [notes, setNotes] = useState("");
  const [editing, setEditing] = useState<EditState | null>(null);

  async function load() {
    try {
      const rows = await apiFetch<PortfolioPosition[]>("/portfolio");
      setPositions(rows);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Chyba načtení");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const totals = useMemo(() => {
    let value = 0;
    let costBasis = 0;
    for (const p of positions) {
      const q = Number(p.quantity);
      const c = Number(p.avg_cost);
      costBasis += q * c;
      if (p.market_value != null) value += p.market_value;
      else if (p.last_price != null) value += q * p.last_price;
    }
    const pnl = value - costBasis;
    const pnlPct = costBasis ? (pnl / costBasis) * 100 : 0;
    return { value, costBasis, pnl, pnlPct };
  }, [positions]);

  async function addPosition(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await apiFetch("/portfolio", {
        method: "POST",
        body: JSON.stringify({
          symbol,
          quantity: Number(qty),
          avg_cost: Number(cost),
          is_paper: paper,
          notes: notes || null,
        }),
      });
      setSymbol("");
      setCost("");
      setNotes("");
      setQty("1");
      setPaper(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Uložení selhalo");
    } finally {
      setBusy(false);
    }
  }

  function startEdit(p: PortfolioPosition) {
    setEditing({
      id: p.id,
      quantity: String(p.quantity),
      avg_cost: String(p.avg_cost),
      is_paper: p.is_paper,
      notes: p.notes || "",
    });
  }

  async function saveEdit(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setBusy(true);
    try {
      await apiFetch(`/portfolio/${editing.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          quantity: Number(editing.quantity),
          avg_cost: Number(editing.avg_cost),
          is_paper: editing.is_paper,
          notes: editing.notes || null,
        }),
      });
      setEditing(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Úprava selhala");
    } finally {
      setBusy(false);
    }
  }

  async function removePosition(id: number, symbolLabel: string) {
    if (!window.confirm(`Smazat pozici ${symbolLabel}?`)) return;
    setBusy(true);
    try {
      await apiFetch(`/portfolio/${id}`, { method: "DELETE" });
      if (editing?.id === id) setEditing(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Smazání selhalo");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="display text-3xl">Portfolio</h1>
          <p className="muted mt-1">Ruční evidence pozic — upravuj a maž podle potřeby.</p>
        </div>
      </section>

      {error && <div className="card p-4 text-[var(--danger)]">{error}</div>}

      <section className="grid gap-3 sm:grid-cols-3">
        <div className="card p-4">
          <p className="muted text-xs uppercase tracking-wide">Tržní hodnota</p>
          <p className="text-2xl font-semibold mt-1">
            {totals.value ? totals.value.toFixed(2) : "—"}
          </p>
        </div>
        <div className="card p-4">
          <p className="muted text-xs uppercase tracking-wide">Náklady</p>
          <p className="text-2xl font-semibold mt-1">
            {totals.costBasis ? totals.costBasis.toFixed(2) : "—"}
          </p>
        </div>
        <div className="card p-4">
          <p className="muted text-xs uppercase tracking-wide">PnL</p>
          <p
            className={`text-2xl font-semibold mt-1 ${
              totals.pnl >= 0 ? "text-[var(--ok)]" : "text-[var(--danger)]"
            }`}
          >
            {totals.costBasis
              ? `${totals.pnl >= 0 ? "+" : ""}${totals.pnl.toFixed(2)} (${totals.pnlPct.toFixed(1)}%)`
              : "—"}
          </p>
        </div>
      </section>

      <section className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="portfolio-table">
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Qty</th>
                <th>Avg cost</th>
                <th>Cena</th>
                <th>Hodnota</th>
                <th>PnL</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {positions.length === 0 && (
                <tr>
                  <td colSpan={7} className="muted text-sm py-6 text-center">
                    Zatím prázdné — přidej první pozici níže.
                  </td>
                </tr>
              )}
              {positions.map((p) => {
                const pnl = p.pnl ?? 0;
                const isEditing = editing?.id === p.id;
                return (
                  <tr key={p.id} className={isEditing ? "is-editing" : ""}>
                    <td>
                      <Link
                        href={`/instrument/${p.instrument.symbol}`}
                        className="font-semibold hover:text-[var(--accent)]"
                      >
                        {p.instrument.symbol}
                      </Link>
                      {p.is_paper && <span className="badge ml-2">paper</span>}
                      {p.notes && <div className="muted text-xs mt-0.5">{p.notes}</div>}
                    </td>
                    <td>{Number(p.quantity)}</td>
                    <td>{Number(p.avg_cost).toFixed(2)}</td>
                    <td>{p.last_price != null ? p.last_price.toFixed(2) : "—"}</td>
                    <td>{p.market_value != null ? p.market_value.toFixed(2) : "—"}</td>
                    <td className={pnl >= 0 ? "text-[var(--ok)]" : "text-[var(--danger)]"}>
                      {p.pnl != null
                        ? `${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)} (${p.pnl_pct?.toFixed(1)}%)`
                        : "—"}
                    </td>
                    <td>
                      <div className="flex gap-1 justify-end">
                        <button
                          type="button"
                          className="btn text-xs px-2 py-1"
                          disabled={busy}
                          onClick={() => startEdit(p)}
                        >
                          Upravit
                        </button>
                        <button
                          type="button"
                          className="btn text-xs px-2 py-1 text-[var(--danger)]"
                          disabled={busy}
                          onClick={() => void removePosition(p.id, p.instrument.symbol)}
                        >
                          Smazat
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {editing && (
          <form onSubmit={saveEdit} className="border-t border-[var(--line)] p-4 grid gap-2 sm:grid-cols-5">
            <input
              className="input"
              type="number"
              step="any"
              placeholder="Qty"
              value={editing.quantity}
              onChange={(e) => setEditing({ ...editing, quantity: e.target.value })}
              required
            />
            <input
              className="input"
              type="number"
              step="any"
              placeholder="Avg cost"
              value={editing.avg_cost}
              onChange={(e) => setEditing({ ...editing, avg_cost: e.target.value })}
              required
            />
            <input
              className="input"
              placeholder="Poznámka"
              value={editing.notes}
              onChange={(e) => setEditing({ ...editing, notes: e.target.value })}
            />
            <label className="flex items-center gap-2 text-sm px-2">
              <input
                type="checkbox"
                checked={editing.is_paper}
                onChange={(e) => setEditing({ ...editing, is_paper: e.target.checked })}
              />
              Paper
            </label>
            <div className="flex gap-2">
              <button className="btn btn-primary flex-1" disabled={busy}>
                Uložit
              </button>
              <button type="button" className="btn" onClick={() => setEditing(null)}>
                Zrušit
              </button>
            </div>
          </form>
        )}
      </section>

      <section className="card p-5">
        <h2 className="display text-xl mb-3">Přidat pozici</h2>
        <form onSubmit={addPosition} className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
          <SymbolAutocomplete value={symbol} onChange={setSymbol} required placeholder="Symbol" />
          <input
            className="input"
            placeholder="Qty"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            required
          />
          <input
            className="input"
            placeholder="Avg cost"
            value={cost}
            onChange={(e) => setCost(e.target.value)}
            required
          />
          <input
            className="input"
            placeholder="Poznámka"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
          <label className="flex items-center gap-2 text-sm px-2">
            <input type="checkbox" checked={paper} onChange={(e) => setPaper(e.target.checked)} />
            Paper trade
          </label>
          <button className="btn btn-primary" disabled={busy}>
            Přidat
          </button>
        </form>
      </section>
    </div>
  );
}
