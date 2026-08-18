"use client";

import type { LiqSnapshot } from "@/lib/liquidity";
import { fmtPx, fmtTicks } from "@/lib/liquidity";

type Props = {
  snapshot: LiqSnapshot | null;
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
      </div>
    </div>
  );
}
