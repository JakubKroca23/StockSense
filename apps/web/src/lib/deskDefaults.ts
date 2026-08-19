import { DEFAULT_DESK_CHART_VIZ, normalizeChartViz, type ChartVizSettings } from "@/components/PriceChart";
import {
  DEFAULT_DOM_SETTINGS,
  DEFAULT_ORDERFLOW_SETTINGS,
  DEFAULT_VOLUME_PROFILE_SETTINGS,
  normalizeVolumeProfileSettings,
  type DomSettings,
  type OrderflowSettings,
  type VolumeProfileSettings,
} from "@/lib/orderflow";

const CHART_KEY = "stocksense-defaults-chart";
const DOM_KEY = "stocksense-defaults-dom";

export type ChartDefaults = {
  tf: string;
  lb: string;
  viz: ChartVizSettings;
  fpViz: OrderflowSettings;
  vpViz: VolumeProfileSettings;
  domViz: DomSettings;
};

function lsGet(key: string) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function lsSet(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

export function factoryChartDefaults(): ChartDefaults {
  return {
    tf: "1m",
    lb: "1d",
    viz: { ...DEFAULT_DESK_CHART_VIZ },
    fpViz: { ...DEFAULT_ORDERFLOW_SETTINGS },
    vpViz: { ...DEFAULT_VOLUME_PROFILE_SETTINGS },
    domViz: { ...DEFAULT_DOM_SETTINGS },
  };
}

export function readChartDefaults(): ChartDefaults {
  const factory = factoryChartDefaults();
  try {
    const raw = lsGet(CHART_KEY);
    if (!raw) return factory;
    const parsed = JSON.parse(raw) as Partial<ChartDefaults>;
    return {
      tf: typeof parsed.tf === "string" ? parsed.tf : factory.tf,
      lb: typeof parsed.lb === "string" ? parsed.lb : factory.lb,
      viz: normalizeChartViz(parsed.viz),
      fpViz: { ...DEFAULT_ORDERFLOW_SETTINGS, ...(parsed.fpViz ?? {}) },
      vpViz: normalizeVolumeProfileSettings(parsed.vpViz, parsed.vpViz ? null : parsed.fpViz),
      domViz: { ...DEFAULT_DOM_SETTINGS, ...(parsed.domViz ?? {}) },
    };
  } catch {
    return factory;
  }
}

export function writeChartDefaults(next: ChartDefaults) {
  lsSet(CHART_KEY, JSON.stringify(next));
}

export function readDomDefaults(): DomSettings {
  try {
    const raw = lsGet(DOM_KEY);
    if (!raw) return { ...DEFAULT_DOM_SETTINGS };
    return { ...DEFAULT_DOM_SETTINGS, ...(JSON.parse(raw) as Partial<DomSettings>) };
  } catch {
    return { ...DEFAULT_DOM_SETTINGS };
  }
}

export function writeDomDefaults(next: DomSettings) {
  lsSet(DOM_KEY, JSON.stringify(next));
}
