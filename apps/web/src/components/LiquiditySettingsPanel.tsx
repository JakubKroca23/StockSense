"use client";

import { BOOK_LIMITS, clampBookLimit, clampLiqProfile, type HeatVizSettings } from "@/lib/liquidity";

type Props = {
  showHeatmap: boolean;
  onToggleHeatmap: (on: boolean) => void;
  heatViz: HeatVizSettings;
  onHeatViz: (patch: Partial<HeatVizSettings>) => void;
  onReset: () => void;
  heatOpacity: number;
  onOpacity: (n: number) => void;
  onClose: () => void;
};

export function LiquiditySettingsPanel({
  showHeatmap,
  onToggleHeatmap,
  heatViz,
  onHeatViz,
  onReset,
  heatOpacity,
  onOpacity,
  onClose,
}: Props) {
  return (
    <aside className="fp-drawer" aria-label="Nastavení likvidity">
      <header className="fp-drawer__head">
        <div>
          <p className="fp-drawer__title">Likvidita</p>
          <p className="fp-drawer__sub">Heatmapa knihy, S/R zóny a jak hrubě se slučují tický.</p>
        </div>
        <button type="button" className="fp-drawer__close" onClick={onClose}>
          Zavřít
        </button>
      </header>
      <div className="fp-drawer__body">
        <section className="fp-drawer__sec">
          <h3>Na grafu</h3>
          <label className="fp-drawer__toggle">
            <input
              type="checkbox"
              checked={showHeatmap}
              onChange={(e) => onToggleHeatmap(e.target.checked)}
            />
            <span>
              <span className="fp-drawer__toggle-lab">Heatmapa na grafu</span>
              <span className="fp-drawer__hint">Bid/ask hloubka jako pruhy vpravo od svíček.</span>
            </span>
          </label>
          <div className="fp-drawer__item">
            <div className="fp-drawer__item-top">
              <span>Šířka sloupce</span>
              <span className="fp-drawer__item-val">
                {Math.round(clampLiqProfile(heatViz.profileWidth) * 100)} %
              </span>
            </div>
            <p className="fp-drawer__hint">
              Jak široký je kumulovaný sloupec vpravo. Můžeš ho i chytit za hranu a táhnout.
            </p>
            <input
              type="range"
              min={4}
              max={50}
              value={Math.round(clampLiqProfile(heatViz.profileWidth) * 100)}
              onChange={(e) => onHeatViz({ profileWidth: Number(e.target.value) / 100 })}
            />
          </div>
          <label className="fp-drawer__toggle">
            <input
              type="checkbox"
              checked={heatViz.zones}
              onChange={(e) => onHeatViz({ zones: e.target.checked })}
            />
            <span>
              <span className="fp-drawer__toggle-lab">S/R na grafu</span>
              <span className="fp-drawer__hint">Zvýrazní nejbližší support / resistence z knihy.</span>
            </span>
          </label>
          <label className="fp-drawer__toggle">
            <input
              type="checkbox"
              checked={heatViz.vacuums}
              onChange={(e) => onHeatViz({ vacuums: e.target.checked })}
            />
            <span>
              <span className="fp-drawer__toggle-lab">Vakua</span>
              <span className="fp-drawer__hint">Místa v knize, kde skoro nikdo nestojí.</span>
            </span>
          </label>
          <label className="fp-drawer__toggle">
            <input
              type="checkbox"
              checked={heatViz.cumulative}
              onChange={(e) => onHeatViz({ cumulative: e.target.checked })}
            />
            <span>
              <span className="fp-drawer__toggle-lab">Kumulativní hloubka</span>
              <span className="fp-drawer__hint">Pruh = součet od trhu až sem. Vypnuto = jen objem na dané ceně.</span>
            </span>
          </label>
        </section>

        <section className="fp-drawer__sec">
          <h3>Kniha</h3>
          <p className="fp-drawer__lead">Jak se L2 slučuje a co se počítá jako stěna.</p>
          <div className="fp-drawer__item">
            <div className="fp-drawer__item-top">
              <span>Rozsah orderbooku</span>
              <span className="fp-drawer__item-val">{clampBookLimit(heatViz.bookLimit)} úrovní</span>
            </div>
            <p className="fp-drawer__hint">
              Kolik cen na každou stranu stáhne Bybit. Víc = kumulace jde dál od trhu, méně = jen blízko ceny.
            </p>
            <div className="fp-drawer__seg">
              {BOOK_LIMITS.map((n) => (
                <button
                  key={n}
                  type="button"
                  className={`fp-drawer__chip ${clampBookLimit(heatViz.bookLimit) === n ? "is-active" : ""}`}
                  onClick={() => onHeatViz({ bookLimit: n })}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
          <div className="fp-drawer__item">
            <div className="fp-drawer__item-top">
              <span>Tick</span>
              <span className="fp-drawer__item-val">×{heatViz.tickGroup}</span>
            </div>
            <p className="fp-drawer__hint">Sloučí sousední ceny — hrubší tick = silnější S/R.</p>
            <div className="fp-drawer__seg">
              {([1, 2, 5, 10] as const).map((n) => (
                <button
                  key={n}
                  type="button"
                  className={`fp-drawer__chip ${heatViz.tickGroup === n ? "is-active" : ""}`}
                  onClick={() => onHeatViz({ tickGroup: n })}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
          <div className="fp-drawer__item">
            <div className="fp-drawer__item-top">
              <span>Rozložení objemu</span>
              <span className="fp-drawer__item-val">
                {heatViz.volumeWeight <= 0.03
                  ? "jen úrovně"
                  : heatViz.volumeWeight >= 0.97
                    ? "jen kontrakty"
                    : `${Math.round((heatViz.volumeWeight ?? 0) * 100)} %`}
              </span>
            </div>
            <p className="fp-drawer__hint">0 = každá cena stejně, 100 = práh podle toho, kde leží kontrakty.</p>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round((heatViz.volumeWeight ?? 0) * 100)}
              onChange={(e) => onHeatViz({ volumeWeight: Number(e.target.value) / 100 })}
            />
          </div>
          <div className="fp-drawer__item">
            <div className="fp-drawer__item-top">
              <span>Skrýt slabé</span>
              <span className="fp-drawer__item-val">
                {heatViz.noisePct <= 0.01 ? "vyp" : `spodních ${Math.round(heatViz.noisePct * 100)} %`}
              </span>
            </div>
            <p className="fp-drawer__hint">Nejmenší podíl knihy zmizí z profilu i z S/R.</p>
            <input
              type="range"
              min={0}
              max={50}
              value={Math.round(heatViz.noisePct * 100)}
              onChange={(e) => onHeatViz({ noisePct: Number(e.target.value) / 100 })}
            />
          </div>
          <div className="fp-drawer__item">
            <div className="fp-drawer__item-top">
              <span>Práh S/R</span>
              <span className="fp-drawer__item-val">
                největších {Math.max(3, 100 - Math.round(heatViz.wallPct * 100))} %
              </span>
            </div>
            <p className="fp-drawer__hint">Níž = S/R blíž k ceně, výš = jen velké stěny.</p>
            <input
              type="range"
              min={55}
              max={95}
              value={Math.round(heatViz.wallPct * 100)}
              onChange={(e) => onHeatViz({ wallPct: Number(e.target.value) / 100 })}
            />
          </div>
          <div className="fp-drawer__item">
            <div className="fp-drawer__item-top">
              <span>Kontrast</span>
              <span className="fp-drawer__item-val">{heatViz.gamma.toFixed(2)}</span>
            </div>
            <p className="fp-drawer__hint">Nižší číslo = silné úrovně víc vyčnívají.</p>
            <input
              type="range"
              min={35}
              max={140}
              value={Math.round(heatViz.gamma * 100)}
              onChange={(e) => onHeatViz({ gamma: Number(e.target.value) / 100 })}
            />
          </div>
          <div className="fp-drawer__item">
            <div className="fp-drawer__item-top">
              <span>Průhlednost</span>
              <span className="fp-drawer__item-val">{Math.round(heatOpacity * 100)}%</span>
            </div>
            <p className="fp-drawer__hint">Jak sytá je heatmapa na grafu.</p>
            <input
              type="range"
              min={20}
              max={100}
              value={Math.round(heatOpacity * 100)}
              onChange={(e) => onOpacity(Number(e.target.value) / 100)}
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
