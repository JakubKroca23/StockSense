"use client";

import { TICK_GROUPS, type OrderflowSettings } from "@/lib/orderflow";

type Props = {
  settings: OrderflowSettings;
  tick: number;
  onChange: (patch: Partial<OrderflowSettings>) => void;
  onReset: () => void;
};

export function FootprintSettingsPanel({ settings, tick, onChange, onReset }: Props) {
  const step = tick * settings.tickGroup;
  return (
    <section className="settings-block is-compact">
      <div className="settings-chart">
        <section className="fp-drawer__sec">
          <h3>Cluster</h3>
          <p className="fp-drawer__lead">Co se píše do buňky a jak hustá je cenová mřížka.</p>
          <div className="fp-drawer__item">
            <div className="fp-drawer__item-top">
              <span>Obsah buňky</span>
            </div>
            <div className="fp-drawer__seg">
              {(
                [
                  ["bidask", "Bid × Ask"],
                  ["delta", "Delta"],
                  ["volume", "Objem"],
                  ["profile", "Profil"],
                ] as const
              ).map(([id, lab]) => (
                <button
                  key={id}
                  type="button"
                  className={`fp-drawer__chip ${settings.cellMode === id ? "is-active" : ""}`}
                  onClick={() => onChange({ cellMode: id })}
                >
                  {lab}
                </button>
              ))}
            </div>
          </div>
          <div className="fp-drawer__item">
            <div className="fp-drawer__item-top">
              <span>Ticků na řádek</span>
              <span className="fp-drawer__item-val">
                {settings.tickGroup} · {step.toFixed(Math.max(0, Math.ceil(-Math.log10(step))))}
              </span>
            </div>
            <p className="fp-drawer__hint">
              Slučování ticků do jedné cenové hladiny. Vyšší číslo = přehlednější clustery.
            </p>
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
              <span>Šířka sloupce</span>
              <span className="fp-drawer__item-val">{settings.barWidth} px</span>
            </div>
            <input
              type="range"
              min={24}
              max={240}
              value={settings.barWidth}
              onChange={(e) => onChange({ barWidth: Number(e.target.value) })}
            />
          </div>
          <div className="fp-drawer__item">
            <div className="fp-drawer__item-top">
              <span>Výška řádku</span>
              <span className="fp-drawer__item-val">{settings.rowHeight} px</span>
            </div>
            <p className="fp-drawer__hint">Kolečko myši zoomuje čas, Ctrl + kolečko cenu.</p>
            <input
              type="range"
              min={5}
              max={44}
              value={settings.rowHeight}
              onChange={(e) => onChange({ rowHeight: Number(e.target.value) })}
            />
          </div>
          <label className="fp-drawer__toggle">
            <input
              type="checkbox"
              checked={settings.showText}
              onChange={(e) => onChange({ showText: e.target.checked })}
            />
            <span>
              <span className="fp-drawer__toggle-lab">Čísla v buňkách</span>
              <span className="fp-drawer__hint">Při malém zoomu se skryjí automaticky.</span>
            </span>
          </label>
          <label className="fp-drawer__toggle">
            <input
              type="checkbox"
              checked={settings.showCandle}
              onChange={(e) => onChange({ showCandle: e.target.checked })}
            />
            <span>
              <span className="fp-drawer__toggle-lab">Svíčka ve sloupci</span>
              <span className="fp-drawer__hint">Tenké OHLC tělo u levého okraje clusteru.</span>
            </span>
          </label>
        </section>

        <section className="fp-drawer__sec">
          <h3>Heat mapa</h3>
          <p className="fp-drawer__lead">Podbarvení buněk podle intenzity toku.</p>
          <div className="fp-drawer__seg">
            {(
              [
                ["volume", "Objem"],
                ["delta", "Delta"],
                ["off", "Vyp"],
              ] as const
            ).map(([id, lab]) => (
              <button
                key={id}
                type="button"
                className={`fp-drawer__chip ${settings.heatMode === id ? "is-active" : ""}`}
                onClick={() => onChange({ heatMode: id })}
              >
                {lab}
              </button>
            ))}
          </div>
          <div className="fp-drawer__item">
            <div className="fp-drawer__item-top">
              <span>Síla</span>
              <span className="fp-drawer__item-val">{settings.heatOpacity} %</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              value={settings.heatOpacity}
              onChange={(e) => onChange({ heatOpacity: Number(e.target.value) })}
            />
          </div>
        </section>

        <section className="fp-drawer__sec">
          <h3>Nerovnováhy</h3>
          <p className="fp-drawer__lead">
            Diagonální porovnání Bid(P) proti Ask(P+1) — aukce se páruje po diagonále, ne
            vodorovně.
          </p>
          <label className="fp-drawer__toggle">
            <input
              type="checkbox"
              checked={settings.showImbalance}
              onChange={(e) => onChange({ showImbalance: e.target.checked })}
            />
            <span>
              <span className="fp-drawer__toggle-lab">Zvýrazňovat imbalance</span>
            </span>
          </label>
          <div className="fp-drawer__item">
            <div className="fp-drawer__item-top">
              <span>Práh poměru</span>
              <span className="fp-drawer__item-val">{settings.imbalanceRatio} %</span>
            </div>
            <p className="fp-drawer__hint">Tržní standard je 300 % (převaha 3 : 1).</p>
            <input
              type="range"
              min={150}
              max={800}
              step={25}
              value={settings.imbalanceRatio}
              onChange={(e) => onChange({ imbalanceRatio: Number(e.target.value) })}
            />
          </div>
          <div className="fp-drawer__item">
            <div className="fp-drawer__item-top">
              <span>Minimální objem</span>
              <span className="fp-drawer__item-val">{settings.imbalanceMinVolume}</span>
            </div>
            <p className="fp-drawer__hint">
              Filtr mikro-událostí — poměr 3 : 1 na jednotkách kontraktů nemá statistickou váhu.
            </p>
            <input
              type="number"
              min={0}
              step={0.1}
              value={settings.imbalanceMinVolume}
              onChange={(e) => onChange({ imbalanceMinVolume: Math.max(0, Number(e.target.value)) })}
            />
          </div>
          <label className="fp-drawer__toggle">
            <input
              type="checkbox"
              checked={settings.showStacked}
              onChange={(e) => onChange({ showStacked: e.target.checked })}
            />
            <span>
              <span className="fp-drawer__toggle-lab">Stacked zóny</span>
              <span className="fp-drawer__hint">
                Souvislá série imbalancí se protáhne doprava jako S/R bariéra.
              </span>
            </span>
          </label>
          <div className="fp-drawer__item">
            <div className="fp-drawer__item-top">
              <span>Minimum v sérii</span>
              <span className="fp-drawer__item-val">{settings.stackedMin}</span>
            </div>
            <input
              type="range"
              min={2}
              max={8}
              value={settings.stackedMin}
              onChange={(e) => onChange({ stackedMin: Number(e.target.value) })}
            />
          </div>
        </section>

        <section className="fp-drawer__sec">
          <h3>Profil a signály</h3>
          <label className="fp-drawer__toggle">
            <input
              type="checkbox"
              checked={settings.showPoc}
              onChange={(e) => onChange({ showPoc: e.target.checked })}
            />
            <span>
              <span className="fp-drawer__toggle-lab">POC svíčky</span>
              <span className="fp-drawer__hint">Hladina s nejvyšším objemem v baru.</span>
            </span>
          </label>
          <label className="fp-drawer__toggle">
            <input
              type="checkbox"
              checked={settings.showValueArea}
              onChange={(e) => onChange({ showValueArea: e.target.checked })}
            />
            <span>
              <span className="fp-drawer__toggle-lab">Value Area</span>
              <span className="fp-drawer__hint">Expanze od POC po dvojicích řádků.</span>
            </span>
          </label>
          <div className="fp-drawer__item">
            <div className="fp-drawer__item-top">
              <span>Value Area</span>
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
          <label className="fp-drawer__toggle">
            <input
              type="checkbox"
              checked={settings.showFade}
              onChange={(e) => onChange({ showFade: e.target.checked })}
            />
            <span>
              <span className="fp-drawer__toggle-lab">Bid/Ask Fade</span>
              <span className="fp-drawer__hint">Slábnoucí agrese na extrémech knotu.</span>
            </span>
          </label>
          <label className="fp-drawer__toggle">
            <input
              type="checkbox"
              checked={settings.showAbsorption}
              onChange={(e) => onChange({ showAbsorption: e.target.checked })}
            />
            <span>
              <span className="fp-drawer__toggle-lab">Absorpce</span>
              <span className="fp-drawer__hint">
                Velká delta bez posunu ceny = pasivní strana nasává.
              </span>
            </span>
          </label>
          <div className="fp-drawer__item">
            <div className="fp-drawer__item-top">
              <span>Práh absorpce</span>
              <span className="fp-drawer__item-val">
                {Math.round(settings.absorptionRatio * 100)} %
              </span>
            </div>
            <p className="fp-drawer__hint">Podíl |delty| na celkovém objemu svíčky.</p>
            <input
              type="range"
              min={10}
              max={90}
              value={Math.round(settings.absorptionRatio * 100)}
              onChange={(e) => onChange({ absorptionRatio: Number(e.target.value) / 100 })}
            />
          </div>
          <label className="fp-drawer__toggle">
            <input
              type="checkbox"
              checked={settings.showProfile}
              onChange={(e) => onChange({ showProfile: e.target.checked })}
            />
            <span>
              <span className="fp-drawer__toggle-lab">Volume profile</span>
              <span className="fp-drawer__hint">Histogram viditelného rozsahu s POC a VA.</span>
            </span>
          </label>
          <div className="fp-drawer__item">
            <div className="fp-drawer__item-top">
              <span>Šířka profilu</span>
              <span className="fp-drawer__item-val">{settings.profileWidth} px</span>
            </div>
            <input
              type="range"
              min={40}
              max={220}
              value={settings.profileWidth}
              onChange={(e) => onChange({ profileWidth: Number(e.target.value) })}
            />
          </div>
        </section>

        <section className="fp-drawer__sec">
          <h3>Spodní panely</h3>
          <label className="fp-drawer__toggle">
            <input
              type="checkbox"
              checked={settings.showDeltaRow}
              onChange={(e) => onChange({ showDeltaRow: e.target.checked })}
            />
            <span>
              <span className="fp-drawer__toggle-lab">Řádek Delta</span>
            </span>
          </label>
          <label className="fp-drawer__toggle">
            <input
              type="checkbox"
              checked={settings.showVolumeRow}
              onChange={(e) => onChange({ showVolumeRow: e.target.checked })}
            />
            <span>
              <span className="fp-drawer__toggle-lab">Řádek Objem</span>
            </span>
          </label>
          <label className="fp-drawer__toggle">
            <input
              type="checkbox"
              checked={settings.showCvd}
              onChange={(e) => onChange({ showCvd: e.target.checked })}
            />
            <span>
              <span className="fp-drawer__toggle-lab">Kumulativní delta (CVD)</span>
              <span className="fp-drawer__hint">
                Divergence CVD proti ceně odhalují skrytou absorpci.
              </span>
            </span>
          </label>
          <div className="fp-drawer__item">
            <div className="fp-drawer__item-top">
              <span>Výška CVD</span>
              <span className="fp-drawer__item-val">{settings.cvdHeight} px</span>
            </div>
            <input
              type="range"
              min={28}
              max={180}
              value={settings.cvdHeight}
              onChange={(e) => onChange({ cvdHeight: Number(e.target.value) })}
            />
          </div>
        </section>

        <button type="button" className="fp-drawer__reset" onClick={onReset}>
          Výchozí
        </button>
      </div>
    </section>
  );
}
