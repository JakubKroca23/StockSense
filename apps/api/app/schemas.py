from datetime import date, datetime
from decimal import Decimal
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.models import (
    AssetClass,
    DataQuality,
    FeedbackResult,
    RiskProfile,
    TipAction,
    TipHorizon,
)


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


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
    data_quality: DataQuality
    risk_profile: RiskProfile
    suggested_size_pct: float | None
    is_active: bool
    as_of: datetime
    created_at: datetime


class TipFeedbackCreate(BaseModel):
    result: FeedbackResult
    notes: str | None = None


class TipFeedbackOut(ORMModel):
    id: int
    tip_id: int
    result: FeedbackResult
    notes: str | None
    created_at: datetime


class UserSettingsOut(ORMModel):
    risk_profile: RiskProfile
    max_position_pct: float
    alert_email: bool
    alert_push: bool
    email: str | None
    preferences: dict[str, Any]


class UserSettingsUpdate(BaseModel):
    risk_profile: RiskProfile | None = None
    max_position_pct: float | None = Field(default=None, ge=0.1, le=100)
    alert_email: bool | None = None
    alert_push: bool | None = None
    email: str | None = None
    preferences: dict[str, Any] | None = None
    push_subscription: dict[str, Any] | None = None


class ChatRequest(BaseModel):
    message: str
    symbol: str | None = None


class ChatMessageOut(ORMModel):
    id: int
    role: str
    content: str
    created_at: datetime


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


class HomeOut(BaseModel):
    portfolio: list[PortfolioPositionOut]
    tips: list[TipOut]
    alerts_unread: int
    risk_profile: RiskProfile


class MacroPointOut(BaseModel):
    series_id: str
    name: str
    value: float
    ts: datetime
    source: str
