from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "StockSense"
    environment: str = "development"
    api_prefix: str = "/api"

    database_url: str = "postgresql+asyncpg://stocksense:stocksense@db:5432/stocksense"
    database_url_sync: str = "postgresql://stocksense:stocksense@db:5432/stocksense"

    # Open access — shared single user identity (no password login)
    auth_user_id: str = "admin"
    auth_display_name: str = "Jakub"
    auth_email: str = ""

    cors_origins: str = "https://stocksense.propoj.app,http://localhost:3000"

    ollama_base_url: str = "http://ollama:11434"
    ollama_model: str = "qwen2.5:1.5b"
    cloud_llm_provider: str = "gemini"  # gemini only
    anthropic_api_key: str = ""
    openai_api_key: str = ""
    gemini_api_key: str = ""

    fred_api_key: str = ""
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    alert_email_to: str = ""

    # Web Push (VAPID). Empty = push disabled.
    vapid_public_key: str = ""
    vapid_private_key: str = ""
    vapid_subject: str = "mailto:stocksense@propoj.app"

    default_risk_profile: str = "balanced"
    price_poll_minutes: int = 5
    scoring_cron_hours: str = "7,12,17,21"

    # Background jobs + tip scoring off while tips pipeline is being rebuilt.
    enable_scheduler: bool = False
    enable_tip_scoring: bool = False

    # CryptoSense / CCXT — public market data (no API keys required for quotes)
    # Charts/quotes: aggregate across ccxt_exchanges. Bot/execution: ccxt_execution.
    ccxt_exchanges: str = "binance,bybit"
    ccxt_execution: str = "bybit"
    # Legacy alias — same as execution venue for bots / primary quote fallback.
    ccxt_primary: str = "bybit"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
