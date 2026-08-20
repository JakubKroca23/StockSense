"use client";

import { TICK_GROUPS, type DomSettings } from "@/lib/orderflow";
import { SettingsActionRow } from "@/components/SettingsActionRow";

type Props = {
  settings: DomSettings;
  tick: number;
  onChange: (patch: Partial<DomSettings>) => void;
  onReset: () => void;
  onSaveDefault?: () => void;
  inDeskMenu?: boolean;
  /** Ladder panel vs dedicated heatmap chart. */
  mode?: "ladder" | "chart";
  /** Compact overlay on candle/footprint — heatmap + depth lanes. */
  overlay?: boolean;
  /** Header flyout — skip reset/save row. */
  compact?: boolean;
};

export function DomSettingsPanel({
  settings,
  tick,
  onChange,
  onReset,
  onSaveDefault,
  inDeskMenu = false,
  mode = "ladder",
  overlay = false,
  compact = false,
}: Props) {
  const step = tick * settings.tickGroup;
  const chart = mode === "chart";
  if (overlay) {
    return (
      <section className={`settings-block${inDeskMenu ? " is-desk-menu" : " is-compact"}`}>
        <div className={`settings-chart${inDeskMenu ? " settings-chart--grid" : ""}`}>
          <section className="fp-drawer__sec">
            <h3>DOM a heatmapa</h3>
            <p className="fp-drawer__lead">
              Čtyři histogramy vpravo: bid, ask a provedené obchody (sell / buy). Heatmapa je
              historie hloubky nalevo od nich.
            </p>
            <label className="fp-drawer__toggle">
              <input
                type="checkbox"
                checked={settings.showHeatmap}
                onChange={(e) => onChange({ showHeatmap: e.target.checked })}
              />
              <span>
                <span className="fp-drawer__toggle-lab">Heatmapa</span>
              </span>
            </label>
            {settings.showHeatmap ? (
              <>
                <div className="fp-drawer__item">
                  <div className="fp-drawer__item-top">
                    <span>Šířka heatmapy</span>
                    <span className="fp-drawer__item-val">{settings.heatWidth} px</span>
                  </div>
                  <input
                    type="range"
                    min={36}
                    max={180}
                    value={settings.heatWidth}
                    onChange={(e) => onChange({ heatWidth: Number(e.target.value) })}
                  />
                </div>
                <div className="fp-drawer__item">
                  <div className="fp-drawer__item-top">
                    <span>Historie</span>
                    <span className="fp-drawer__item-val">{settings.heatSeconds} s</span>
                  </div>
                  <input
                    type="range"
                    min={20}
                    max={300}
                    step={10}
                    value={settings.heatSeconds}
                    onChange={(e) => onChange({ heatSeconds: Number(e.target.value) })}
                  />
                </div>
              </>
            ) : null}
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
            <label className="fp-drawer__toggle">
              <input
                type="checkbox"
                checked={settings.showDepthBars}
                onChange={(e) => onChange({ showDepthBars: e.target.checked })}
              />
              <span>
                <span className="fp-drawer__toggle-lab">Čísla v profilech</span>
              </span>
            </label>
            <label className="fp-drawer__toggle">
              <input
                type="checkbox"
                checked={settings.showVolume}
                onChange={(e) => onChange({ showVolume: e.target.checked })}
              />
              <span>
                <span className="fp-drawer__toggle-lab">Zobchodovaný objem</span>
              </span>
            </label>
          </section>
          {compact ? null : <SettingsActionRow onReset={onReset} onSaveDefault={onSaveDefault} />}
        </div>
      </section>
    );
  }
  return (
    <section className={`settings-block${inDeskMenu ? " is-desk-menu" : " is-compact"}`}>
      <div className={`settings-chart${inDeskMenu ? " settings-chart--grid" : ""}`}>
        <section className="fp-drawer__sec">
          <h3>{chart ? "Heatmapa likvidity" : "Žebřík"}</h3>
          <p className="fp-drawer__lead">
            {chart
              ? "Historie hloubky v čase. Zelená = bid, červená = ask."
              : "Rozlišení cenových hladin a chování scrollu."}
          </p>
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
              <span>Výška řádku</span>
              <span className="fp-drawer__item-val">{settings.rowHeight} px</span>
            </div>
            <input
              type="range"
              min={12}
              max={40}
              value={settings.rowHeight}
              onChange={(e) => onChange({ rowHeight: Number(e.target.value) })}
            />
          </div>
          {chart ? (
            <div className="fp-drawer__item">
              <div className="fp-drawer__item-top">
                <span>Historie</span>
                <span className="fp-drawer__item-val">{settings.heatSeconds} s</span>
              </div>
              <input
                type="range"
                min={20}
                max={300}
                step={10}
                value={settings.heatSeconds}
                onChange={(e) => onChange({ heatSeconds: Number(e.target.value) })}
              />
            </div>
          ) : (
            <>
              <label className="fp-drawer__toggle">
                <input
                  type="checkbox"
                  checked={settings.centerLock}
                  onChange={(e) => onChange({ centerLock: e.target.checked })}
                />
                <span>
                  <span className="fp-drawer__toggle-lab">Zámek na mid</span>
                  <span className="fp-drawer__hint">
                    Žebřík se sám vyplní na výšku panelu a drží střed trhu. Vypnuto = scroll kolečkem.
                    Skupina A/B/C v hlavičce přebije zámek a zarovná hladiny s grafem.
                  </span>
                </span>
              </label>
              <div className="fp-drawer__item">
                <div className="fp-drawer__item-top">
                  <span>Počet řádků</span>
                  <span className="fp-drawer__item-val">
                    {settings.centerLock ? "auto" : settings.rows}
                  </span>
                </div>
                <input
                  type="range"
                  min={10}
                  max={120}
                  value={settings.rows}
                  disabled={settings.centerLock}
                  onChange={(e) => onChange({ rows: Number(e.target.value) })}
                />
              </div>
            </>
          )}
        </section>

        <section className="fp-drawer__sec">
          <h3>Sloupce</h3>
          <label className="fp-drawer__toggle">
            <input
              type="checkbox"
              checked={settings.showVolume}
              onChange={(e) => onChange({ showVolume: e.target.checked })}
            />
            <span>
              <span className="fp-drawer__toggle-lab">Zobchodovaný objem</span>
              <span className="fp-drawer__hint">Buy / sell volume at price z footprint dat.</span>
            </span>
          </label>
          <label className="fp-drawer__toggle">
            <input
              type="checkbox"
              checked={settings.showSessionProfile}
              onChange={(e) => onChange({ showSessionProfile: e.target.checked })}
            />
            <span>
              <span className="fp-drawer__toggle-lab">Session profil</span>
            </span>
          </label>
          <label className="fp-drawer__toggle">
            <input
              type="checkbox"
              checked={settings.showDepthBars}
              onChange={(e) => onChange({ showDepthBars: e.target.checked })}
            />
            <span>
              <span className="fp-drawer__toggle-lab">Histogramy v buňkách</span>
            </span>
          </label>
          <label className="fp-drawer__toggle">
            <input
              type="checkbox"
              checked={settings.showCumulative}
              onChange={(e) => onChange({ showCumulative: e.target.checked })}
            />
            <span>
              <span className="fp-drawer__toggle-lab">Kumulativní hloubka</span>
              <span className="fp-drawer__hint">Místo velikosti hladiny součet od mid.</span>
            </span>
          </label>
          <div className="fp-drawer__item">
            <div className="fp-drawer__item-top">
              <span>Okno objemů</span>
              <span className="fp-drawer__item-val">{settings.sessionMinutes} min</span>
            </div>
            <input
              type="range"
              min={5}
              max={480}
              step={5}
              value={settings.sessionMinutes}
              onChange={(e) => onChange({ sessionMinutes: Number(e.target.value) })}
            />
          </div>
        </section>

        <section className="fp-drawer__sec">
          <h3>Detekce</h3>
          <p className="fp-drawer__lead">
            Změny hloubky se očišťují o realizované obchody — zmizelá likvidita s přiznaným
            objemem je absorpce, ne stažení.
          </p>
          <div className="fp-drawer__item">
            <div className="fp-drawer__item-top">
              <span>Okno detekce</span>
              <span className="fp-drawer__item-val">{settings.heatSeconds} s</span>
            </div>
            <p className="fp-drawer__hint">Jak daleko do historie se díváme při pulling / stacking.</p>
            <input
              type="range"
              min={20}
              max={300}
              step={10}
              value={settings.heatSeconds}
              onChange={(e) => onChange({ heatSeconds: Number(e.target.value) })}
            />
          </div>
          <label className="fp-drawer__toggle">
            <input
              type="checkbox"
              checked={settings.showWalls}
              onChange={(e) => onChange({ showWalls: e.target.checked })}
            />
            <span>
              <span className="fp-drawer__toggle-lab">Zdi (stacking)</span>
            </span>
          </label>
          <div className="fp-drawer__item">
            <div className="fp-drawer__item-top">
              <span>Násobek mediánu</span>
              <span className="fp-drawer__item-val">{settings.wallRatio.toFixed(1)}×</span>
            </div>
            <input
              type="range"
              min={15}
              max={100}
              value={Math.round(settings.wallRatio * 10)}
              onChange={(e) => onChange({ wallRatio: Number(e.target.value) / 10 })}
            />
          </div>
          <label className="fp-drawer__toggle">
            <input
              type="checkbox"
              checked={settings.showPulling}
              onChange={(e) => onChange({ showPulling: e.target.checked })}
            />
            <span>
              <span className="fp-drawer__toggle-lab">Pulling / spoofing</span>
              <span className="fp-drawer__hint">
                Likvidita zmizí bez exekuce = falešná nabídka před cenou.
              </span>
            </span>
          </label>
          <div className="fp-drawer__item">
            <div className="fp-drawer__item-top">
              <span>Práh změny</span>
              <span className="fp-drawer__item-val">{settings.pullPct} %</span>
            </div>
            <input
              type="range"
              min={10}
              max={95}
              step={5}
              value={settings.pullPct}
              onChange={(e) => onChange({ pullPct: Number(e.target.value) })}
            />
          </div>
          <label className="fp-drawer__toggle">
            <input
              type="checkbox"
              checked={settings.showIceberg}
              onChange={(e) => onChange({ showIceberg: e.target.checked })}
            />
            <span>
              <span className="fp-drawer__toggle-lab">Iceberg</span>
              <span className="fp-drawer__hint">
                Poměr zobchodovaného objemu k maximální viditelné hloubce na hladině.
              </span>
            </span>
          </label>
          <div className="fp-drawer__item">
            <div className="fp-drawer__item-top">
              <span>Volume / depth</span>
              <span className="fp-drawer__item-val">{settings.icebergRatio.toFixed(1)} : 1</span>
            </div>
            <input
              type="range"
              min={15}
              max={100}
              value={Math.round(settings.icebergRatio * 10)}
              onChange={(e) => onChange({ icebergRatio: Number(e.target.value) / 10 })}
            />
          </div>
        </section>

        <SettingsActionRow onReset={onReset} onSaveDefault={onSaveDefault} />
      </div>
    </section>
  );
}
