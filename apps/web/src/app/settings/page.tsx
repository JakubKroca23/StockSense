"use client";

import { FormEvent, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { RiskProfile, UserSettings, riskLabel } from "@/lib/types";

export default function SettingsPage() {
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<UserSettings>("/settings")
      .then(setSettings)
      .catch((err) => setError(err.message));
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!settings) return;
    try {
      const updated = await apiFetch<UserSettings>("/settings", {
        method: "PATCH",
        body: JSON.stringify(settings),
      });
      setSettings(updated);
      setMessage("Uloženo");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Chyba");
    }
  }

  async function enablePush() {
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setError("Push nepovolen");
        return;
      }
      // Store a marker subscription; real VAPID keys can be added later.
      await apiFetch("/settings", {
        method: "PATCH",
        body: JSON.stringify({
          alert_push: true,
          push_subscription: {
            enabled: true,
            userAgent: navigator.userAgent,
            at: new Date().toISOString(),
          },
        }),
      });
      setMessage("Push preference uložena (PWA). VAPID endpoint lze doplnit později.");
      const refreshed = await apiFetch<UserSettings>("/settings");
      setSettings(refreshed);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Push selhal");
    }
  }

  if (!settings && !error) return <div className="muted">Načítám nastavení…</div>;
  if (!settings) return <div className="card p-4 text-[var(--danger)]">{error}</div>;

  return (
    <div className="space-y-6 max-w-xl">
      <div>
        <h1 className="display text-3xl">Nastavení</h1>
        <p className="muted">Risk profil ovlivňuje sizing a filtry tipů.</p>
      </div>
      <form className="card p-5 space-y-4" onSubmit={onSubmit}>
        <label className="block space-y-1">
          <span className="text-sm muted">Risk profil</span>
          <select
            className="input"
            value={settings.risk_profile}
            onChange={(e) =>
              setSettings({ ...settings, risk_profile: e.target.value as RiskProfile })
            }
          >
            {(Object.keys(riskLabel) as RiskProfile[]).map((k) => (
              <option key={k} value={k}>
                {riskLabel[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1">
          <span className="text-sm muted">Max % portfolia na tip</span>
          <input
            className="input"
            type="number"
            step="0.1"
            min="0.1"
            max="100"
            value={settings.max_position_pct}
            onChange={(e) =>
              setSettings({ ...settings, max_position_pct: Number(e.target.value) })
            }
          />
        </label>
        <label className="block space-y-1">
          <span className="text-sm muted">E-mail pro alerty</span>
          <input
            className="input"
            type="email"
            value={settings.email || ""}
            onChange={(e) => setSettings({ ...settings, email: e.target.value })}
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={settings.alert_email}
            onChange={(e) => setSettings({ ...settings, alert_email: e.target.checked })}
          />
          E-mail alerty
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={settings.alert_push}
            onChange={(e) => setSettings({ ...settings, alert_push: e.target.checked })}
          />
          PWA push alerty
        </label>
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-primary" type="submit">
            Uložit
          </button>
          <button className="btn" type="button" onClick={enablePush}>
            Povolit notifikace
          </button>
        </div>
        {message && <p className="text-[var(--ok)] text-sm">{message}</p>}
        {error && <p className="text-[var(--danger)] text-sm">{error}</p>}
      </form>
    </div>
  );
}
