export type AssetClass = "stock" | "commodity" | "crypto" | "etf" | "index" | "other";
export type RiskProfile = "conservative" | "balanced" | "aggressive";
export type DataQuality = "high" | "medium" | "low" | "proxy" | "unavailable";

export interface Instrument {
  id: number;
  symbol: string;
  name: string;
  asset_class: AssetClass;
  exchange?: string | null;
  currency: string;
  is_discovery?: boolean;
}

export interface PortfolioPosition {
  id: number;
  instrument: Instrument;
  quantity: string | number;
  avg_cost: string | number;
  opened_at?: string | null;
  is_paper: boolean;
  notes?: string | null;
  last_price?: number | null;
  market_value?: number | null;
  pnl?: number | null;
  pnl_pct?: number | null;
}

export interface Watchlist {
  id: number;
  name: string;
  items: { id: number; instrument: Instrument; notes?: string | null }[];
}

export interface AlertPrefs {
  alert_kinds?: {
    price_stop?: boolean;
    price_target?: boolean;
    price_rule?: boolean;
  };
  quiet_hours?: {
    enabled?: boolean;
    start?: string;
    end?: string;
    timezone?: string;
  };
}

export interface UserSettings {
  risk_profile: RiskProfile;
  max_position_pct: number;
  alert_email: boolean;
  alert_push: boolean;
  email?: string | null;
  preferences: AlertPrefs & Record<string, unknown>;
  push_configured?: boolean;
  vapid_public_key?: string | null;
}

export interface AlertItem {
  id: number;
  kind: string;
  title: string;
  body: string;
  payload: Record<string, unknown>;
  is_read: boolean;
  created_at: string;
}

export const riskLabel: Record<RiskProfile, string> = {
  conservative: "Konzervativní",
  balanced: "Vyvážený",
  aggressive: "Agresivní",
};
