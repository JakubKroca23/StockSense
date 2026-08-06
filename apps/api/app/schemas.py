from datetime import date, datetime
from decimal import Decimal
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.models import (
    AssetClass,
    ChatSessionStatus,
    CloseReason,
    DataQuality,
    FeedbackResult,
    RiskProfile,
    TipAction,
    TipHorizon,
    TipStatus,
)


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class AuthLogin(BaseModel):
    password: str = Field(min_length=1)


class AuthTokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    user: dict[str, str | None]


class InstrumentOut(ORMModel):
    id: int
    symbol: str
    name: str
    asset_class: AssetClass
    exchange: str | None = None
    currency: str
    is_discovery: bool = False


class InstrumentCreate(BaseModel):
    symbol: str
    name: str = ""
    asset_class: AssetClass = AssetClass.stock
    exchange: str | None = None
    currency: str = "USD"
    is_discovery: bool = False


class PriceBarOut(ORMModel):
    ts: datetime
    open: float
    high: float
    low: float
    close: float
    volume: float
    source: str
    data_quality: DataQuality
    as_of: datetime


class WatchlistItemOut(ORMModel):
    id: int
    instrument: InstrumentOut
    notes: str | None = None


class WatchlistOut(ORMModel):
    id: int
    name: str
    items: list[WatchlistItemOut] = []


class WatchlistCreate(BaseModel):
    name: str = "Hlavní"


class WatchlistAddItem(BaseModel):
    symbol: str
    name: str = ""
    asset_class: AssetClass = AssetClass.stock
    notes: str | None = None


class PortfolioPositionCreate(BaseModel):
    symbol: str
    name: str = ""
    asset_class: AssetClass = AssetClass.stock
    quantity: Decimal
    avg_cost: Decimal
    opened_at: date | None = None
    is_paper: bool = False
    notes: str | None = None


class PortfolioPositionUpdate(BaseModel):
    quantity: Decimal | None = None
    avg_cost: Decimal | None = None
    opened_at: date | None = None
    is_paper: bool | None = None
    notes: str | None = None


class PortfolioPositionOut(ORMModel):
    id: int
    instrument: InstrumentOut
    quantity: Decimal
    avg_cost: Decimal
    opened_at: date | None
    is_paper: bool
    notes: str | None
    last_price: float | None = None
    market_value: float | None = None
    pnl: float | None = None
    pnl_pct: float | None = None


class TipFeedbackOut(ORMModel):
    id: int
    tip_id: int
    result: FeedbackResult
    close_reason: str | None = None
    notes: str | None
    created_at: datetime


class TipOut(ORMModel):
    id: int
    instrument: InstrumentOut
    action: TipAction
    horizon: TipHorizon
    entry_low: float | None
    entry_high: float | None
    stop: float | None
    target_1: float | None
    target_2: float | None
    score: float
    confidence: float
    scenario_bull: str | None
    scenario_base: str | None
    scenario_bear: str | None
    rationale: dict[str, Any]
    risks: str | None
    narrative_cs: str | None
    entry_notes: str | None = None
    data_quality: DataQuality
    risk_profile: RiskProfile
    suggested_size_pct: float | None
    is_active: bool
    status: str = TipStatus.proposed.value
    as_of: datetime
    closed_at: datetime | None = None
    created_at: datetime
    feedback: TipFeedbackOut | None = None


class TipFeedbackCreate(BaseModel):
    result: FeedbackResult
    notes: str | None = None
    close_reason: CloseReason | None = None


class TipLifecycleUpdate(BaseModel):
    status: TipStatus
    result: FeedbackResult | None = None
    notes: str | None = None
    close_reason: CloseReason | None = None


class TipJournalUpdate(BaseModel):
    entry_notes: str | None = None
    exit_notes: str | None = None
    result: FeedbackResult | None = None
    close_reason: CloseReason | None = None


class TipHistoryOut(BaseModel):
    stats: dict[str, Any]
    tips: list[TipOut]


class UserSettingsOut(ORMModel):
    risk_profile: RiskProfile
    max_position_pct: float
    alert_email: bool
    alert_push: bool
    email: str | None
    preferences: dict[str, Any]
    push_configured: bool = False
    vapid_public_key: str | None = None


class UserSettingsUpdate(BaseModel):
    risk_profile: RiskProfile | None = None
    max_position_pct: float | None = Field(default=None, ge=0.1, le=100)
    alert_email: bool | None = None
    alert_push: bool | None = None
    email: str | None = None
    preferences: dict[str, Any] | None = None
    push_subscription: dict[str, Any] | None = None


class HomeOut(BaseModel):
    portfolio: list[PortfolioPositionOut]
    tips: list[TipOut]
    alerts_unread: int
    risk_profile: RiskProfile
    briefing_cs: str | None = None
    briefing_title: str | None = None
    briefing_at: datetime | None = None
    tip_stats: dict[str, Any] | None = None
    equity: list[dict[str, Any]] = []


class ChatRequest(BaseModel):
    message: str
    symbol: str | None = None
    session_id: int | None = None


class ChatMessageOut(ORMModel):
    id: int
    role: str
    content: str
    created_at: datetime
    session_id: int | None = None


class ChatSessionOut(ORMModel):
    id: int
    title: str
    symbol: str | None = None
    status: ChatSessionStatus
    preview: str | None = None
    message_count: int
    created_at: datetime
    updated_at: datetime


class ChatSessionCreate(BaseModel):
    title: str | None = None
    symbol: str | None = None


class ChatSessionUpdate(BaseModel):
    title: str | None = None
    symbol: str | None = None
    status: ChatSessionStatus | None = None


class ChatTurnOut(BaseModel):
    session: ChatSessionOut
    user_message: ChatMessageOut
    assistant_message: ChatMessageOut


class ReportOut(ORMModel):
    id: int
    kind: str
    title: str
    content_md: str
    meta: dict[str, Any]
    created_at: datetime


class AlertOut(ORMModel):
    id: int
    kind: str
    title: str
    body: str
    payload: dict[str, Any]
    is_read: bool
    created_at: datetime


class MacroPointOut(BaseModel):
    series_id: str
    name: str
    value: float
    ts: datetime
    source: str


class PriceAlertRuleCreate(BaseModel):
    symbol: str
    kind: str = "custom"  # avg_cost|stop|target|custom
    price: float
    direction: str = "cross"  # above|below|cross
    note: str | None = None


class PriceAlertRuleOut(ORMModel):
    id: int
    kind: str
    price: float
    direction: str
    note: str | None
    is_active: bool
    last_triggered_at: datetime | None
    created_at: datetime
    instrument: InstrumentOut


class EquityPointOut(BaseModel):
    as_of: date
    total_value: float
    total_cost: float
    pnl: float
    pnl_pct: float | None = None


class WatchlistDigestItem(BaseModel):
    item_id: int
    watchlist_id: int
    symbol: str
    name: str
    asset_class: AssetClass
    price: float | None = None
    change_pct: float | None = None
    tip: TipOut | None = None
    flags: list[str] = []


class WatchlistDigestOut(BaseModel):
    digest_cs: str
    movers: list[WatchlistDigestItem]
    as_of: datetime


class PaperPositionPreview(BaseModel):
    tip_id: int
    symbol: str
    quantity: float
    avg_cost: float
    size_pct: float
    notional: float
    portfolio_equity: float
    is_paper: bool = True
    notes: str


class PaperPositionOut(BaseModel):
    preview: PaperPositionPreview
    position: PortfolioPositionOut
