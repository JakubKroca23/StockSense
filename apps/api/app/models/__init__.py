import enum
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class AssetClass(str, enum.Enum):
    stock = "stock"
    commodity = "commodity"
    crypto = "crypto"
    etf = "etf"
    index = "index"
    other = "other"


class TipAction(str, enum.Enum):
    long = "long"
    short = "short"
    hold = "hold"
    sell = "sell"


class TipHorizon(str, enum.Enum):
    intraday = "intraday"
    swing = "swing"
    position = "position"
    long_term = "long_term"


class RiskProfile(str, enum.Enum):
    conservative = "conservative"
    balanced = "balanced"
    aggressive = "aggressive"


class DataQuality(str, enum.Enum):
    high = "high"
    medium = "medium"
    low = "low"
    proxy = "proxy"
    unavailable = "unavailable"


class FeedbackResult(str, enum.Enum):
    hit = "hit"
    miss = "miss"
    partial = "partial"


class CloseReason(str, enum.Enum):
    """Why a tip was closed — distinguishes TP vs SL from other exits."""

    stop = "stop"
    target_1 = "target_1"
    target_2 = "target_2"
    ttl = "ttl"
    score_flip = "score_flip"
    manual = "manual"


class TipStatus(str, enum.Enum):
    proposed = "proposed"
    accepted = "accepted"
    rejected = "rejected"
    closed = "closed"


class Instrument(Base):
    __tablename__ = "instruments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    symbol: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(255), default="")
    asset_class: Mapped[AssetClass] = mapped_column(Enum(AssetClass), default=AssetClass.stock)
    exchange: Mapped[str | None] = mapped_column(String(64), nullable=True)
    currency: Mapped[str] = mapped_column(String(16), default="USD")
    is_discovery: Mapped[bool] = mapped_column(Boolean, default=False)
    meta: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    prices: Mapped[list["PriceBar"]] = relationship(back_populates="instrument")
    tips: Mapped[list["Tip"]] = relationship(back_populates="instrument")


class PriceBar(Base):
    __tablename__ = "price_bars"
    __table_args__ = (
        UniqueConstraint("instrument_id", "interval", "ts", name="uq_price_bar"),
        Index("ix_price_bars_lookup", "instrument_id", "interval", "ts"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    instrument_id: Mapped[int] = mapped_column(ForeignKey("instruments.id", ondelete="CASCADE"))
    interval: Mapped[str] = mapped_column(String(16), default="1d")
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    open: Mapped[float] = mapped_column(Float)
    high: Mapped[float] = mapped_column(Float)
    low: Mapped[float] = mapped_column(Float)
    close: Mapped[float] = mapped_column(Float)
    volume: Mapped[float] = mapped_column(Float, default=0.0)
    source: Mapped[str] = mapped_column(String(64), default="yfinance")
    data_quality: Mapped[DataQuality] = mapped_column(Enum(DataQuality), default=DataQuality.medium)
    as_of: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    instrument: Mapped[Instrument] = relationship(back_populates="prices")


class Watchlist(Base):
    __tablename__ = "watchlists"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[str] = mapped_column(String(64), index=True)
    name: Mapped[str] = mapped_column(String(128), default="Hlavní")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    items: Mapped[list["WatchlistItem"]] = relationship(
        back_populates="watchlist", cascade="all, delete-orphan"
    )


class WatchlistItem(Base):
    __tablename__ = "watchlist_items"
    __table_args__ = (UniqueConstraint("watchlist_id", "instrument_id", name="uq_watchlist_item"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    watchlist_id: Mapped[int] = mapped_column(ForeignKey("watchlists.id", ondelete="CASCADE"))
    instrument_id: Mapped[int] = mapped_column(ForeignKey("instruments.id", ondelete="CASCADE"))
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    watchlist: Mapped[Watchlist] = relationship(back_populates="items")
    instrument: Mapped[Instrument] = relationship()


class PortfolioPosition(Base):
    __tablename__ = "portfolio_positions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[str] = mapped_column(String(64), index=True)
    instrument_id: Mapped[int] = mapped_column(ForeignKey("instruments.id", ondelete="CASCADE"))
    quantity: Mapped[Decimal] = mapped_column(Numeric(20, 8))
    avg_cost: Mapped[Decimal] = mapped_column(Numeric(20, 8))
    opened_at: Mapped[date | None] = mapped_column(Date, nullable=True)
    is_paper: Mapped[bool] = mapped_column(Boolean, default=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    instrument: Mapped[Instrument] = relationship()


class Tip(Base):
    __tablename__ = "tips"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[str] = mapped_column(String(64), index=True)
    instrument_id: Mapped[int] = mapped_column(ForeignKey("instruments.id", ondelete="CASCADE"))
    action: Mapped[TipAction] = mapped_column(Enum(TipAction))
    horizon: Mapped[TipHorizon] = mapped_column(Enum(TipHorizon))
    entry_low: Mapped[float | None] = mapped_column(Float, nullable=True)
    entry_high: Mapped[float | None] = mapped_column(Float, nullable=True)
    stop: Mapped[float | None] = mapped_column(Float, nullable=True)
    target_1: Mapped[float | None] = mapped_column(Float, nullable=True)
    target_2: Mapped[float | None] = mapped_column(Float, nullable=True)
    score: Mapped[float] = mapped_column(Float, default=0.0)
    confidence: Mapped[float] = mapped_column(Float, default=0.0)
    scenario_bull: Mapped[str | None] = mapped_column(Text, nullable=True)
    scenario_base: Mapped[str | None] = mapped_column(Text, nullable=True)
    scenario_bear: Mapped[str | None] = mapped_column(Text, nullable=True)
    rationale: Mapped[dict] = mapped_column(JSONB, default=dict)
    risks: Mapped[str | None] = mapped_column(Text, nullable=True)
    narrative_cs: Mapped[str | None] = mapped_column(Text, nullable=True)
    entry_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    data_quality: Mapped[DataQuality] = mapped_column(Enum(DataQuality), default=DataQuality.medium)
    risk_profile: Mapped[RiskProfile] = mapped_column(Enum(RiskProfile), default=RiskProfile.balanced)
    suggested_size_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    status: Mapped[str] = mapped_column(String(32), default=TipStatus.proposed.value, index=True)
    as_of: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    instrument: Mapped[Instrument] = relationship(back_populates="tips")
    feedback: Mapped["TipFeedback | None"] = relationship(back_populates="tip", uselist=False)


class TipFeedback(Base):
    __tablename__ = "tip_feedback"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    tip_id: Mapped[int] = mapped_column(ForeignKey("tips.id", ondelete="CASCADE"), unique=True)
    user_id: Mapped[str] = mapped_column(String(64), index=True)
    result: Mapped[FeedbackResult] = mapped_column(Enum(FeedbackResult))
    close_reason: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    tip: Mapped[Tip] = relationship(back_populates="feedback")


class UserSettings(Base):
    __tablename__ = "user_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    risk_profile: Mapped[RiskProfile] = mapped_column(Enum(RiskProfile), default=RiskProfile.balanced)
    max_position_pct: Mapped[float] = mapped_column(Float, default=5.0)
    alert_email: Mapped[bool] = mapped_column(Boolean, default=True)
    alert_push: Mapped[bool] = mapped_column(Boolean, default=True)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    push_subscription: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    preferences: Mapped[dict] = mapped_column(JSONB, default=dict)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class Report(Base):
    __tablename__ = "reports"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[str] = mapped_column(String(64), index=True)
    kind: Mapped[str] = mapped_column(String(32), default="daily")  # daily | weekly
    title: Mapped[str] = mapped_column(String(255))
    content_md: Mapped[str] = mapped_column(Text)
    meta: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ChatSessionStatus(str, enum.Enum):
    open = "open"
    minimized = "minimized"
    saved = "saved"
    closed = "closed"


class ChatSession(Base):
    __tablename__ = "chat_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[str] = mapped_column(String(64), index=True)
    title: Mapped[str] = mapped_column(String(255), default="Nový chat")
    symbol: Mapped[str | None] = mapped_column(String(32), nullable=True)
    status: Mapped[ChatSessionStatus] = mapped_column(
        Enum(ChatSessionStatus, name="chatsessionstatus", create_constraint=False),
        default=ChatSessionStatus.open,
        index=True,
    )
    preview: Mapped[str | None] = mapped_column(String(280), nullable=True)
    message_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    messages: Mapped[list["ChatMessage"]] = relationship(
        "ChatMessage", back_populates="session", cascade="all, delete-orphan"
    )


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[str] = mapped_column(String(64), index=True)
    session_id: Mapped[int | None] = mapped_column(
        ForeignKey("chat_sessions.id", ondelete="CASCADE"), nullable=True, index=True
    )
    role: Mapped[str] = mapped_column(String(32))  # user | assistant | system
    content: Mapped[str] = mapped_column(Text)
    meta: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    session: Mapped[ChatSession | None] = relationship("ChatSession", back_populates="messages")


class Alert(Base):
    __tablename__ = "alerts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[str] = mapped_column(String(64), index=True)
    kind: Mapped[str] = mapped_column(String(64))
    title: Mapped[str] = mapped_column(String(255))
    body: Mapped[str] = mapped_column(Text)
    payload: Mapped[dict] = mapped_column(JSONB, default=dict)
    is_read: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class MacroSnapshot(Base):
    __tablename__ = "macro_snapshots"
    __table_args__ = (UniqueConstraint("series_id", "ts", name="uq_macro_series_ts"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    series_id: Mapped[str] = mapped_column(String(64), index=True)
    name: Mapped[str] = mapped_column(String(255), default="")
    value: Mapped[float] = mapped_column(Float)
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    source: Mapped[str] = mapped_column(String(64), default="FRED")
    as_of: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class PortfolioSnapshot(Base):
    """Daily equity mark for portfolio curve."""

    __tablename__ = "portfolio_snapshots"
    __table_args__ = (UniqueConstraint("user_id", "as_of", name="uq_portfolio_snap_user_day"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[str] = mapped_column(String(64), index=True)
    as_of: Mapped[date] = mapped_column(Date, index=True)
    total_value: Mapped[float] = mapped_column(Float, default=0.0)
    total_cost: Mapped[float] = mapped_column(Float, default=0.0)
    pnl: Mapped[float] = mapped_column(Float, default=0.0)
    pnl_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
    currency: Mapped[str] = mapped_column(String(16), default="USD")
    breakdown: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class PriceAlertRule(Base):
    """User price watch levels (avg cost / stop / target / custom)."""

    __tablename__ = "price_alert_rules"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[str] = mapped_column(String(64), index=True)
    instrument_id: Mapped[int] = mapped_column(ForeignKey("instruments.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(32), default="custom")  # avg_cost|stop|target|custom
    price: Mapped[float] = mapped_column(Float)
    direction: Mapped[str] = mapped_column(String(16), default="cross")  # above|below|cross
    note: Mapped[str | None] = mapped_column(String(255), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    last_triggered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    instrument: Mapped[Instrument] = relationship()


class LiqSnapshot(Base):
    """Compressed L2 + price sample for liquidity intelligence (24/7 ingest)."""

    __tablename__ = "liq_snapshots"
    __table_args__ = (Index("ix_liq_snapshots_sym_ts", "symbol", "ts"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    symbol: Mapped[str] = mapped_column(String(32), index=True)
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    mid: Mapped[float] = mapped_column(Float)
    best_bid: Mapped[float | None] = mapped_column(Float, nullable=True)
    best_ask: Mapped[float | None] = mapped_column(Float, nullable=True)
    spread_bps: Mapped[float | None] = mapped_column(Float, nullable=True)
    bid_vol_near: Mapped[float] = mapped_column(Float, default=0.0)
    ask_vol_near: Mapped[float] = mapped_column(Float, default=0.0)
    imbalance: Mapped[float] = mapped_column(Float, default=0.0)
    wall_bid_price: Mapped[float | None] = mapped_column(Float, nullable=True)
    wall_bid_size: Mapped[float] = mapped_column(Float, default=0.0)
    wall_ask_price: Mapped[float | None] = mapped_column(Float, nullable=True)
    wall_ask_size: Mapped[float] = mapped_column(Float, default=0.0)
    wall_bid_dist_bps: Mapped[float | None] = mapped_column(Float, nullable=True)
    wall_ask_dist_bps: Mapped[float | None] = mapped_column(Float, nullable=True)
    quote_change_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
    meta: Mapped[dict] = mapped_column(JSONB, default=dict)


class LiqFeatureBar(Base):
    """1-minute rolled features from liq_snapshots."""

    __tablename__ = "liq_feature_bars"
    __table_args__ = (
        UniqueConstraint("symbol", "ts", name="uq_liq_feature_sym_ts"),
        Index("ix_liq_features_sym_ts", "symbol", "ts"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    symbol: Mapped[str] = mapped_column(String(32), index=True)
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    mid_open: Mapped[float] = mapped_column(Float)
    mid_high: Mapped[float] = mapped_column(Float)
    mid_low: Mapped[float] = mapped_column(Float)
    mid_close: Mapped[float] = mapped_column(Float)
    mid_ret_pct: Mapped[float] = mapped_column(Float, default=0.0)
    spread_bps_avg: Mapped[float | None] = mapped_column(Float, nullable=True)
    imbalance_avg: Mapped[float] = mapped_column(Float, default=0.0)
    imbalance_max: Mapped[float] = mapped_column(Float, default=0.0)
    bid_vol_avg: Mapped[float] = mapped_column(Float, default=0.0)
    ask_vol_avg: Mapped[float] = mapped_column(Float, default=0.0)
    wall_bid_size_max: Mapped[float] = mapped_column(Float, default=0.0)
    wall_ask_size_max: Mapped[float] = mapped_column(Float, default=0.0)
    samples: Mapped[int] = mapped_column(Integer, default=0)
    meta: Mapped[dict] = mapped_column(JSONB, default=dict)


class TradingHypothesis(Base):
    """Evolving microstructure hypotheses — validated quantitatively over time."""

    __tablename__ = "trading_hypotheses"
    __table_args__ = (Index("ix_trading_hypotheses_status", "status", "symbol"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    slug: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    symbol: Mapped[str] = mapped_column(String(32), index=True, default="*")
    title: Mapped[str] = mapped_column(String(255))
    direction: Mapped[str] = mapped_column(String(16), default="long")  # long|short|neutral
    horizon_minutes: Mapped[int] = mapped_column(Integer, default=15)
    conditions: Mapped[dict] = mapped_column(JSONB, default=dict)
    expected_move_pct: Mapped[float] = mapped_column(Float, default=0.1)
    status: Mapped[str] = mapped_column(String(16), default="candidate")  # candidate|active|retired
    trials: Mapped[int] = mapped_column(Integer, default=0)
    wins: Mapped[int] = mapped_column(Integer, default=0)
    avg_move_pct: Mapped[float] = mapped_column(Float, default=0.0)
    last_eval_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_triggered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    origin: Mapped[str] = mapped_column(String(32), default="llm")
    meta: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class HypothesisTrial(Base):
    """Single paper evaluation of a hypothesis trigger."""

    __tablename__ = "hypothesis_trials"
    __table_args__ = (Index("ix_hyp_trials_hyp_ts", "hypothesis_id", "triggered_at"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    hypothesis_id: Mapped[int] = mapped_column(
        ForeignKey("trading_hypotheses.id", ondelete="CASCADE"), index=True
    )
    symbol: Mapped[str] = mapped_column(String(32), index=True)
    triggered_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    resolve_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    entry_mid: Mapped[float] = mapped_column(Float)
    exit_mid: Mapped[float | None] = mapped_column(Float, nullable=True)
    move_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
    won: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="open")  # open|resolved|expired
    meta: Mapped[dict] = mapped_column(JSONB, default=dict)


class LiqAnalysis(Base):
    """Periodic LLM review of liquidity + hypothesis memory."""

    __tablename__ = "liq_analyses"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    window_minutes: Mapped[int] = mapped_column(Integer, default=60)
    symbols: Mapped[list] = mapped_column(JSONB, default=list)
    summary: Mapped[str] = mapped_column(Text, default="")
    findings: Mapped[dict] = mapped_column(JSONB, default=dict)
    hypotheses_touched: Mapped[int] = mapped_column(Integer, default=0)
    model: Mapped[str] = mapped_column(String(64), default="gemini")
    meta: Mapped[dict] = mapped_column(JSONB, default=dict)
