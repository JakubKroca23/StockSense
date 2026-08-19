"use client";

import { useMemo } from "react";
import {
  PROFILE_RANGES,
  PROFILE_SESSION_MINUTES,
  TICK_GROUPS,
  clampProfileSessionMinutes,
  readOrderflowTheme,
  type OrderflowSettings,
  type VolumeProfileSettings,
} from "@/lib/orderflow";
import { SettingsActionRow } from "@/components/SettingsActionRow";
import { useThemeRevision } from "@/lib/theme";

const TPO_BLOCKS = [5, 15, 30, 60, 120] as const;

function sessionMinutesLabel(m: number) {
  if (m % 1440 === 0) return `${m / 1440} D`;
  if (m % 60 === 0) return `${m / 60} H`;
  return `${m} m`;
}

function ColorField({
  label,
  hint,
  value,
  fallback,
  onChange,
}: {
  label: string;
  hint?: string;
  value?: string;
  fallback: string;
  onChange: (next: string | undefined) => void;
}) {
  const shown = value?.trim() || fallback;
  const custom = Boolean(value?.trim());
  return (
    <label className="fp-drawer__color">
      <input type="color" value={shown} onChange={(e) => onChange(e.target.value)} aria-label={label} />
      <span>
        <span className="fp-drawer__color-lab">{label}</span>
        {hint ? <span className="fp-drawer__hint">{hint}</span> : null}
        {custom ? (
          <button
            type="button"
            className="fp-drawer__color-reset"
            onClick={(e) => {
              e.preventDefault();
              onChange(undefined);
            }}
          >
            Vrátit na téma
          </button>
        ) : null}
      </span>
    </label>
  );
}

function ProfileRangeFields({
  settings,
  onChange,
}: {
  settings: VolumeProfileSettings;
  onChange: (patch: Partial<VolumeProfileSettings>) => void;
}) {
  const range = settings.profileRange ?? "visible";
  return (
    <>
      <div className="fp-drawer__item">
        <div className="fp-drawer__item-top">
          <span>Interval</span>
        </div>
        <p className="fp-drawer__hint">
          Viditelné a celé období = jeden histogram vpravo. Den, hodina a vlastní = profil u každé seance (UTC).
        </p>
        <div className="fp-drawer__seg">
          {PROFILE_RANGES.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              className={`fp-drawer__chip ${range === id ? "is-active" : ""}`}
              onClick={() => onChange({ profileRange: id })}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {range === "custom" ? (
        <div className="fp-drawer__item">
          <div className="fp-drawer__item-top">
            <span>Délka seance</span>
            <span className="fp-drawer__item-val">
              {sessionMinutesLabel(clampProfileSessionMinutes(settings.profileSessionMinutes))}
            </span>
          </div>
          <div className="fp-drawer__seg">
            {PROFILE_SESSION_MINUTES.map((m) => (
              <button
                key={m}
                type="button"
                className={`fp-drawer__chip ${clampProfileSessionMinutes(settings.profileSessionMinutes) === m ? "is-active" : ""}`}
                onClick={() => onChange({ profileRange: "custom", profileSessionMinutes: m })}
              >
                {sessionMinutesLabel(m)}
              </button>
            ))}
          </div>
          <div className="fp-drawer__item">
            <div className="fp-drawer__item-top">
              <span>Minuty</span>
            </div>
            <input
              type="number"
              min={1}
              max={10080}
              step={1}
              value={clampProfileSessionMinutes(settings.profileSessionMinutes)}
              onChange={(e) =>
                onChange({
                  profileRange: "custom",
                  profileSessionMinutes: clampProfileSessionMinutes(Number(e.target.value)),
                })
              }
            />
          </div>
        </div>
      ) : null}
    </>
  );
}

type Props = {
  settings: VolumeProfileSettings;
  tick: number;
  onChange: (patch: Partial<VolumeProfileSettings>) => void;
  onReset: () => void;
  onSaveDefault?: () => void;
  inDeskMenu?: boolean;
  overlay?: boolean;
  compact?: boolean;
  tpoSettings?: OrderflowSettings;
  onTpoChange?: (patch: Partial<OrderflowSettings>) => void;
};

export function ProfileSettingsPanel({
  settings,
  tick,
  onChange,
  onReset,
  onSaveDefault,
  inDeskMenu = false,
  overlay = false,
  compact = false,
  tpoSettings,
  onTpoChange,
}: Props) {
  const step = tick * settings.tickGroup;
  const tpoStep = tick * (tpoSettings?.tickGroup ?? settings.tickGroup);
  const themeRev = useThemeRevision();
  const theme = useMemo(() => readOrderflowTheme(), [themeRev]);
  return (
    <section className={`settings-block${inDeskMenu ? " is-desk-menu" : " is-compact"}`}>
      <div className={`settings-chart${inDeskMenu ? " settings-chart--grid" : ""}`}>
        {!overlay && tpoSettings && onTpoChange ? (
        <section className="fp-drawer__sec">
          <h3>TPO</h3>
          <p className="fp-drawer__lead">
            Písmena A, B, C… značí, kde trh v daném bloku obchodoval. POC je hladina s nejvíce TPO.
          </p>
          <label className="fp-drawer__toggle">
            <input
              type="checkbox"
              checked={tpoSettings.showTpo}
              onChange={(e) => onTpoChange({ showTpo: e.target.checked })}
            />
            <span>
              <span className="fp-drawer__toggle-lab">TPO písmena</span>
            </span>
          </label>
          <div className="fp-drawer__item">
            <div className="fp-drawer__item-top">
              <span>Délka bloku</span>
              <span className="fp-drawer__item-val">{tpoSettings.tpoBlockMinutes} min</span>
            </div>
            <div className="fp-drawer__seg">
              {TPO_BLOCKS.map((m) => (
                <button
                  key={m}
                  type="button"
                  className={`fp-drawer__chip ${tpoSettings.tpoBlockMinutes === m ? "is-active" : ""}`}
                  onClick={() => onTpoChange({ tpoBlockMinutes: m })}
                >
                  {m}m
                </button>
              ))}
            </div>
          </div>
          <div className="fp-drawer__item">
            <div className="fp-drawer__item-top">
              <span>Ticků na řádek</span>
              <span className="fp-drawer__item-val">
                {tpoSettings.tickGroup} · {tpoStep.toFixed(Math.max(0, Math.ceil(-Math.log10(tpoStep))))}
              </span>
            </div>
            <div className="fp-drawer__seg">
              {TICK_GROUPS.map((g) => (
                <button
                  key={g}
                  type="button"
                  className={`fp-drawer__chip ${tpoSettings.tickGroup === g ? "is-active" : ""}`}
                  onClick={() => onTpoChange({ tickGroup: g })}
                >
                  {g}
                </button>
              ))}
            </div>
          </div>
          <div className="fp-drawer__item">
            <div className="fp-drawer__item-top">
              <span>Výška buňky</span>
              <span className="fp-drawer__item-val">{tpoSettings.rowHeight} px</span>
            </div>
            <input
              type="range"
              min={8}
              max={28}
              value={tpoSettings.rowHeight}
              onChange={(e) => onTpoChange({ rowHeight: Number(e.target.value) })}
            />
          </div>
        </section>
        ) : null}

        <section className="fp-drawer__sec">
          <h3>Volume Profile</h3>
          {overlay ? (
            <p className="fp-drawer__lead">Jen histogram VP. Tick grouping, POC a barvy nemění footprint ani svíčky.</p>
          ) : (
            <label className="fp-drawer__toggle">
              <input
                type="checkbox"
                checked={settings.showHistogram}
                onChange={(e) => onChange({ showHistogram: e.target.checked })}
              />
              <span>
                <span className="fp-drawer__toggle-lab">Histogram</span>
                <span className="fp-drawer__hint">Z footprint objemů, jinak z počtu TPO.</span>
              </span>
            </label>
          )}
          <ProfileRangeFields settings={settings} onChange={onChange} />
          <div className="fp-drawer__item">
            <div className="fp-drawer__item-top">
              <span>Ticků na řádek</span>
              <span className="fp-drawer__item-val">
                {settings.tickGroup} · {step.toFixed(Math.max(0, Math.ceil(-Math.log10(step))))}
              </span>
            </div>
            <div className="fp-drawer__seg">
              {TICK_GROUPS.map((g) => (
                <button
                  key={g}
                  type="button"
                  className={`fp-drawer__chip ${settings.tickGroup === g ? "is-active" : ""}`}
                  onClick={() => onChange({ tickGroup: g })}
                >
                  {g}
                </button>
              ))}
            </div>
          </div>
          <div className="fp-drawer__item">
            <div className="fp-drawer__item-top">
              <span>Šířka</span>
              <span className="fp-drawer__item-val">{settings.profileWidth} px</span>
            </div>
            <input
              type="range"
              min={48}
              max={180}
              value={settings.profileWidth}
              onChange={(e) => onChange({ profileWidth: Number(e.target.value) })}
            />
          </div>
          <label className="fp-drawer__toggle">
            <input
              type="checkbox"
              checked={settings.showPoc}
              onChange={(e) => onChange({ showPoc: e.target.checked })}
            />
            <span>
              <span className="fp-drawer__toggle-lab">POC čára</span>
            </span>
          </label>
          <label className="fp-drawer__toggle">
            <input
              type="checkbox"
              checked={settings.showValueArea}
              onChange={(e) => onChange({ showValueArea: e.target.checked })}
            />
            <span>
              <span className="fp-drawer__toggle-lab">Value area</span>
            </span>
          </label>
          <div className="fp-drawer__item">
            <div className="fp-drawer__item-top">
              <span>Value area</span>
              <span className="fp-drawer__item-val">{settings.valueAreaPct} %</span>
            </div>
            <input
              type="range"
              min={50}
              max={90}
              value={settings.valueAreaPct}
              onChange={(e) => onChange({ valueAreaPct: Number(e.target.value) })}
            />
          </div>
          <div className="fp-drawer__item">
            <div className="fp-drawer__item-top">
              <span>Barvy</span>
            </div>
            <p className="fp-drawer__hint">Prázdné = barvy z tématu. Platí jen pro volume profile.</p>
            <div className="fp-drawer__colors">
              <ColorField
                label="Nákup"
                hint="Ask / buy strana histogramu."
                value={settings.upColor}
                fallback={theme.up}
                onChange={(upColor) => onChange({ upColor })}
              />
              <ColorField
                label="Prodej"
                hint="Bid / sell strana histogramu."
                value={settings.downColor}
                fallback={theme.down}
                onChange={(downColor) => onChange({ downColor })}
              />
              <ColorField
                label="POC"
                hint="POC čára v histogramu."
                value={settings.pocColor}
                fallback={theme.sense}
                onChange={(pocColor) => onChange({ pocColor })}
              />
              <ColorField
                label="Value area"
                hint="Pásmo VAH–VAL."
                value={settings.vaColor}
                fallback={theme.sense}
                onChange={(vaColor) => onChange({ vaColor })}
              />
            </div>
          </div>
        </section>

        {compact ? null : <SettingsActionRow onReset={onReset} onSaveDefault={onSaveDefault} />}
      </div>
    </section>
  );
}
