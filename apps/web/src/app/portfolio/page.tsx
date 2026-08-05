"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import { SymbolAutocomplete, SymbolSuggestion } from "@/components/SymbolAutocomplete";
import { PortfolioPosition, UserSettings } from "@/lib/types";

type DisplayCurrency = "USD" | "EUR" | "CZK";

type FxRates = {
  base: string;
  rates: Record<string, number>;
  as_of?: string;
};

type EditState = {
  id: number;
  quantity: string;
  avg_cost: string;
  is_paper: boolean;
  notes: string;
  currency: string;
};

const DISPLAY_CURRENCIES: DisplayCurrency[] = ["USD", "EUR", "CZK"];

function nativeCcy(p: PortfolioPosition): string {
  return (p.instrument.currency || "USD").toUpperCase();
}

function convert(amount: number, from: string, to: string, rates: Record<string, number>): number {
  const src = (from || "USD").toUpperCase();
  const dst = (to || "USD").toUpperCase();
  if (src === dst) return amount;
  const rSrc = rates[src] ?? 1;
  const rDst = rates[dst] ?? 1;
  return (amount / rSrc) * rDst;
}

function fmt(amount: number | null | undefined, ccy: string, digits = 2): string {
  if (amount == null || Number.isNaN(amount)) return "—";
  return `${amount.toFixed(digits)} ${ccy}`;
}

export default function PortfolioPage() {
  const [positions, setPositions] = useState<PortfolioPosition[]>([]);
  const [rates, setRates] = useState<Record<string, number>>({ USD: 1, EUR: 0.92, CZK: 23 });
  const [displayCcy, setDisplayCcy] = useState<DisplayCurrency>("USD");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [symbol, setSymbol] = useState("");
  const [entryCcy, setEntryCcy] = useState("USD");
  const [qty, setQty] = useState("1");
  const [cost, setCost] = useState("");
  const [paper, setPaper] = useState(false);
  const [notes, setNotes] = useState("");
  const [editing, setEditing] = useState<EditState | null>(null);

  const load = useCallback(async () => {
    try {
      const [rows, settings, fx] = await Promise.all([
        apiFetch<PortfolioPosition[]>("/portfolio"),
        apiFetch<UserSettings>("/settings"),
        apiFetch<FxRates>("/fx/rates").catch(() => null),
      ]);
      setPositions(rows);
      const pref = String(settings.preferences?.display_currency || "USD").toUpperCase();
      if (pref === "USD" || pref === "EUR" || pref === "CZK") {
        setDisplayCcy(pref);
      }
      if (fx?.rates) setRates({ USD: 1, ...fx.rates });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Chyba načtení");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function setCurrency(ccy: DisplayCurrency) {
    setDisplayCcy(ccy);
    try {
      await apiFetch<UserSettings>("/settings", {
        method: "PATCH",
        body: JSON.stringify({ preferences: { display_currency: ccy } }),
      });
    } catch {
      /* keep local selection */
    }
  }

  const totals = useMemo(() => {
    let value = 0;
    let costBasis = 0;
    for (const p of positions) {
      const q = Number(p.quantity);
      const c = Number(p.avg_cost);
      const ccy = nativeCcy(p);
      costBasis += convert(q * c, ccy, displayCcy, rates);
      const mvNative =
        p.market_value != null
          ? p.market_value
          : p.last_price != null
            ? q * p.last_price
            : null;
      if (mvNative != null) value += convert(mvNative, ccy, displayCcy, rates);
    }
    const pnl = value - costBasis;
    const pnlPct = costBasis ? (pnl / costBasis) * 100 : 0;
    return { value, costBasis, pnl, pnlPct };
  }, [positions, displayCcy, rates]);

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
      setEntryCcy("USD");
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
      currency: nativeCcy(p),
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

  function onSymbolChange(sym: string, suggestion?: SymbolSuggestion) {
    setSymbol(sym);
    if (suggestion?.currency) {
      setEntryCcy(String(suggestion.currency).toUpperCase());
    }
  }

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="display text-3xl">Portfolio</h1>
          <p className="muted mt-1">
            Ceny pozic zadávej v podkladové měně instrumentu. Součty v {displayCcy}. Export pro Excel/daně.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn"
            onClick={() => {
              void import("@/lib/csv").then(({ downloadApiCsv }) =>
                downloadApiCsv("/export/portfolio.csv", "stocksense-portfolio.csv").catch((err) =>
                  setError(err instanceof Error ? err.message : "Export selhal")
                )
              );
            }}
          >
            Export CSV
          </button>
          <div className="currency-switch" role="group" aria-label="Měna portfolia">
            {DISPLAY_CURRENCIES.map((ccy) => (
              <button
                key={ccy}
                type="button"
                className={`currency-switch__btn ${displayCcy === ccy ? "is-active" : ""}`}
                onClick={() => void setCurrency(ccy)}
              >
                {ccy === "USD" ? "$ USD" : ccy === "EUR" ? "€ EUR" : "Kč CZK"}
              </button>
            ))}
          </div>
        </div>
      </section>

      {error && <div className="card p-4 text-[var(--danger)]">{error}</div>}

      <section className="grid gap-3 sm:grid-cols-3">
        <div className="card p-4">
          <p className="muted text-xs uppercase tracking-wide">Tržní hodnota ({displayCcy})</p>
          <p className="text-2xl font-semibold mt-1">{fmt(totals.value || null, displayCcy)}</p>
        </div>
        <div className="card p-4">
          <p className="muted text-xs uppercase tracking-wide">Náklady ({displayCcy})</p>
          <p className="text-2xl font-semibold mt-1">{fmt(totals.costBasis || null, displayCcy)}</p>
        </div>
        <div className="card p-4">
          <p className="muted text-xs uppercase tracking-wide">PnL ({displayCcy})</p>
          <p
            className={`text-2xl font-semibold mt-1 ${
              totals.pnl >= 0 ? "text-[var(--ok)]" : "text-[var(--danger)]"
            }`}
          >
            {totals.costBasis
              ? `${totals.pnl >= 0 ? "+" : ""}${fmt(totals.pnl, displayCcy)} (${totals.pnlPct.toFixed(1)}%)`
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
                <th>Měna</th>
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
                  <td colSpan={8} className="muted text-sm py-6 text-center">
                    Zatím prázdné — přidej první pozici níže.
                  </td>
                </tr>
              )}
              {positions.map((p) => {
                const pnl = p.pnl ?? 0;
                const ccy = nativeCcy(p);
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
                    <td>
                      <span className="badge">{ccy}</span>
                    </td>
                    <td>{Number(p.quantity)}</td>
                    <td>{fmt(Number(p.avg_cost), ccy)}</td>
                    <td>{fmt(p.last_price, ccy)}</td>
                    <td>{fmt(p.market_value, ccy)}</td>
                    <td className={pnl >= 0 ? "text-[var(--ok)]" : "text-[var(--danger)]"}>
                      {p.pnl != null
                        ? `${pnl >= 0 ? "+" : ""}${fmt(pnl, ccy)} (${p.pnl_pct?.toFixed(1)}%)`
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
            <div className="relative">
              <input
                className="input pr-14"
                type="number"
                step="any"
                placeholder={`Avg cost (${editing.currency})`}
                value={editing.avg_cost}
                onChange={(e) => setEditing({ ...editing, avg_cost: e.target.value })}
                required
              />
              <span className="input-ccy">{editing.currency}</span>
            </div>
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
            <p className="sm:col-span-5 muted text-xs">
              Avg cost zadávej v podkladové měně pozice ({editing.currency}).
            </p>
          </form>
        )}
      </section>

      <section className="card p-5">
        <h2 className="display text-xl mb-3">Přidat pozici</h2>
        <form onSubmit={addPosition} className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
          <SymbolAutocomplete
            value={symbol}
            onChange={onSymbolChange}
            required
            placeholder="Symbol"
          />
          <input
            className="input"
            placeholder="Qty"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            required
          />
          <div className="relative">
            <input
              className="input pr-14"
              placeholder={`Avg cost (${entryCcy})`}
              value={cost}
              onChange={(e) => setCost(e.target.value)}
              required
            />
            <span className="input-ccy">{entryCcy}</span>
          </div>
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
        <p className="muted text-xs mt-2">
          Cenu vždy zadávej v měně instrumentu
          {symbol ? ` (${entryCcy})` : ""} — ne v měně zobrazení portfolia.
        </p>
      </section>
    </div>
  );
}
