"use client";

import { useEffect, useMemo, useState } from "react";
import { ChartSettingsPanel } from "@/components/ChartSettingsPanel";
import { DomSettingsPanel } from "@/components/DomSettingsPanel";
import { FootprintSettingsPanel } from "@/components/FootprintSettingsPanel";
import type { ChartVizSettings } from "@/components/PriceChart";
import type { DomSettings, OrderflowSettings } from "@/lib/orderflow";

type TabId = "chart" | "footprint" | "dom";

type Props = {
  viz: ChartVizSettings;
  onVizChange: (patch: Partial<ChartVizSettings>) => void;
  onVizReset: () => void;
  fpViz: OrderflowSettings;
  onFpChange: (patch: Partial<OrderflowSettings>) => void;
  onFpReset: () => void;
  domViz: DomSettings;
  onDomChange: (patch: Partial<DomSettings>) => void;
  onDomReset: () => void;
  fpTick: number;
  domTick: number;
};

export function ChartDeskSettings({
  viz,
  onVizChange,
  onVizReset,
  fpViz,
  onFpChange,
  onFpReset,
  domViz,
  onDomChange,
  onDomReset,
  fpTick,
  domTick,
}: Props) {
  const tabs = useMemo(() => {
    const items: { id: TabId; label: string; hint: string }[] = [
      { id: "chart", label: "Graf", hint: "Svíčky, indikátory, měřítko" },
    ];
    if (viz.footprint) {
      items.push({ id: "footprint", label: "Footprint", hint: "Orderflow clustery ve svíčkách" });
    }
    if (viz.dom) {
      items.push({ id: "dom", label: "DOM", hint: "Hloubka trhu a heat mapa" });
    }
    return items;
  }, [viz.footprint, viz.dom]);

  const [tab, setTab] = useState<TabId>("chart");

  useEffect(() => {
    if (!tabs.some((t) => t.id === tab)) setTab("chart");
  }, [tabs, tab]);

  const active = tabs.find((t) => t.id === tab) ?? tabs[0];

  return (
    <div className="desk-settings">
      <header className="desk-settings__head">
        <div className="desk-settings__intro">
          <h2 className="desk-settings__title">Nastavení grafu</h2>
          <p className="desk-settings__subtitle">{active.hint}</p>
        </div>
        {tabs.length > 1 ? (
          <nav className="desk-settings__tabs" role="tablist" aria-label="Sekce nastavení">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                className={`desk-settings__tab${tab === t.id ? " is-active" : ""}`}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </nav>
        ) : null}
      </header>

      <div className="desk-settings__body">
        {tab === "chart" ? (
          <ChartSettingsPanel viz={viz} onChange={onVizChange} onReset={onVizReset} inDeskMenu />
        ) : null}
        {tab === "footprint" && viz.footprint ? (
          <FootprintSettingsPanel
            mode="chart"
            inDeskMenu
            settings={fpViz}
            tick={fpTick}
            onChange={onFpChange}
            onReset={onFpReset}
          />
        ) : null}
        {tab === "dom" && viz.dom ? (
          <DomSettingsPanel
            inDeskMenu
            settings={domViz}
            tick={domTick}
            onChange={onDomChange}
            onReset={onDomReset}
          />
        ) : null}
      </div>
    </div>
  );
}
