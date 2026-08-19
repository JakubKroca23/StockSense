"use client";

import { useEffect, useMemo, useState } from "react";
import { TICK_GROUPS, activeClusterFormat, clusterFormatPatch, readOrderflowTheme, type OrderflowSettings } from "@/lib/orderflow";
import { SettingsActionRow } from "@/components/SettingsActionRow";
import { useThemeRevision } from "@/lib/theme";

type Props = {
  settings: OrderflowSettings;
  tick: number;
  onChange: (patch: Partial<OrderflowSettings>) => void;
  onReset: () => void;
  onSaveDefault?: () => void;
  /** V grafu se používají jen volby, které overlay skutečně kreslí. */
  mode?: "chart" | "panel";
  inDeskMenu?: boolean;
};

type FpSectionId = "cluster" | "heat" | "imbalance" | "signals" | "footer";

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

export function FootprintSettingsPanel({
  settings,
  tick,
  onChange,
  onReset,
  onSaveDefault,
  mode = "panel",
  inDeskMenu = false,
}: Props) {
  const step = tick * settings.tickGroup;
  const chart = mode === "chart";
  const themeRev = useThemeRevision();
  const themeColors = useMemo(() => readOrderflowTheme(), [themeRev]);
  const sections = useMemo(
    () =>
      [
        { id: "cluster", label: "Cluster" },
        { id: "heat", label: "Heat" },
        { id: "imbalance", label: "Imbalance" },
        { id: "signals", label: "Signály" },
        { id: "footer", label: "Spodní tabulka" },
      ] as const satisfies ReadonlyArray<{ id: FpSectionId; label: string }>,
    []
  );
  const [active, setActive] = useState<FpSectionId>("cluster");

  useEffect(() => {
    if (!sections.some((section) => section.id === active)) {
      setActive("cluster");
    }
  }, [active, sections]);

  return (
    <section className={`settings-block${inDeskMenu ? " is-desk-menu" : " is-compact"}`}>
      <div className="settings-chart">
        {chart && !inDeskMenu ? (
          <p className="fp-drawer__lead">
            Footprint se kreslí přímo do svíčkového grafu. Zoom času a ceny řeší samotný graf —
            níže jsou jen volby, které overlay skutečně používá.
          </p>
        ) : null}

        <nav className="fp-drawer__tabs" aria-label="Sekce footprint nastavení">
          {sections.map((section) => (
            <button
              key={section.id}
              type="button"
              className={`fp-drawer__tab${active === section.id ? " is-active" : ""}`}
              onClick={() => setActive(section.id)}
            >
              {section.label}
            </button>
          ))}
        </nav>

        {active === "cluster" ? (
        <section className="fp-drawer__sec">
          <h3>Cluster</h3>
          <p className="fp-drawer__lead">Rozložení sloupce: text, heatmapa, svíčka a profil.</p>
          <div className="fp-drawer__item">
            <div className="fp-drawer__item-top">
              <span>Formát clusteru</span>
            </div>
            <p className="fp-drawer__hint">
              Ladder = čísla. Profile = histogram bid/ask nebo delty na každé hladině.
            </p>
            <div className="fp-drawer__seg">
              {(
                [
                  ["bidask-ladder", "Bid Ask Ladder"],
                  ["bidask-profile", "Bid Ask Profile"],
                  ["delta-ladder", "Delta Ladder"],
                  ["delta-profile", "Delta Profile"],
                ] as const
              ).map(([id, lab]) => (
                <button
                  key={id}
                  type="button"
                  className={`fp-drawer__chip ${activeClusterFormat(settings) === id ? "is-active" : ""}`}
                  onClick={() => onChange(clusterFormatPatch(id))}
                >
                  {lab}
                </button>
              ))}
            </div>
          </div>
          <div className="fp-drawer__item">
            <div className="fp-drawer__item-top">
              <span>Rychlé rozložení</span>
            </div>
            <div className="fp-drawer__seg">
              {(
                [
                  ["bidask-mid", "Bid×Ask střed"],
                  ["bidask-left", "Bid×Ask vlevo"],
                  ["delta", "Delta"],
                  ["candle", "Svíčky"],
                  ["prof-left", "Profil vlevo"],
                  ["prof-right", "Profil vpravo"],
                ] as const
              ).map(([id, lab]) => (
                <button
                  key={id}
                  type="button"
                  className="fp-drawer__chip"
                  onClick={() => {
                    if (id === "bidask-mid") {
                      onChange({
                        cellMode: "bidask",
                        showText: true,
                        heatMode: "off",
                        candlePosition: "center",
                        showCandle: true,
                        profileSide: "off",
                      });
                    } else if (id === "bidask-left") {
                      onChange({
                        cellMode: "bidask",
                        showText: true,
                        heatMode: "volume",
                        candlePosition: "left",
                        showCandle: true,
                        profileSide: "off",
                      });
                    } else if (id === "delta") {
                      onChange({
                        cellMode: "delta",
                        showText: true,
                        heatMode: "delta",
                        candlePosition: "center",
                        showCandle: true,
                        profileSide: "off",
                      });
                    } else if (id === "candle") {
                      onChange({
                        cellMode: "bidask",
                        showText: false,
                        heatMode: "off",
                        candlePosition: "center",
                        showCandle: true,
                        profileSide: "off",
                      });
                    } else if (id === "prof-left") {
                      onChange({
                        cellMode: "bidask",
                        showText: false,
                        heatMode: "off",
                        candlePosition: "right",
                        showCandle: true,
                        profileSide: "left",
                        profileStyle: "bars",
                      });
                    } else {
                      onChange({
                        cellMode: "bidask",
                        showText: false,
                        heatMode: "off",
                        candlePosition: "left",
                        showCandle: true,
                        profileSide: "right",
                        profileStyle: "bars",
                      });
                    }
                  }}
                >
                  {lab}
                </button>
              ))}
            </div>
          </div>
          <div className="fp-drawer__item">
            <div className="fp-drawer__item-top">
              <span>Text v buňce</span>
            </div>
            <p className="fp-drawer__hint">
              Bid × Ask = prodeje vlevo, nákupy vpravo. Delta = ask − bid. Objem = součet.
            </p>
            <div className="fp-drawer__seg">
              {(
                [
                  ["bidask", "Bid × Ask"],
                  ["delta", "Delta"],
                  ["volume", "Objem"],
                  ["profile", "Profil buňky"],
                ] as const
              ).map(([id, lab]) => (
                <button
                  key={id}
                  type="button"
                  className={`fp-drawer__chip ${settings.cellMode === id ? "is-active" : ""}`}
                  onClick={() => onChange({ cellMode: id, showText: true })}
                >
                  {lab}
                </button>
              ))}
            </div>
          </div>
          {settings.cellMode === "profile" ? (
            <>
              <div className="fp-drawer__item">
                <div className="fp-drawer__item-top">
                  <span>Vykreslení profilu</span>
                </div>
                <p className="fp-drawer__hint">
                  `Bary` kreslí bid/ask pruhy vlevo/vpravo. `Plná buňka` vybarví celý cell podle metriky.
                </p>
                <div className="fp-drawer__seg">
                  {(
                    [
                      ["bars", "Bary"],
                      ["cells", "Plná buňka"],
                    ] as const
                  ).map(([id, lab]) => (
                    <button
                      key={id}
                      type="button"
                      className={`fp-drawer__chip ${settings.profileStyle === id ? "is-active" : ""}`}
                      onClick={() => onChange({ profileStyle: id })}
                    >
                      {lab}
                    </button>
                  ))}
                </div>
              </div>
              {settings.profileStyle === "cells" ? (
                <div className="fp-drawer__item">
                  <div className="fp-drawer__item-top">
                    <span>Metrika výplně</span>
                  </div>
                  <p className="fp-drawer__hint">
                    Podle čeho se počítá intenzita barvy celé buňky v profile režimu.
                  </p>
                  <div className="fp-drawer__seg">
                    {(
                      [
                        ["volume", "Objem"],
                        ["delta", "Delta"],
                      ] as const
                    ).map(([id, lab]) => (
                      <button
                        key={id}
                        type="button"
                        className={`fp-drawer__chip ${settings.profileCellMetric === id ? "is-active" : ""}`}
                        onClick={() => onChange({ profileCellMetric: id })}
                      >
                        {lab}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </>
          ) : null}
          <div className="fp-drawer__item">
            <div className="fp-drawer__item-top">
              <span>Ticků na řádek</span>
              <span className="fp-drawer__item-val">
                {settings.tickGroup} · {step.toFixed(Math.max(0, Math.ceil(-Math.log10(step))))}
              </span>
            </div>
            <p className="fp-drawer__hint">
              Slučování ticků do jedné cenové hladiny. Vyšší číslo = méně řádků, přehlednější
              clustery.
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
          {!chart ? (
            <>
              <div className="fp-drawer__item">
                <div className="fp-drawer__item-top">
                  <span>Šířka sloupce</span>
                  <span className="fp-drawer__item-val">{settings.barWidth} px</span>
                </div>
                <p className="fp-drawer__hint">Šířka cluster sloupce v samostatném footprint panelu.</p>
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
            </>
          ) : null}
          <label className="fp-drawer__toggle">
            <input
              type="checkbox"
              checked={settings.showText}
              onChange={(e) => onChange({ showText: e.target.checked })}
            />
            <span>
              <span className="fp-drawer__toggle-lab">Čísla v buňkách</span>
              <span className="fp-drawer__hint">
                {chart
                  ? "Bid/ask, delta nebo objem vedle svíčky."
                  : "Při malém zoomu se skryjí automaticky."}
              </span>
            </span>
          </label>
          <div className="fp-drawer__item">
            <div className="fp-drawer__item-top">
              <span>Svíčka</span>
            </div>
            <p className="fp-drawer__hint">
              Uprostřed sedí mezi bidy a asky. Vlevo/vpravo je na kraji sloupce.
            </p>
            <div className="fp-drawer__seg">
              {(
                [
                  ["off", "Vyp"],
                  ["left", "Vlevo"],
                  ["center", "Uprostřed"],
                  ["right", "Vpravo"],
                ] as const
              ).map(([id, lab]) => (
                <button
                  key={id}
                  type="button"
                  className={`fp-drawer__chip ${
                    (settings.candlePosition ?? (settings.showCandle ? "left" : "off")) === id
                      ? "is-active"
                      : ""
                  }`}
                  onClick={() => onChange({ candlePosition: id, showCandle: id !== "off" })}
                >
                  {lab}
                </button>
              ))}
            </div>
          </div>
          <div className="fp-drawer__item">
            <div className="fp-drawer__item-top">
              <span>Profil u svíčky</span>
            </div>
            <p className="fp-drawer__hint">
              Histogram nalevo nebo napravo od svíčky. Obě strany = bid vlevo, ask vpravo.
            </p>
            <div className="fp-drawer__seg">
              {(
                [
                  ["off", "Vyp"],
                  ["left", "Vlevo"],
                  ["right", "Vpravo"],
                  ["both", "Obě"],
                ] as const
              ).map(([id, lab]) => (
                <button
                  key={id}
                  type="button"
                  className={`fp-drawer__chip ${
                    (settings.profileSide ?? "off") === id ? "is-active" : ""
                  }`}
                  onClick={() =>
                    onChange({
                      profileSide: id,
                      profileStyle: id === "off" ? settings.profileStyle : "bars",
                    })
                  }
                >
                  {lab}
                </button>
              ))}
            </div>
            {(settings.profileSide ?? "off") !== "off" ? (
              <div className="fp-drawer__seg" style={{ marginTop: "0.45rem" }}>
                {(
                  [
                    ["volume", "Objem"],
                    ["delta", "Delta"],
                  ] as const
                ).map(([id, lab]) => (
                  <button
                    key={id}
                    type="button"
                    className={`fp-drawer__chip ${
                      (settings.profileCellMetric ?? "volume") === id ? "is-active" : ""
                    }`}
                    onClick={() => onChange({ profileCellMetric: id })}
                  >
                    {lab}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <div className="fp-drawer__item">
            <div className="fp-drawer__item-top">
              <span>Barvy</span>
            </div>
            <p className="fp-drawer__hint">Profil, svíčka a písmo. Prázdné = barvy z tématu.</p>
            <div className="fp-drawer__colors">
              <ColorField
                label="Nákup / ask"
                hint="Ask strana, kladná delta, nákupní bary profilu."
                value={settings.upColor}
                fallback={themeColors.up}
                onChange={(upColor) => onChange({ upColor })}
              />
              <ColorField
                label="Prodej / bid"
                hint="Bid strana, záporná delta, prodejní bary profilu."
                value={settings.downColor}
                fallback={themeColors.down}
                onChange={(downColor) => onChange({ downColor })}
              />
              <ColorField
                label="Svíčka nákup"
                hint="Tělo a knot cluster svíčky při close ≥ open."
                value={settings.candleUpColor}
                fallback={themeColors.candleUp}
                onChange={(candleUpColor) => onChange({ candleUpColor })}
              />
              <ColorField
                label="Svíčka prodej"
                hint="Tělo a knot cluster svíčky při close < open."
                value={settings.candleDownColor}
                fallback={themeColors.candleDown}
                onChange={(candleDownColor) => onChange({ candleDownColor })}
              />
              <ColorField
                label="Písmo nákup"
                hint="Čísla ask strany a kladné delty."
                value={settings.fontBuyColor}
                fallback={settings.upColor?.trim() || themeColors.up}
                onChange={(fontBuyColor) => onChange({ fontBuyColor })}
              />
              <ColorField
                label="Písmo prodej"
                hint="Čísla bid strany a záporné delty."
                value={settings.fontSellColor}
                fallback={settings.downColor?.trim() || themeColors.down}
                onChange={(fontSellColor) => onChange({ fontSellColor })}
              />
              <ColorField
                label="Písmo"
                hint="Objem a neutrální čísla v clusteru."
                value={settings.textColor}
                fallback={themeColors.text}
                onChange={(textColor) => onChange({ textColor })}
              />
            </div>
          </div>
        </section>
        ) : null}

        {active === "heat" ? (
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
              <span>Síla podbarvení</span>
              <span className="fp-drawer__item-val">{settings.heatOpacity} %</span>
            </div>
            <p className="fp-drawer__hint">Jak výrazně heat mapa překrývá cluster.</p>
            <input
              type="range"
              min={0}
              max={100}
              value={settings.heatOpacity}
              onChange={(e) => onChange({ heatOpacity: Number(e.target.value) })}
            />
          </div>
          <div className="fp-drawer__item">
            <div className="fp-drawer__item-top">
              <span>Normalizace</span>
            </div>
            <p className="fp-drawer__hint">
              „Per bar" — intenzita podle maxima v jedné svíčce. „Globální" — podle maxima celé viditelné série.
            </p>
            <div className="fp-drawer__seg">
              {(
                [
                  ["bar", "Per bar"],
                  ["global", "Globální"],
                ] as const
              ).map(([id, lab]) => (
                <button
                  key={id}
                  type="button"
                  className={`fp-drawer__chip ${settings.heatScale === id ? "is-active" : ""}`}
                  onClick={() => onChange({ heatScale: id })}
                >
                  {lab}
                </button>
              ))}
            </div>
          </div>
          <div className="fp-drawer__item">
            <div className="fp-drawer__item-top">
              <span>Barvy</span>
            </div>
            <p className="fp-drawer__hint">Delta heat bere nákup/prodej, objem heat bere akcent.</p>
            <div className="fp-drawer__colors">
              <ColorField
                label="Nákup / ask"
                hint="Kladná delta v heat mapě."
                value={settings.upColor}
                fallback={themeColors.up}
                onChange={(upColor) => onChange({ upColor })}
              />
              <ColorField
                label="Prodej / bid"
                hint="Záporná delta v heat mapě."
                value={settings.downColor}
                fallback={themeColors.down}
                onChange={(downColor) => onChange({ downColor })}
              />
              <ColorField
                label="Akcent"
                hint="Heat mapa podle objemu."
                value={settings.senseColor}
                fallback={themeColors.sense}
                onChange={(senseColor) => onChange({ senseColor })}
              />
            </div>
          </div>
        </section>
        ) : null}

        {active === "imbalance" ? (
        <section className="fp-drawer__sec">
          <h3>Imbalance</h3>
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
              <span className="fp-drawer__hint">Tečka na kraji buňky při extrémním poměru bid/ask.</span>
            </span>
          </label>
          {settings.showImbalance ? (
            <div className="fp-drawer__item">
              <div className="fp-drawer__item-top">
                <span>Zvýraznit</span>
              </div>
              <p className="fp-drawer__hint">
                Jen stacked = tečky jen u imbalancí, které tvoří stacked sérii.
              </p>
              <div className="fp-drawer__seg">
                {(
                  [
                    ["all", "Všechny"],
                    ["stacked", "Jen stacked"],
                  ] as const
                ).map(([id, lab]) => (
                  <button
                    key={id}
                    type="button"
                    className={`fp-drawer__chip ${
                      (settings.imbalanceHighlight ?? "all") === id ? "is-active" : ""
                    }`}
                    onClick={() => onChange({ imbalanceHighlight: id })}
                  >
                    {lab}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
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
          <div className="fp-drawer__item">
            <div className="fp-drawer__item-top">
              <span>Opacita imbalance</span>
              <span className="fp-drawer__item-val">{settings.imbalanceFillOpacity} %</span>
            </div>
            <p className="fp-drawer__hint">Výraznost tečky na kraji buňky.</p>
            <input
              type="range"
              min={5}
              max={80}
              value={settings.imbalanceFillOpacity}
              onChange={(e) => onChange({ imbalanceFillOpacity: Number(e.target.value) })}
            />
          </div>
          <div className="fp-drawer__item">
            <div className="fp-drawer__item-top">
              <span>Opacita stacked imbalance</span>
              <span className="fp-drawer__item-val">{settings.imbalanceStackedFillOpacity} %</span>
            </div>
            <p className="fp-drawer__hint">Výraznost stacked tečky.</p>
            <input
              type="range"
              min={5}
              max={80}
              value={settings.imbalanceStackedFillOpacity}
              onChange={(e) => onChange({ imbalanceStackedFillOpacity: Number(e.target.value) })}
            />
          </div>
          <div className="fp-drawer__item">
            <div className="fp-drawer__item-top">
              <span>Barvy</span>
            </div>
            <p className="fp-drawer__hint">Podbarvení buy a sell imbalance buněk. Prázdné = barvy z tématu.</p>
            <div className="fp-drawer__colors">
              <ColorField
                label="Imbalance buy"
                hint="Zvýraznění buy imbalance."
                value={settings.imbalanceBuyColor}
                fallback={themeColors.up}
                onChange={(imbalanceBuyColor) => onChange({ imbalanceBuyColor })}
              />
              <ColorField
                label="Imbalance sell"
                hint="Zvýraznění sell imbalance."
                value={settings.imbalanceSellColor}
                fallback={themeColors.down}
                onChange={(imbalanceSellColor) => onChange({ imbalanceSellColor })}
              />
            </div>
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
            <p className="fp-drawer__hint">Kolik po sobě jdoucích imbalancí tvoří stacked zónu.</p>
            <input
              type="range"
              min={2}
              max={8}
              value={settings.stackedMin}
              onChange={(e) => onChange({ stackedMin: Number(e.target.value) })}
            />
          </div>
          <div className="fp-drawer__item">
            <div className="fp-drawer__item-top">
              <span>Styl okraje zóny</span>
            </div>
            <p className="fp-drawer__hint">
              Zóna se prodlužuje jen do prvního protnutí ceny s vyznačeným pásmem.
            </p>
            <div className="fp-drawer__seg">
              {(
                [
                  ["solid", "Plná"],
                  ["dashed", "Čárkovaná"],
                  ["dotted", "Tečkovaná"],
                ] as const
              ).map(([id, lab]) => (
                <button
                  key={id}
                  type="button"
                  className={`fp-drawer__chip ${settings.stackedLineStyle === id ? "is-active" : ""}`}
                  onClick={() => onChange({ stackedLineStyle: id })}
                >
                  {lab}
                </button>
              ))}
            </div>
          </div>
          <div className="fp-drawer__item">
            <div className="fp-drawer__item-top">
              <span>Tloušťka okraje</span>
              <span className="fp-drawer__item-val">{settings.stackedLineWidth}px</span>
            </div>
            <input
              type="range"
              min={1}
              max={4}
              value={settings.stackedLineWidth}
              onChange={(e) => onChange({ stackedLineWidth: Number(e.target.value) })}
            />
          </div>
          <div className="fp-drawer__item">
            <div className="fp-drawer__item-top">
              <span>Výplň zóny</span>
              <span className="fp-drawer__item-val">{settings.stackedFillOpacity}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={30}
              value={settings.stackedFillOpacity}
              onChange={(e) => onChange({ stackedFillOpacity: Number(e.target.value) })}
            />
          </div>
          <div className="fp-drawer__item">
            <div className="fp-drawer__item-top">
              <span>Viditelnost okraje</span>
              <span className="fp-drawer__item-val">{settings.stackedLineOpacity}%</span>
            </div>
            <input
              type="range"
              min={10}
              max={100}
              value={settings.stackedLineOpacity}
              onChange={(e) => onChange({ stackedLineOpacity: Number(e.target.value) })}
            />
          </div>
        </section>
        ) : null}

        {active === "signals" ? (
        <section className="fp-drawer__sec">
          <h3>Profil a signály</h3>
          <p className="fp-drawer__lead">POC, value area a signály absorpce v rámci svíčky.</p>
          <label className="fp-drawer__toggle">
            <input
              type="checkbox"
              checked={settings.showPoc}
              onChange={(e) => onChange({ showPoc: e.target.checked })}
            />
            <span>
              <span className="fp-drawer__toggle-lab">POC svíčky</span>
              <span className="fp-drawer__hint">Hladina s nejvyšším objemem v baru — rámeček buňky.</span>
            </span>
          </label>
          <label className="fp-drawer__toggle">
            <input
              type="checkbox"
              checked={settings.extendPoc}
              onChange={(e) => onChange({ extendPoc: e.target.checked })}
              disabled={!settings.showPoc}
            />
            <span>
              <span className="fp-drawer__toggle-lab">Protahovat POC do protnutí</span>
              <span className="fp-drawer__hint">
                Každý POC se táhne doprava a končí při prvním protnutí cenou.
              </span>
            </span>
          </label>
          {settings.showPoc && settings.extendPoc ? (
            <>
              <div className="fp-drawer__item">
                <div className="fp-drawer__item-top">
                  <span>Styl POC linie</span>
                </div>
                <div className="fp-drawer__seg">
                  {(
                    [
                      ["solid", "Plná"],
                      ["dashed", "Čárkovaná"],
                      ["dotted", "Tečkovaná"],
                    ] as const
                  ).map(([id, lab]) => (
                    <button
                      key={id}
                      type="button"
                      className={`fp-drawer__chip ${settings.pocLineStyle === id ? "is-active" : ""}`}
                      onClick={() => onChange({ pocLineStyle: id })}
                    >
                      {lab}
                    </button>
                  ))}
                </div>
              </div>
              <div className="fp-drawer__item">
                <div className="fp-drawer__item-top">
                  <span>Tloušťka POC linie</span>
                  <span className="fp-drawer__item-val">{settings.pocLineWidth}px</span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={4}
                  value={settings.pocLineWidth}
                  onChange={(e) => onChange({ pocLineWidth: Number(e.target.value) })}
                />
              </div>
              <div className="fp-drawer__item">
                <div className="fp-drawer__item-top">
                  <span>Viditelnost POC linie</span>
                  <span className="fp-drawer__item-val">{settings.pocLineOpacity}%</span>
                </div>
                <input
                  type="range"
                  min={10}
                  max={100}
                  value={settings.pocLineOpacity}
                  onChange={(e) => onChange({ pocLineOpacity: Number(e.target.value) })}
                />
              </div>
            </>
          ) : null}
          <label className="fp-drawer__toggle">
            <input
              type="checkbox"
              checked={settings.showValueArea}
              onChange={(e) => onChange({ showValueArea: e.target.checked })}
            />
            <span>
              <span className="fp-drawer__toggle-lab">Value Area</span>
              <span className="fp-drawer__hint">Pásmo kolem POC s {settings.valueAreaPct} % objemu svíčky.</span>
            </span>
          </label>
          <div className="fp-drawer__item">
            <div className="fp-drawer__item-top">
              <span>Šířka value area</span>
              <span className="fp-drawer__item-val">{settings.valueAreaPct} %</span>
            </div>
            <p className="fp-drawer__hint">Kolik procent objemu svíčky spadá do value area.</p>
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
              <span className="fp-drawer__hint">Slábnoucí agrese na extrémech knotu — větší šipka na bid/ask straně.</span>
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
                Velká delta bez posunu ceny = pasivní strana nasává — výrazný rámeček s výplní.
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
          {!chart ? (
            <>
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
                <p className="fp-drawer__hint">Boční histogram v samostatném footprint panelu.</p>
                <input
                  type="range"
                  min={40}
                  max={220}
                  value={settings.profileWidth}
                  onChange={(e) => onChange({ profileWidth: Number(e.target.value) })}
                />
              </div>
            </>
          ) : null}
          <div className="fp-drawer__item">
            <div className="fp-drawer__item-top">
              <span>Barvy</span>
            </div>
            <p className="fp-drawer__hint">POC, value area a absorpce. Prázdné = barvy z tématu.</p>
            <div className="fp-drawer__colors">
              <ColorField
                label="Akcent"
                hint="POC, value area a značky signálů."
                value={settings.senseColor}
                fallback={themeColors.sense}
                onChange={(senseColor) => onChange({ senseColor })}
              />
            </div>
          </div>
        </section>
        ) : null}

        {active === "footer" ? (
        <section className="fp-drawer__sec">
          <h3>Spodní tabulka</h3>
          <p className="fp-drawer__lead">
            {chart
              ? "Řádky pod grafem zarovnané na stejné svíčky jako footprint clustery."
              : "Delta, objem a CVD pod cluster sloupci."}
          </p>
          <label className="fp-drawer__toggle">
            <input
              type="checkbox"
              checked={settings.showDeltaRow}
              onChange={(e) => onChange({ showDeltaRow: e.target.checked })}
            />
            <span>
              <span className="fp-drawer__toggle-lab">Řádek Delta</span>
              <span className="fp-drawer__hint">Delta pod každým cluster sloupcem.</span>
            </span>
          </label>
          <label className="fp-drawer__toggle">
            <input
              type="checkbox"
              checked={settings.showMaxDeltaRow}
              onChange={(e) => onChange({ showMaxDeltaRow: e.target.checked })}
            />
            <span>
              <span className="fp-drawer__toggle-lab">Řádek Max Delta</span>
              <span className="fp-drawer__hint">Nejvyšší kladná delta jedné cenové úrovně v baru.</span>
            </span>
          </label>
          <label className="fp-drawer__toggle">
            <input
              type="checkbox"
              checked={settings.showMinDeltaRow}
              onChange={(e) => onChange({ showMinDeltaRow: e.target.checked })}
            />
            <span>
              <span className="fp-drawer__toggle-lab">Řádek Min Delta</span>
              <span className="fp-drawer__hint">Nejnižší záporná delta jedné cenové úrovně v baru.</span>
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
              <span className="fp-drawer__hint">Celkový objem pod každým sloupcem.</span>
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
            <p className="fp-drawer__hint">
              Výška celé tabulky se mění tažením za dělící linku nad ní. Tento posuvník je jen CVD řádek.
            </p>
            <input
              type="range"
              min={28}
              max={180}
              value={settings.cvdHeight}
              onChange={(e) =>
                onChange({ cvdHeight: Number(e.target.value), footerHeight: undefined })
              }
              disabled={!settings.showCvd}
            />
          </div>
          <div className="fp-drawer__item">
            <div className="fp-drawer__item-top">
              <span>Barvy</span>
            </div>
            <p className="fp-drawer__hint">Delta řádky a CVD. Prázdné = barvy z tématu.</p>
            <div className="fp-drawer__colors">
              <ColorField
                label="Nákup / ask"
                hint="Kladná delta v řádcích pod grafem."
                value={settings.upColor}
                fallback={themeColors.up}
                onChange={(upColor) => onChange({ upColor })}
              />
              <ColorField
                label="Prodej / bid"
                hint="Záporná delta v řádcích pod grafem."
                value={settings.downColor}
                fallback={themeColors.down}
                onChange={(downColor) => onChange({ downColor })}
              />
              <ColorField
                label="Akcent"
                hint="CVD linka a volume heatmap ve spodní tabulce."
                value={settings.senseColor}
                fallback={themeColors.sense}
                onChange={(senseColor) => onChange({ senseColor })}
              />
            </div>
          </div>
        </section>
        ) : null}

        <SettingsActionRow onReset={onReset} onSaveDefault={onSaveDefault} />
      </div>
    </section>
  );
}
