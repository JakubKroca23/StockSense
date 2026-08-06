import logging
from contextlib import asynccontextmanager

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select, text

from app.api.routes import router
from app.core.config import get_settings
from app.core.database import AsyncSessionLocal, Base, engine
from app.models import UserSettings
from app.services.instruments import ensure_discovery_universe
from app.workers.jobs import (
    check_price_alerts,
    generate_daily_report,
    run_scoring_for_user,
    snapshot_portfolio,
    sync_macro,
)

logger = logging.getLogger(__name__)
settings = get_settings()
scheduler = AsyncIOScheduler()


async def _ensure_chat_schema(conn) -> None:
    """create_all does not ALTER existing tables — patch chat sessions safely."""
    await conn.execute(
        text(
            """
            DO $$ BEGIN
                CREATE TYPE chatsessionstatus AS ENUM ('open', 'minimized', 'saved', 'closed');
            EXCEPTION
                WHEN duplicate_object THEN NULL;
            END $$;
            """
        )
    )
    await conn.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS chat_sessions (
                id SERIAL PRIMARY KEY,
                user_id VARCHAR(64) NOT NULL,
                title VARCHAR(255) NOT NULL DEFAULT 'Nový chat',
                symbol VARCHAR(32),
                status chatsessionstatus NOT NULL DEFAULT 'open',
                preview VARCHAR(280),
                message_count INTEGER NOT NULL DEFAULT 0,
                created_at TIMESTAMPTZ DEFAULT now(),
                updated_at TIMESTAMPTZ DEFAULT now()
            );
            """
        )
    )
    await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_chat_sessions_user_id ON chat_sessions (user_id);"))
    await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_chat_sessions_status ON chat_sessions (status);"))
    await conn.execute(
        text(
            """
            ALTER TABLE chat_messages
            ADD COLUMN IF NOT EXISTS session_id INTEGER
            REFERENCES chat_sessions(id) ON DELETE CASCADE;
            """
        )
    )
    await conn.execute(
        text("CREATE INDEX IF NOT EXISTS ix_chat_messages_session_id ON chat_messages (session_id);")
    )
    await conn.execute(
        text("ALTER TABLE tips ADD COLUMN IF NOT EXISTS status VARCHAR(32) DEFAULT 'proposed'")
    )
    await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_tips_status ON tips (status)"))
    await conn.execute(
        text("UPDATE tips SET status = 'proposed' WHERE status IS NULL OR status = ''")
    )
    await conn.execute(
        text("ALTER TABLE tips ADD COLUMN IF NOT EXISTS entry_notes TEXT")
    )
    await conn.execute(
        text("ALTER TABLE tips ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ")
    )
    await conn.execute(
        text(
            "ALTER TABLE tip_feedback ADD COLUMN IF NOT EXISTS close_reason VARCHAR(32)"
        )
    )
    await conn.execute(
        text(
            "CREATE INDEX IF NOT EXISTS ix_tip_feedback_close_reason "
            "ON tip_feedback (close_reason)"
        )
    )
    # Backfill structured close reasons from legacy free-text notes
    await conn.execute(
        text(
            """
            UPDATE tip_feedback SET close_reason = 'stop'
            WHERE close_reason IS NULL
              AND notes ILIKE '%zásahu stop%';
            """
        )
    )
    await conn.execute(
        text(
            """
            UPDATE tip_feedback SET close_reason = 'target_2'
            WHERE close_reason IS NULL
              AND notes ILIKE '%zásahu target_2%';
            """
        )
    )
    await conn.execute(
        text(
            """
            UPDATE tip_feedback SET close_reason = 'target_1'
            WHERE close_reason IS NULL
              AND (
                notes ILIKE '%zásahu target_1%'
                OR notes ILIKE '%zásahu target%'
              );
            """
        )
    )
    await conn.execute(
        text(
            """
            UPDATE tip_feedback SET close_reason = 'ttl'
            WHERE close_reason IS NULL
              AND notes ILIKE '%Expirace horizontu%';
            """
        )
    )
    await conn.execute(
        text(
            """
            UPDATE tip_feedback SET close_reason = 'score_flip'
            WHERE close_reason IS NULL
              AND notes ILIKE '%změna scoringu%';
            """
        )
    )
    await conn.execute(
        text(
            """
            UPDATE tip_feedback SET close_reason = 'manual'
            WHERE close_reason IS NULL;
            """
        )
    )
    await conn.execute(
        text(
            """
            UPDATE tips t
            SET closed_at = fb.created_at
            FROM tip_feedback fb
            WHERE fb.tip_id = t.id
              AND t.closed_at IS NULL
              AND t.status = 'closed';
            """
        )
    )


async def _init_db() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await _ensure_chat_schema(conn)
    async with AsyncSessionLocal() as db:
        await ensure_discovery_universe(db)


async def _user_ids() -> list[str]:
    """Users with settings + always the primary AUTH_USER_ID (cron must not skip you)."""
    async with AsyncSessionLocal() as db:
        rows = (await db.execute(select(UserSettings.user_id))).scalars().all()
    ids = list(dict.fromkeys(str(u) for u in rows if u))
    primary = settings.auth_user_id
    if primary and primary not in ids:
        ids.append(primary)
    return ids


async def job_price_poll() -> None:
    user_ids = await _user_ids()
    async with AsyncSessionLocal() as db:
        for uid in user_ids:
            try:
                await check_price_alerts(db, uid)
            except Exception as exc:
                logger.warning("price alert job failed for %s: %s", uid, exc)


async def job_scoring() -> None:
    user_ids = await _user_ids()
    async with AsyncSessionLocal() as db:
        for uid in user_ids:
            try:
                await run_scoring_for_user(db, uid)
            except Exception as exc:
                logger.warning("scoring job failed for %s: %s", uid, exc)


async def job_daily_report() -> None:
    user_ids = await _user_ids()
    async with AsyncSessionLocal() as db:
        for uid in user_ids:
            try:
                await generate_daily_report(db, uid)
            except Exception as exc:
                logger.warning("daily report job failed for %s: %s", uid, exc)
            try:
                await snapshot_portfolio(db, uid)
            except Exception as exc:
                logger.warning("equity snapshot failed for %s: %s", uid, exc)


async def job_equity_snapshot() -> None:
    user_ids = await _user_ids()
    async with AsyncSessionLocal() as db:
        for uid in user_ids:
            try:
                await snapshot_portfolio(db, uid)
            except Exception as exc:
                logger.warning("equity snapshot failed for %s: %s", uid, exc)


async def job_macro() -> None:
    async with AsyncSessionLocal() as db:
        try:
            await sync_macro(db)
        except Exception as exc:
            logger.warning("macro job failed: %s", exc)


@asynccontextmanager
async def lifespan(_: FastAPI):
    await _init_db()
    # APScheduler cron expects a string like "7,12,17,21", not a Python list
    scoring_hours = ",".join(
        str(int(h.strip())) for h in settings.scoring_cron_hours.split(",") if h.strip()
    ) or "7,12,17,21"
    scheduler.add_job(job_price_poll, "interval", minutes=settings.price_poll_minutes, id="price_poll")
    scheduler.add_job(job_scoring, "cron", hour=scoring_hours, minute=10, id="scoring")
    scheduler.add_job(job_daily_report, "cron", hour=6, minute=30, id="daily_report")
    scheduler.add_job(job_equity_snapshot, "cron", hour=21, minute=5, id="equity_snapshot")
    scheduler.add_job(job_macro, "cron", hour="*/6", minute=5, id="macro")
    scheduler.start()
    yield
    scheduler.shutdown(wait=False)
    await engine.dispose()


app = FastAPI(title=settings.app_name, lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(router, prefix=settings.api_prefix)


@app.get("/")
async def root():
    return {"app": settings.app_name, "docs": "/docs"}


@app.get("/ready")
async def ready():
    async with engine.connect() as conn:
        await conn.execute(text("SELECT 1"))
    return {"ready": True}
