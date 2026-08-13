"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { RiskProfile, UserSettings, riskLabel } from "@/lib/types";
import { IconClose, IconSettings } from "@/components/NavIcons";
import { getStoredTheme } from "@/lib/theme";

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
const RISKS = Object.keys(riskLabel) as RiskProfile[];

function fmtNum(n: number | null | undefined) {
  return (n ?? 0).toLocaleString("cs-CZ");
}

function StatusDot({ on }: { on: boolean }) {
  return <span className={`settings-dot ${on ? "is-on" : "is-off"}`} aria-hidden />;
}

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
            theme: getStoredTheme(),
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
      <div ref={panelRef} className="settings-modal__panel">
        <div className="settings-modal__handle" aria-hidden />
        <header className="settings-modal__head">
          <div className="settings-modal__brand">
            <span className="settings-modal__icon">
              <IconSettings size={18} />
            </span>
            <div>
              <p className="settings-modal__title">Nastavení</p>
              <p className="settings-modal__kicker">Preference · server</p>
            </div>
          </div>
          <button type="button" className="settings-modal__close" onClick={onClose} aria-label="Zavřít">
            <IconClose size={18} />
          </button>
        </header>

        {stats && (
          <div className="settings-pills">
            <span className="settings-pill">
              <StatusDot on={stats.environment === "production"} />
              {stats.environment}
            </span>
            <span className="settings-pill">↑ {stats.uptime_human}</span>
            <span className="settings-pill">Gemini</span>
          </div>
        )}

        <div className="settings-modal__body">
          {error && <p className="settings-alert">{error}</p>}

          <section className="settings-block">
            <div className="settings-block__head">
              <div>
                <h2>Preference</h2>
                <p className="settings-block__sub">Zobrazení a rizikový profil</p>
              </div>
            </div>
            <form className="settings-form" onSubmit={onSave}>
              <div className="settings-field">
                <span className="settings-field__label">Měna</span>
                <div className="settings-seg" role="group" aria-label="Zobrazená měna">
                  {CURRENCIES.map((c) => (
                    <button
                      key={c}
                      type="button"
                      className={currency === c ? "is-active" : ""}
                      onClick={() => setCurrency(c)}
                      disabled={!settings}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </div>
              <div className="settings-field">
                <span className="settings-field__label">Risk profil</span>
                <div className="settings-seg" role="group" aria-label="Risk profil">
                  {RISKS.map((k) => (
                    <button
                      key={k}
                      type="button"
                      className={risk === k ? "is-active" : ""}
                      onClick={() => setRisk(k)}
                      disabled={!settings}
                    >
                      {riskLabel[k]}
                    </button>
                  ))}
                </div>
              </div>
              <div className="settings-actions">
                <button className="btn btn-primary settings-btn" type="submit" disabled={busy || !settings}>
                  {busy ? "Ukládám…" : "Uložit"}
                </button>
                {message && <span className="settings-ok">{message}</span>}
              </div>
            </form>
          </section>

          <section className="settings-block">
            <div className="settings-block__head">
              <div>
                <h2>Server &amp; data</h2>
                <p className="settings-block__sub">Paměť, databáze, trhy</p>
              </div>
              <button type="button" className="settings-icon-btn" onClick={() => void load()} aria-label="Obnovit">
                ↻
              </button>
            </div>

            {!stats ? (
              <p className="muted text-sm">Načítám statistiky…</p>
            ) : (
              <>
                <div className="settings-stats">
                  <div className="settings-stat">
                    <span className="settings-stat__label">RAM</span>
                    <span className="settings-stat__value">{stats.process.rss_human}</span>
                    <span className="settings-stat__hint">proces API</span>
                  </div>
                  <div className="settings-stat">
                    <span className="settings-stat__label">Databáze</span>
                    <span className="settings-stat__value">{stats.database.size_human}</span>
                    <span className="settings-stat__hint">{stats.highlights.tables_total_human} tabulek</span>
                  </div>
                  <div className="settings-stat">
                    <span className="settings-stat__label">Uptime</span>
                    <span className="settings-stat__value">{stats.uptime_human}</span>
                    <span className="settings-stat__hint">{stats.host.system} {stats.host.machine}</span>
                  </div>
                  <div className="settings-stat">
                    <span className="settings-stat__label">Price bars</span>
                    <span className="settings-stat__value">{fmtNum(stats.highlights.price_bars_rows)}</span>
                    <span className="settings-stat__hint">{stats.highlights.price_bars_size}</span>
                  </div>
                  <div className="settings-stat">
                    <span className="settings-stat__label">Instrumenty</span>
                    <span className="settings-stat__value">{fmtNum(stats.highlights.instruments)}</span>
                    <span className="settings-stat__hint">v katalogu</span>
                  </div>
                </div>

                <div className="settings-tags">
                  <span>{(stats.crypto.exchanges || []).join(" + ") || "crypto —"}</span>
                  {stats.crypto.execution_exchange && <span>exec {stats.crypto.execution_exchange}</span>}
                  <span>Python {stats.host.python}</span>
                  <span>pid {stats.process.pid}</span>
                </div>

                {stats.tables.length > 0 && (
                  <details className="settings-details">
                    <summary>Tabulky na disku</summary>
                    <ul className="settings-tables">
                      {stats.tables.slice(0, 12).map((t) => (
                        <li key={t.name}>
                          <span className="settings-tables__name">{t.name}</span>
                          <span className="settings-tables__rows">{fmtNum(t.rows)}</span>
                          <span className="settings-tables__size">{t.total_human}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
