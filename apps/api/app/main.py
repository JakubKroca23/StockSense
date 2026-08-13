import logging
import asyncio
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
    snapshot_portfolio,
    sync_macro,
)
from app.services.oil_store import sync_all_oil, sync_oil_interval
from app.services.oil_footprint import run_oil_footprint

logger = logging.getLogger(__name__)
settings = get_settings()
scheduler = AsyncIOScheduler()


async def _drop_retired_bot_schema(conn) -> None:
    """Drop retired Sense bot / chat / tips / reports tables."""
    for table in (
        "hypothesis_trials",
        "trading_hypotheses",
        "liq_analyses",
        "liq_feature_bars",
        "liq_snapshots",
        "chat_messages",
        "chat_sessions",
        "tip_feedback",
        "tips",
        "reports",
    ):
        await conn.execute(text(f"DROP TABLE IF EXISTS {table} CASCADE"))
    await conn.execute(text("DROP TYPE IF EXISTS chatsessionstatus"))
    await conn.execute(text("DROP TYPE IF EXISTS tipaction"))
    await conn.execute(text("DROP TYPE IF EXISTS tiphorizon"))
    await conn.execute(text("DROP TYPE IF EXISTS feedbackresult"))


async def _init_db() -> None:
    async with engine.begin() as conn:
        await _drop_retired_bot_schema(conn)
        await conn.run_sync(Base.metadata.create_all)
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

    oil_stop = asyncio.Event()

    async def oil_loop() -> None:
        await asyncio.sleep(2)
        ticks = 0
        while not oil_stop.is_set():
            try:
                async with AsyncSessionLocal() as db:
                    if ticks == 0:
                        await sync_all_oil(db, include_slow=True)
                    elif ticks % 5 == 0:
                        await sync_all_oil(db, include_slow=True)
                    else:
                        await sync_oil_interval(db, "1m")
            except Exception as exc:
                logger.warning("oil cache sync failed: %s", exc)
            ticks += 1
            try:
                await asyncio.wait_for(oil_stop.wait(), timeout=60)
            except TimeoutError:
                pass

    oil_task = asyncio.create_task(oil_loop())
    fp_stop = asyncio.Event()
    fp_task = asyncio.create_task(run_oil_footprint(fp_stop))

    if settings.enable_scheduler:
        scheduler.add_job(
            job_price_poll, "interval", minutes=settings.price_poll_minutes, id="price_poll"
        )
        scheduler.add_job(job_equity_snapshot, "cron", hour=21, minute=5, id="equity_snapshot")
        scheduler.add_job(job_macro, "cron", hour="*/6", minute=5, id="macro")
        scheduler.start()
        logger.info("APScheduler started (jobs enabled)")
    else:
        logger.warning("APScheduler disabled — no cron/interval jobs")
    yield
    oil_stop.set()
    fp_stop.set()
    oil_task.cancel()
    fp_task.cancel()
    if scheduler.running:
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
