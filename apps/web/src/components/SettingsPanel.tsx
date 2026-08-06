"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { RiskProfile, UserSettings, riskLabel } from "@/lib/types";

type SystemStats = {
  as_of: string;
  environment: string;
  uptime_human: string;
  uptime_seconds: number;
  host: { python: string; system: string; machine: string };
  process: {
    rss_human: string;
    vms_human: string;
    rss_bytes: number | null;
    pid: number;
  };
  database: { name: string | null; size_human: string; size_bytes: number | null };
  highlights: {
    price_bars_rows: number;
    price_bars_size: string;
    instruments: number;
    chat_messages: number;
    tables_total_human: string;
  };
  tables: {
    name: string;
    rows: number;
    total_human: string;
    total_bytes: number;
  }[];
  crypto: {
    exchanges?: string[];
    execution_exchange?: string;
    chart_mode?: string;
    error?: string;
  };
  llm: {
    provider?: string;
    ollama_model: string | null;
    cloud_provider: string;
    scheduler: boolean;
    tip_scoring: boolean;
  };
};

const CURRENCIES = ["USD", "EUR", "CZK"] as const;

type Props = {
  open: boolean;
  onClose: () => void;
};

export function SettingsPanel({ open, onClose }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [currency, setCurrency] = useState("USD");
  const [risk, setRisk] = useState<RiskProfile>("balanced");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [s, st] = await Promise.all([
        apiFetch<UserSettings>("/settings"),
        apiFetch<SystemStats>("/system/stats"),
      ]);
      setSettings(s);
      setStats(st);
      setCurrency(String(s.preferences?.display_currency || "USD").toUpperCase());
      setRisk(s.risk_profile);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Načtení selhalo");
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onPointer = (e: PointerEvent) => {
      const el = panelRef.current;
      if (!el) return;
      const t = e.target;
      if (!(t instanceof Node)) return;
      if (el.contains(t)) return;
      if (t instanceof Element && t.closest(".settings-gear")) return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  async function onSave(e: FormEvent) {
    e.preventDefault();
    if (!settings) return;
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const updated = await apiFetch<UserSettings>("/settings", {
        method: "PATCH",
        body: JSON.stringify({
          risk_profile: risk,
          preferences: {
            ...(settings.preferences || {}),
            display_currency: currency,
          },
        }),
      });
      setSettings(updated);
      setMessage("Uloženo");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Uložení selhalo");
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div className="settings-modal" role="dialog" aria-modal="true" aria-label="Nastavení">
      <button type="button" className="settings-modal__backdrop" aria-label="Zavřít" onClick={onClose} />
      <div ref={panelRef} className="settings-modal__panel card">
        <header className="settings-modal__head">
          <div>
            <p className="settings-modal__title">Nastavení</p>
            <p className="muted text-xs">Server · data · preference</p>
          </div>
          <button type="button" className="settings-modal__close" onClick={onClose} aria-label="Zavřít">
            ✕
          </button>
        </header>

        <div className="settings-modal__body">
          {error && <p className="text-[var(--danger)] text-sm mb-3">{error}</p>}

          <section className="settings-modal__section">
            <div className="settings-modal__section-head">
              <h2>Server &amp; data</h2>
              <button type="button" className="chart-chip chart-chip--soft" onClick={() => void load()}>
                ↻
              </button>
            </div>

            {!stats ? (
              <p className="muted text-sm">Načítám statistiky…</p>
            ) : (
              <>
                <div className="settings-stats">
                  <div className="settings-stat">
                    <span className="settings-stat__label">RAM procesu</span>
                    <span className="settings-stat__value">{stats.process.rss_human}</span>
                  </div>
                  <div className="settings-stat">
                    <span className="settings-stat__label">DB celkem</span>
                    <span className="settings-stat__value">{stats.database.size_human}</span>
                  </div>
                  <div className="settings-stat">
                    <span className="settings-stat__label">price_bars</span>
                    <span className="settings-stat__value">
                      {stats.highlights.price_bars_rows.toLocaleString("cs-CZ")}
                      <span className="muted text-xs font-normal">
                        {" "}
                        · {stats.highlights.price_bars_size}
                      </span>
                    </span>
                  </div>
                  <div className="settings-stat">
                    <span className="settings-stat__label">Uptime</span>
                    <span className="settings-stat__value">{stats.uptime_human}</span>
                  </div>
                  <div className="settings-stat">
                    <span className="settings-stat__label">Instrumenty</span>
                    <span className="settings-stat__value">
                      {stats.highlights.instruments.toLocaleString("cs-CZ")}
                    </span>
                  </div>
                  <div className="settings-stat">
                    <span className="settings-stat__label">Chat zprávy</span>
                    <span className="settings-stat__value">
                      {stats.highlights.chat_messages.toLocaleString("cs-CZ")}
                    </span>
                  </div>
                </div>

                <div className="settings-meta muted text-xs">
                  <span>{stats.environment}</span>
                  <span>·</span>
                  <span>
                    {stats.host.system} {stats.host.machine}
                  </span>
                  <span>·</span>
                  <span>Python {stats.host.python}</span>
                  <span>·</span>
                  <span>pid {stats.process.pid}</span>
                </div>

                <div className="settings-meta muted text-xs mt-1">
                  <span>
                    Crypto: {(stats.crypto.exchanges || []).join(" + ") || "—"}
                    {stats.crypto.execution_exchange
                      ? ` · exec ${stats.crypto.execution_exchange}`
                      : ""}
                  </span>
                  <span>·</span>
                  <span>LLM Gemini</span>
                </div>

                {stats.tables.length > 0 && (
                  <div className="settings-tables">
                    <p className="settings-tables__title muted">Tabulky (velikost na disku)</p>
                    <ul>
                      {stats.tables.slice(0, 10).map((t) => (
                        <li key={t.name}>
                          <span className="settings-tables__name">{t.name}</span>
                          <span className="settings-tables__rows">
                            {t.rows.toLocaleString("cs-CZ")}
                          </span>
                          <span className="settings-tables__size">{t.total_human}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          </section>

          <section className="settings-modal__section">
            <h2>Preference</h2>
            <form className="settings-form" onSubmit={onSave}>
              <label className="block space-y-1">
                <span className="text-sm muted">Zobrazená měna</span>
                <select
                  className="input"
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  disabled={!settings}
                >
                  {CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block space-y-1">
                <span className="text-sm muted">Risk profil</span>
                <select
                  className="input"
                  value={risk}
                  onChange={(e) => setRisk(e.target.value as RiskProfile)}
                  disabled={!settings}
                >
                  {(Object.keys(riskLabel) as RiskProfile[]).map((k) => (
                    <option key={k} value={k}>
                      {riskLabel[k]}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button className="btn btn-primary" type="submit" disabled={busy || !settings}>
                  {busy ? "Ukládám…" : "Uložit"}
                </button>
                {message && <span className="text-[var(--ok)] text-sm">{message}</span>}
              </div>
            </form>
          </section>
        </div>
      </div>
    </div>
  );
}
