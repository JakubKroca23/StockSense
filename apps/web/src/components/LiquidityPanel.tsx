"use client";

import type { HeatVizSettings, LiqSnapshot } from "@/lib/liquidity";
import { fmtPx, fmtTicks } from "@/lib/liquidity";

type Props = {
  snapshot: LiqSnapshot | null;
  showHeatmap: boolean;
  onToggleHeatmap: (on: boolean) => void;
  heatViz: HeatVizSettings;
  onHeatViz: (patch: Partial<HeatVizSettings>) => void;
  onReset: () => void;
  heatOpacity: number;
  onOpacity: (n: number) => void;
  priceDigits: number;
  collapsed?: boolean;
  onToggle?: () => void;
};

function ZoneRow({
  label,
  zone,
  last,
  tick,
  digits,
}: {
  label: string;
  zone: LiqSnapshot["nearS"];
  last: number;
  tick: number;
  digits: number;
}) {
  if (!zone) {
    return (
      <div className="liq-panel__zone is-empty">
        <span className="liq-panel__tag">{label}</span>
        <span className="muted">—</span>
      </div>
    );
  }
  const tks = fmtTicks(Math.round((zone.poc - last) / tick));
  return (
    <div className={`liq-panel__zone ${zone.support ? "is-s" : "is-r"}`}>
      <span className="liq-panel__tag">{label}</span>
      <span className="liq-panel__px">{fmtPx(zone.poc, digits)}</span>
      <span className="muted">{tks}</span>
      <span className="liq-panel__kind">{zone.magnet ? "magnet" : "zóna"}</span>
    </div>
  );
}

export function LiquidityPanel({
  snapshot,
  showHeatmap,
  onToggleHeatmap,
  heatViz,
  onHeatViz,
  onReset,
  heatOpacity,
  onOpacity,
  priceDigits,
  collapsed = false,
  onToggle,
}: Props) {
  const last = snapshot?.last || 0;
  const tick = snapshot?.tickSize || 0.01;
  const bias = snapshot?.bias || "flat";
  const title = (
    <p className="orderbook__title">
      {onToggle ? <span className="desk-panel__caret">{collapsed ? "▸" : "▾"}</span> : null}
      Likvidita
    </p>
  );

  const summary = snapshot ? (
    <>
      <p className={`liq-panel__bias is-${bias}`}>
        {bias === "up" && snapshot.nearR
          ? `↑ ${fmtTicks(Math.round((snapshot.nearR.poc - last) / tick))} → ${fmtPx(snapshot.nearR.poc, priceDigits)}`
          : bias === "down" && snapshot.nearS
            ? `↓ ${fmtTicks(Math.round((snapshot.nearS.poc - last) / tick))} → ${fmtPx(snapshot.nearS.poc, priceDigits)}`
            : "↔ vyvážená kniha"}
      </p>
      <p className="liq-panel__marks">
        <span className="is-ice">ICE {snapshot.icebergs}</span>
        <span className="is-wall">WALL {snapshot.walls}</span>
        <span className="is-spoof">SPOOF {snapshot.spoofs}</span>
      </p>
    </>
  ) : (
    <p className="muted">Čekám na L2…</p>
  );

  const head = onToggle ? (
    <button
      type="button"
      className="desk-panel__toggle"
      onClick={onToggle}
      aria-expanded={!collapsed}
    >
      {title}
      {summary}
    </button>
  ) : (
    <div className="orderbook__head">
      {title}
      {summary}
    </div>
  );

  if (collapsed) {
    return (
      <div className="liq-panel is-collapsed">
        {head}
      </div>
    );
  }

  const tot = (snapshot?.costUp || 0) + (snapshot?.costDn || 0);
  const upShare = tot > 0 ? snapshot!.costUp / tot : 0.5;

  return (
    <div className="liq-panel">
      {head}
      <div className="liq-panel__body">
        {snapshot ? (
          <div className={`liq-panel__dir is-${bias}`}>
            <span className="liq-panel__dir-arrow" aria-hidden>
              {bias === "up" ? "↑" : bias === "down" ? "↓" : "↔"}
            </span>
            <div className="liq-panel__dir-copy">
              <p className="liq-panel__dir-title">
                {bias === "up"
                  ? "Menší odpor nahoru"
                  : bias === "down"
                    ? "Menší odpor dolů"
                    : "Vyvážená kniha"}
              </p>
              <p className="liq-panel__dir-dest">
                {bias === "up" && snapshot.nearR
                  ? `${fmtTicks(Math.round((snapshot.nearR.poc - last) / tick))} → ${fmtPx(snapshot.nearR.poc, priceDigits)}`
                  : bias === "down" && snapshot.nearS
                    ? `${fmtTicks(Math.round((snapshot.nearS.poc - last) / tick))} → ${fmtPx(snapshot.nearS.poc, priceDigits)}`
                    : "bid i ask stejně hluboké"}
              </p>
            </div>
          </div>
        ) : null}

        <div className="liq-panel__bar" title="Vážená hloubka k nejbližší zóně">
          <span className="liq-panel__bar-dn" style={{ width: `${(1 - upShare) * 100}%` }} />
          <span className="liq-panel__bar-up" style={{ width: `${upShare * 100}%` }} />
        </div>
        <p className="liq-panel__bar-lab">
          <span>bid {(1 - upShare).toFixed(2)}×</span>
          <span>ask {upShare.toFixed(2)}×</span>
        </p>

        <label className="liq-panel__switch">
          <input
            type="checkbox"
            checked={showHeatmap}
            onChange={(e) => onToggleHeatmap(e.target.checked)}
          />
          Heatmapa na grafu
        </label>

        <ZoneRow label="R" zone={snapshot?.nearR ?? null} last={last} tick={tick} digits={priceDigits} />
        <ZoneRow label="S" zone={snapshot?.nearS ?? null} last={last} tick={tick} digits={priceDigits} />

        {snapshot?.rows.some((r) => r.flag) ? (
          <ul className="liq-panel__flags">
            {snapshot.rows
              .filter((r) => r.flag)
              .sort((a, b) => (b.score || 0) - (a.score || 0))
              .slice(0, 8)
              .map((r) => (
                <li key={`${r.flag}-${r.price}`} className={`is-${r.flag}`}>
                  <span>{r.flag === "iceberg" ? "ICE" : r.flag === "wall" ? "WALL" : "SPF"}</span>
                  <span>{fmtPx(r.price, priceDigits)}</span>
                  <span className="muted">{fmtTicks(Math.round((r.price - last) / tick))}</span>
                </li>
              ))}
          </ul>
        ) : null}

        {snapshot && Number.isFinite(snapshot.bestBid) && Number.isFinite(snapshot.bestAsk) && (
          <p className="liq-panel__meta muted">
            spread {fmtPx(snapshot.bestAsk - snapshot.bestBid, Math.max(priceDigits, 2))}
            {snapshot.vacuums[0]
              ? ` · vakuum ${snapshot.vacuums[0].ticks}t ${snapshot.vacuums[0].up ? "↑" : "↓"}`
              : ""}
          </p>
        )}

        <p className="viz-menu__sec">Nastavení</p>
        <div className="viz-menu__row">
          <span className="viz-menu__lab">
            Tick
            <span className="muted">×{heatViz.tickGroup}</span>
          </span>
          <div className="viz-menu__seg">
            {([1, 2, 5, 10] as const).map((n) => (
              <button
                key={n}
                type="button"
                className={`chart-chip chart-chip--soft ${heatViz.tickGroup === n ? "is-active" : ""}`}
                onClick={() => onHeatViz({ tickGroup: n })}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
        <p className="liq-panel__hint">Sloučí sousední ceny — hrubší tick = silnější S/R.</p>
        <label className="viz-menu__row">
          <span className="viz-menu__lab">
            Rozložení objemu
            <span className="muted">
              {heatViz.volumeWeight <= 0.03
                ? "jen úrovně"
                : heatViz.volumeWeight >= 0.97
                  ? "jen kontrakty"
                  : `${Math.round((heatViz.volumeWeight ?? 0) * 100)} % objem`}
            </span>
          </span>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round((heatViz.volumeWeight ?? 0) * 100)}
            onChange={(e) => onHeatViz({ volumeWeight: Number(e.target.value) / 100 })}
          />
        </label>
        <p className="liq-panel__hint">
          0 = každá cena stejně, 100 = práh podle toho, kde leží kontrakty.
        </p>
        <label className="viz-menu__row">
          <span className="viz-menu__lab">
            Skrýt slabé
            <span className="muted">
              {heatViz.noisePct <= 0.01 ? "vyp" : `spodních ${Math.round(heatViz.noisePct * 100)} %`}
            </span>
          </span>
          <input
            type="range"
            min={0}
            max={50}
            value={Math.round(heatViz.noisePct * 100)}
            onChange={(e) => onHeatViz({ noisePct: Number(e.target.value) / 100 })}
          />
        </label>
        <p className="liq-panel__hint">Nejmenší podíl knihy zmizí z profilu i z S/R.</p>
        <label className="viz-menu__row">
          <span className="viz-menu__lab">
            Práh S/R
            <span className="muted">největších {Math.max(3, 100 - Math.round(heatViz.wallPct * 100))} %</span>
          </span>
          <input
            type="range"
            min={55}
            max={95}
            value={Math.round(heatViz.wallPct * 100)}
            onChange={(e) => onHeatViz({ wallPct: Number(e.target.value) / 100 })}
          />
        </label>
        <p className="liq-panel__hint">Níž = S/R blíž k ceně, výš = jen velké stěny.</p>
        <label className="viz-menu__row">
          <span className="viz-menu__lab">
            Kontrast
            <span className="muted">{heatViz.gamma.toFixed(2)}</span>
          </span>
          <input
            type="range"
            min={35}
            max={140}
            value={Math.round(heatViz.gamma * 100)}
            onChange={(e) => onHeatViz({ gamma: Number(e.target.value) / 100 })}
          />
        </label>
        <label className="viz-menu__row">
          <span className="viz-menu__lab">
            α
            <span className="muted">{Math.round(heatOpacity * 100)}%</span>
          </span>
          <input
            type="range"
            min={20}
            max={100}
            value={Math.round(heatOpacity * 100)}
            onChange={(e) => onOpacity(Number(e.target.value) / 100)}
          />
        </label>
        <label className="viz-menu__check">
          <input
            type="checkbox"
            checked={heatViz.zones}
            onChange={(e) => onHeatViz({ zones: e.target.checked })}
          />
          S/R na grafu
        </label>
        <label className="viz-menu__check">
          <input
            type="checkbox"
            checked={heatViz.vacuums}
            onChange={(e) => onHeatViz({ vacuums: e.target.checked })}
          />
          Vakua
        </label>
        <label className="viz-menu__check">
          <input
            type="checkbox"
            checked={heatViz.cumulative}
            onChange={(e) => onHeatViz({ cumulative: e.target.checked })}
          />
          Kumulativní hloubka
        </label>
        <p className="liq-panel__hint">Pruh = součet od trhu až sem. Čísla i šířka podle viditelného rozsahu.</p>
        <button type="button" className="viz-menu__reset" onClick={onReset}>
          Výchozí
        </button>
      </div>
    </div>
  );
}
