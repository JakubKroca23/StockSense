"use client";

import { ChartSettingsPanel } from "@/components/ChartSettingsPanel";
import { DomSettingsPanel } from "@/components/DomSettingsPanel";
import { FootprintSettingsPanel } from "@/components/FootprintSettingsPanel";
import { ProfileSettingsPanel } from "@/components/ProfileSettingsPanel";
import { resolveChartKind, type ChartVizSettings } from "@/components/PriceChart";
import type { DomSettings, OrderflowSettings, VolumeProfileSettings } from "@/lib/orderflow";

type Props = {
  viz: ChartVizSettings;
  onVizChange: (patch: Partial<ChartVizSettings>) => void;
  onVizReset: () => void;
  onSaveDefault?: () => void;
  fpViz: OrderflowSettings;
  onFpChange: (patch: Partial<OrderflowSettings>) => void;
  onFpReset: () => void;
  vpViz: VolumeProfileSettings;
  onVpChange: (patch: Partial<VolumeProfileSettings>) => void;
  onVpReset: () => void;
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
  onSaveDefault,
  fpViz,
  onFpChange,
  onFpReset,
  vpViz,
  onVpChange,
  onVpReset,
  domViz,
  onDomChange,
  onDomReset,
  fpTick,
  domTick,
}: Props) {
  const kind = resolveChartKind(viz);
  const subtitle =
    kind === "footprint"
      ? "Orderflow clustery ve svíčkách"
      : kind === "heatmap"
        ? "Likvidita z order booku v čase"
        : kind === "profile"
          ? "TPO písmena a volume profile"
          : "Svíčky, indikátory, měřítko";

  return (
    <div className="desk-settings">
      <header className="desk-settings__head">
        <div className="desk-settings__intro">
          <h2 className="desk-settings__title">Nastavení grafu</h2>
          <p className="desk-settings__subtitle">{subtitle}</p>
        </div>
      </header>

      <div className="desk-settings__body">
        {kind === "candle" ? (
          <ChartSettingsPanel viz={viz} onChange={onVizChange} onReset={onVizReset} onSaveDefault={onSaveDefault} inDeskMenu />
        ) : null}
        {kind === "footprint" ? (
          <FootprintSettingsPanel
            mode="chart"
            inDeskMenu
            settings={fpViz}
            tick={fpTick}
            onChange={onFpChange}
            onReset={onFpReset}
            onSaveDefault={onSaveDefault}
          />
        ) : null}
        {kind === "heatmap" ? (
          <DomSettingsPanel
            inDeskMenu
            mode="chart"
            settings={domViz}
            tick={domTick}
            onChange={onDomChange}
            onReset={onDomReset}
            onSaveDefault={onSaveDefault}
          />
        ) : null}
        {kind === "profile" ? (
          <ProfileSettingsPanel
            inDeskMenu
            settings={vpViz}
            tick={fpTick}
            onChange={onVpChange}
            onReset={onVpReset}
            onSaveDefault={onSaveDefault}
            tpoSettings={fpViz}
            onTpoChange={onFpChange}
          />
        ) : null}
        {(kind === "candle" || kind === "footprint") && viz.volumeProfile ? (
          <ProfileSettingsPanel
            inDeskMenu
            overlay
            settings={vpViz}
            tick={fpTick}
            onChange={onVpChange}
            onReset={onVpReset}
            onSaveDefault={onSaveDefault}
          />
        ) : null}
        {(kind === "candle" || kind === "footprint") && viz.domOverlay ? (
          <DomSettingsPanel
            inDeskMenu
            overlay
            settings={domViz}
            tick={domTick}
            onChange={onDomChange}
            onReset={onDomReset}
            onSaveDefault={onSaveDefault}
          />
        ) : null}
      </div>
    </div>
  );
}
