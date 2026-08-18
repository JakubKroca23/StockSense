"use client";

import type { ChartVizSettings } from "@/components/PriceChart";

type Props = {
  viz: ChartVizSettings;
  onChange: (patch: Partial<ChartVizSettings>) => void;
  onReset: () => void;
  onClose: () => void;
};

export function ChartSettingsPanel({ viz, onChange, onReset, onClose }: Props) {
  return (
    <aside className="fp-drawer" aria-label="Nastavení grafu">
      <header className="fp-drawer__head">
        <div>
          <p className="fp-drawer__title">Graf</p>
          <p className="fp-drawer__sub">Vzhled svíček, mřížka, indikátory a měřítko.</p>
        </div>
        <button type="button" className="fp-drawer__close" onClick={onClose}>
          Zavřít
        </button>
      </header>
      <div className="fp-drawer__body">
        <section className="fp-drawer__sec">
          <h3>Vzhled</h3>
          <p className="fp-drawer__lead">Jak se kreslí cena a kříž.</p>
          <div className="fp-drawer__item">
            <div className="fp-drawer__item-top">
              <span>Styl</span>
            </div>
            <div className="fp-drawer__seg">
              {(
                [
                  ["candle", "Svíčky"],
                  ["hollow", "Duté"],
                  ["line", "Čára"],
                ] as const
              ).map(([id, lab]) => (
                <button
                  key={id}
                  type="button"
                  className={`fp-drawer__chip ${viz.style === id ? "is-active" : ""}`}
                  onClick={() => onChange({ style: id })}
                >
                  {lab}
                </button>
              ))}
            </div>
          </div>
          <div className="fp-drawer__item">
            <div className="fp-drawer__item-top">
              <span>Kříž</span>
            </div>
            <div className="fp-drawer__seg">
              {(
                [
                  ["normal", "Normální"],
                  ["magnet", "Magnet"],
                  ["off", "Vyp"],
                ] as const
              ).map(([id, lab]) => (
                <button
                  key={id}
                  type="button"
                  className={`fp-drawer__chip ${viz.crosshair === id ? "is-active" : ""}`}
                  onClick={() => onChange({ crosshair: id })}
                >
                  {lab}
                </button>
              ))}
            </div>
          </div>
          <label className="fp-drawer__toggle">
            <input type="checkbox" checked={viz.grid} onChange={(e) => onChange({ grid: e.target.checked })} />
            <span>
              <span className="fp-drawer__toggle-lab">Mřížka</span>
              <span className="fp-drawer__hint">Vodorovné a svislé čáry v pozadí.</span>
            </span>
          </label>
          <label className="fp-drawer__toggle">
            <input type="checkbox" checked={viz.wicks} onChange={(e) => onChange({ wicks: e.target.checked })} />
            <span>
              <span className="fp-drawer__toggle-lab">Knoty</span>
              <span className="fp-drawer__hint">High / low čárky na svíčkách.</span>
            </span>
          </label>
          <label className="fp-drawer__toggle">
            <input
              type="checkbox"
              checked={viz.priceLine}
              onChange={(e) => onChange({ priceLine: e.target.checked })}
            />
            <span>
              <span className="fp-drawer__toggle-lab">Čára poslední ceny</span>
              <span className="fp-drawer__hint">Vodorovná čárkovaná čára na last.</span>
            </span>
          </label>
          <label className="fp-drawer__toggle">
            <input
              type="checkbox"
              checked={viz.lastValue}
              onChange={(e) => onChange({ lastValue: e.target.checked })}
            />
            <span>
              <span className="fp-drawer__toggle-lab">Label na ose</span>
              <span className="fp-drawer__hint">Číslo poslední ceny vpravo na ose.</span>
            </span>
          </label>
          <label className="fp-drawer__toggle">
            <input
              type="checkbox"
              checked={viz.logScale}
              onChange={(e) => onChange({ logScale: e.target.checked })}
            />
            <span>
              <span className="fp-drawer__toggle-lab">Logaritmická škála</span>
              <span className="fp-drawer__hint">Stejné procento = stejná vzdálenost na ose.</span>
            </span>
          </label>
        </section>

        <section className="fp-drawer__sec">
          <h3>Indikátory</h3>
          <p className="fp-drawer__lead">Čáry přes graf. Volume histogram je dole nad tabulkou footprintu.</p>
          <label className="fp-drawer__toggle">
            <input type="checkbox" checked={viz.sma20} onChange={(e) => onChange({ sma20: e.target.checked })} />
            <span>
              <span className="fp-drawer__toggle-lab">SMA 20</span>
            </span>
          </label>
          <label className="fp-drawer__toggle">
            <input type="checkbox" checked={viz.sma50} onChange={(e) => onChange({ sma50: e.target.checked })} />
            <span>
              <span className="fp-drawer__toggle-lab">SMA 50</span>
            </span>
          </label>
          <label className="fp-drawer__toggle">
            <input type="checkbox" checked={viz.ema20} onChange={(e) => onChange({ ema20: e.target.checked })} />
            <span>
              <span className="fp-drawer__toggle-lab">EMA 20</span>
            </span>
          </label>
          <label className="fp-drawer__toggle">
            <input type="checkbox" checked={viz.rsi} onChange={(e) => onChange({ rsi: e.target.checked })} />
            <span>
              <span className="fp-drawer__toggle-lab">RSI 14</span>
            </span>
          </label>
          <label className="fp-drawer__toggle">
            <input type="checkbox" checked={viz.volume} onChange={(e) => onChange({ volume: e.target.checked })} />
            <span>
              <span className="fp-drawer__toggle-lab">Volume histogram</span>
            </span>
          </label>
        </section>

        <section className="fp-drawer__sec">
          <h3>Měřítko</h3>
          <div className="fp-drawer__item">
            <div className="fp-drawer__item-top">
              <span>Šířka svíček</span>
              <span className="fp-drawer__item-val">{viz.barSpacing} px</span>
            </div>
            <p className="fp-drawer__hint">Širší sloupec = víc místa na footprint čísla.</p>
            <input
              type="range"
              min={4}
              max={72}
              value={viz.barSpacing}
              onChange={(e) => onChange({ barSpacing: Number(e.target.value) })}
            />
          </div>
          <div className="fp-drawer__item">
            <div className="fp-drawer__item-top">
              <span>Pravý okraj</span>
              <span className="fp-drawer__item-val">{viz.rightOffset <= 0 ? "lepit" : `${viz.rightOffset}`}</span>
            </div>
            <p className="fp-drawer__hint">Místo napravo od poslední svíčky. 0 drží live cenu u osy.</p>
            <input
              type="range"
              min={0}
              max={12}
              value={viz.rightOffset >= 6 ? 0 : viz.rightOffset}
              onChange={(e) => onChange({ rightOffset: Number(e.target.value) })}
            />
          </div>
        </section>

        <button type="button" className="fp-drawer__reset" onClick={onReset}>
          Výchozí
        </button>
      </div>
    </aside>
  );
}
