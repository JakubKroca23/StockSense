"use client";

type Props = {
  smart: boolean;
  blockSize: number;
  onSmart: (on: boolean) => void;
  onBlockSize: (n: number) => void;
  onClose: () => void;
};

export function TapeSettingsPanel({ smart, blockSize, onSmart, onBlockSize, onClose }: Props) {
  return (
    <aside className="fp-drawer" aria-label="Nastavení tape">
      <header className="fp-drawer__head">
        <div>
          <p className="fp-drawer__title">Tape</p>
          <p className="fp-drawer__sub">Jak se skládají a filtrují last trady v páse.</p>
        </div>
        <button type="button" className="fp-drawer__close" onClick={onClose}>
          Zavřít
        </button>
      </header>
      <div className="fp-drawer__body">
        <section className="fp-drawer__sec">
          <h3>Filtr</h3>
          <p className="fp-drawer__lead">Smart slučuje rychlé printy na stejné ceně. Block schová drobné obchody.</p>
          <label className="fp-drawer__toggle">
            <input type="checkbox" checked={smart} onChange={(e) => onSmart(e.target.checked)} />
            <span>
              <span className="fp-drawer__toggle-lab">Smart tape</span>
              <span className="fp-drawer__hint">
                Spojí po sobě jdoucí printy stejné strany na stejné ceně do jednoho řádku.
              </span>
            </span>
          </label>
          <div className="fp-drawer__item">
            <div className="fp-drawer__item-top">
              <span>Block práh</span>
              <span className="fp-drawer__item-val">{blockSize > 0 ? String(blockSize) : "vypnuto"}</span>
            </div>
            <p className="fp-drawer__hint">Ukaž jen trady s objemem aspoň tolik. 0 = všechno.</p>
            <input
              type="number"
              min={0}
              step="any"
              value={blockSize || ""}
              placeholder="0"
              onChange={(e) => onBlockSize(Math.max(0, Number(e.target.value) || 0))}
            />
          </div>
        </section>
      </div>
    </aside>
  );
}
