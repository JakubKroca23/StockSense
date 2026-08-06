export type AssetClass = "stock" | "commodity" | "crypto" | "etf" | "index" | "other";
export type TipAction = "long" | "short" | "hold" | "sell";
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

export type TipStatus = "proposed" | "accepted" | "rejected" | "closed";
export type FeedbackResult = "hit" | "miss" | "partial";
export type CloseReason =
  | "stop"
  | "target_1"
  | "target_2"
  | "ttl"
  | "score_flip"
  | "manual";

export interface TipFeedback {
  id: number;
  tip_id: number;
  result: FeedbackResult;
  close_reason?: CloseReason | string | null;
  notes?: string | null;
  created_at: string;
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
  status?: TipStatus | string;
  entry_notes?: string | null;
  as_of: string;
  closed_at?: string | null;
  created_at: string;
  feedback?: TipFeedback | null;
}

export interface TipStats {
  total: number;
  hits: number;
  misses: number;
  partials: number;
  hit_rate: number | null;
  tp_hits?: number;
  sl_hits?: number;
  tp_rate?: number | null;
  by_close_reason?: Record<string, number>;
  score_adj: number;
  by_asset_class?: Record<string, unknown>;
}

export interface TipHistory {
  stats: TipStats;
  tips: Tip[];
}

export interface HomeData {
  portfolio: PortfolioPosition[];
  tips: Tip[];
  alerts_unread: number;
  risk_profile: RiskProfile;
  briefing_cs?: string | null;
  briefing_title?: string | null;
  briefing_at?: string | null;
  tip_stats?: TipStats | null;
  equity?: {
    as_of: string;
    total_value: number;
    total_cost: number;
    pnl: number;
    pnl_pct?: number | null;
  }[];
}

export interface Watchlist {
  id: number;
  name: string;
  items: { id: number; instrument: Instrument; notes?: string | null }[];
}

export interface AlertPrefs {
  alert_kinds?: {
    new_tip?: boolean;
    daily_report?: boolean;
    price_stop?: boolean;
    price_target?: boolean;
    price_rule?: boolean;
    tip_invalidated?: boolean;
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

export const tipStatusLabel: Record<string, string> = {
  proposed: "Navržený",
  accepted: "Přijatý",
  rejected: "Odmítnutý",
  closed: "Uzavřený",
};

export const closeReasonLabel: Record<string, string> = {
  stop: "Stop loss",
  target_1: "Take profit (TP1)",
  target_2: "Take profit (TP2)",
  ttl: "Expirace",
  score_flip: "Změna scoringu",
  manual: "Manuálně",
};

export const feedbackResultLabel: Record<FeedbackResult, string> = {
  hit: "Hit",
  miss: "Miss",
  partial: "Partial",
};

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
  session_id?: number | null;
}

export type ChatSessionStatus = "open" | "minimized" | "saved" | "closed";

export interface ChatSession {
  id: number;
  title: string;
  symbol?: string | null;
  status: ChatSessionStatus;
  preview?: string | null;
  message_count: number;
  created_at: string;
  updated_at: string;
}

export interface ChatTurn {
  session: ChatSession;
  user_message: ChatMessage;
  assistant_message: ChatMessage;
}

export const actionLabel: Record<TipAction, string> = {
  long: "Long",
  short: "Short",
  hold: "Držet",
  sell: "Prodat",
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
