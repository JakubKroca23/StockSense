"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { IconClose, IconMoon, IconSun } from "@/components/NavIcons";
import type { ColorMode } from "@/lib/theme";

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
};

function fmtNum(n: number | null | undefined) {
  return (n ?? 0).toLocaleString("cs-CZ");
}

function StatusDot({ on }: { on: boolean }) {
  return <span className={`settings-dot ${on ? "is-on" : "is-off"}`} aria-hidden />;
}

type Props = {
  open: boolean;
  onClose: () => void;
  theme: ColorMode;
  onThemeChange: (mode: ColorMode) => void;
};

export function SettingsPanel({ open, onClose, theme, onThemeChange }: Props) {
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const st = await apiFetch<SystemStats>("/system/stats");
      setStats(st);
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
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const nextTheme = theme === "light" ? "dark" : "light";

  return (
    <aside className="settings-drawer" aria-label="Nastavení">
      <header className="settings-drawer__head">
        <p className="settings-drawer__title">NASTAVENÍ</p>
        <div className="settings-drawer__actions">
          <button
            type="button"
            className="settings-drawer__theme"
            aria-label={theme === "light" ? "Přepnout na tmavý režim" : "Přepnout na světlý režim"}
            title={theme === "light" ? "Tmavý režim" : "Světlý režim"}
            onClick={() => onThemeChange(nextTheme)}
          >
            {theme === "light" ? <IconMoon size={16} /> : <IconSun size={16} />}
          </button>
          <button type="button" className="settings-drawer__close" onClick={onClose} aria-label="Zavřít">
            <IconClose size={18} />
          </button>
        </div>
      </header>

      <div className="settings-drawer__body">
        {error && <p className="settings-alert">{error}</p>}

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
              <div className="settings-pills settings-pills--inline">
                <span className="settings-pill">
                  <StatusDot on={stats.environment === "production"} />
                  {stats.environment}
                </span>
                <span className="settings-pill">↑ {stats.uptime_human}</span>
              </div>

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
                  <span className="settings-stat__hint">
                    {stats.host.system} {stats.host.machine}
                  </span>
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
    </aside>
  );
}
