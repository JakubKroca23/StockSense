"use client";

import { FormEvent, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { subscribeWebPush } from "@/lib/push";
import { AlertPrefs, RiskProfile, UserSettings, riskLabel } from "@/lib/types";

const KIND_LABELS: { key: keyof NonNullable<AlertPrefs["alert_kinds"]>; label: string }[] = [
  { key: "new_tip", label: "Nové tipy" },
  { key: "daily_report", label: "Denní Sense report" },
  { key: "price_stop", label: "Zásah stop" },
  { key: "price_target", label: "Zásah target" },
  { key: "price_rule", label: "Tvé hlídače z grafu" },
  { key: "tip_invalidated", label: "Auto-uzavření tipů" },
];

function defaultPrefs(prefs: UserSettings["preferences"]): AlertPrefs {
  const kinds = prefs?.alert_kinds || {};
  const quiet = prefs?.quiet_hours || {};
  return {
    alert_kinds: {
      new_tip: kinds.new_tip !== false,
      daily_report: kinds.daily_report !== false,
      price_stop: kinds.price_stop !== false,
      price_target: kinds.price_target !== false,
      price_rule: kinds.price_rule !== false,
      tip_invalidated: kinds.tip_invalidated !== false,
    },
    quiet_hours: {
      enabled: Boolean(quiet.enabled),
      start: quiet.start || "22:00",
      end: quiet.end || "07:00",
      timezone: quiet.timezone || "Europe/Prague",
    },
  };
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [prefs, setPrefs] = useState<AlertPrefs>(defaultPrefs({}));
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pushBusy, setPushBusy] = useState(false);

  useEffect(() => {
    apiFetch<UserSettings>("/settings")
      .then((s) => {
        setSettings(s);
        setPrefs(defaultPrefs(s.preferences || {}));
      })
      .catch((err) => setError(err.message));
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!settings) return;
    try {
      const updated = await apiFetch<UserSettings>("/settings", {
        method: "PATCH",
        body: JSON.stringify({
          ...settings,
          preferences: {
            ...(settings.preferences || {}),
            ...prefs,
          },
        }),
      });
      setSettings(updated);
      setPrefs(defaultPrefs(updated.preferences || {}));
      setMessage("Uloženo");
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Chyba");
    }
  }

  async function enablePush() {
    if (!settings?.vapid_public_key) {
      setError("VAPID klíče nejsou nastavené na serveru");
      return;
    }
    setPushBusy(true);
    setError(null);
    try {
      const sub = await subscribeWebPush(settings.vapid_public_key);
      const updated = await apiFetch<UserSettings>("/settings", {
        method: "PATCH",
        body: JSON.stringify({
          alert_push: true,
          push_subscription: sub,
        }),
      });
      setSettings(updated);
      setMessage("Push notifikace aktivní");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Push selhal");
    } finally {
      setPushBusy(false);
    }
  }

  if (!settings && !error) return <div className="muted">Načítám nastavení…</div>;
  if (!settings) return <div className="card p-4 text-[var(--danger)]">{error}</div>;

  return (
    <div className="space-y-6 max-w-xl">
      <div>
        <h1 className="display text-3xl">Nastavení</h1>
        <p className="muted">Risk, kanály alertů a tiché hodiny.</p>
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
          {settings.push_configured && (
            <span className="badge text-[var(--ok)]">aktivní</span>
          )}
        </label>

        <div className="space-y-2 pt-2 border-t border-[var(--line)]">
          <p className="text-sm muted">Druhy alertů (push/e-mail)</p>
          {KIND_LABELS.map(({ key, label }) => (
            <label key={key} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={prefs.alert_kinds?.[key] !== false}
                onChange={(e) =>
                  setPrefs({
                    ...prefs,
                    alert_kinds: { ...prefs.alert_kinds, [key]: e.target.checked },
                  })
                }
              />
              {label}
            </label>
          ))}
        </div>

        <div className="space-y-2 pt-2 border-t border-[var(--line)]">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={Boolean(prefs.quiet_hours?.enabled)}
              onChange={(e) =>
                setPrefs({
                  ...prefs,
                  quiet_hours: { ...prefs.quiet_hours, enabled: e.target.checked },
                })
              }
            />
            Tiché hodiny (bez push/e-mail)
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block space-y-1">
              <span className="text-xs muted">Od</span>
              <input
                className="input"
                type="time"
                value={prefs.quiet_hours?.start || "22:00"}
                onChange={(e) =>
                  setPrefs({
                    ...prefs,
                    quiet_hours: { ...prefs.quiet_hours, start: e.target.value },
                  })
                }
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs muted">Do</span>
              <input
                className="input"
                type="time"
                value={prefs.quiet_hours?.end || "07:00"}
                onChange={(e) =>
                  setPrefs({
                    ...prefs,
                    quiet_hours: { ...prefs.quiet_hours, end: e.target.value },
                  })
                }
              />
            </label>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button className="btn btn-primary" type="submit">
            Uložit
          </button>
          <button className="btn" type="button" disabled={pushBusy} onClick={() => void enablePush()}>
            {pushBusy ? "Povoluji…" : "Povolit notifikace"}
          </button>
        </div>
        {message && <p className="text-[var(--ok)] text-sm">{message}</p>}
        {error && <p className="text-[var(--danger)] text-sm">{error}</p>}
      </form>
    </div>
  );
}
