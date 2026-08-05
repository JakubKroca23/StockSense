export type AssetClass = "stock" | "commodity" | "crypto" | "etf" | "index" | "other";
export type TipAction = "buy" | "sell" | "hold" | "trade";
export type TipHorizon = "intraday" | "swing" | "position" | "long_term";
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

export interface Tip {
  id: number;
  instrument: Instrument;
  action: TipAction;
  horizon: TipHorizon;
  entry_low?: number | null;
  entry_high?: number | null;
  stop?: number | null;
  target_1?: number | null;
  target_2?: number | null;
  score: number;
  confidence: number;
  scenario_bull?: string | null;
  scenario_base?: string | null;
  scenario_bear?: string | null;
  rationale: Record<string, unknown>;
  risks?: string | null;
  narrative_cs?: string | null;
  data_quality: DataQuality;
  risk_profile: RiskProfile;
  suggested_size_pct?: number | null;
  is_active: boolean;
  as_of: string;
  created_at: string;
}

export interface HomeData {
  portfolio: PortfolioPosition[];
  tips: Tip[];
  alerts_unread: number;
  risk_profile: RiskProfile;
}

export interface Watchlist {
  id: number;
  name: string;
  items: { id: number; instrument: Instrument; notes?: string | null }[];
}

export interface UserSettings {
  risk_profile: RiskProfile;
  max_position_pct: number;
  alert_email: boolean;
  alert_push: boolean;
  email?: string | null;
  preferences: Record<string, unknown>;
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

export interface Report {
  id: number;
  kind: string;
  title: string;
  content_md: string;
  meta: Record<string, unknown>;
  created_at: string;
}

export interface ChatMessage {
  id: number;
  role: string;
  content: string;
  created_at: string;
}

export const actionLabel: Record<TipAction, string> = {
  buy: "Koupit",
  sell: "Prodat",
  hold: "Držet",
  trade: "Tradovat",
};

export const horizonLabel: Record<TipHorizon, string> = {
  intraday: "Intraday",
  swing: "Swing",
  position: "Position",
  long_term: "Dlouhodobě",
};

export const riskLabel: Record<RiskProfile, string> = {
  conservative: "Konzervativní",
  balanced: "Vyvážený",
  aggressive: "Agresivní",
};
