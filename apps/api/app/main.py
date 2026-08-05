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
from app.workers.jobs import check_price_alerts, generate_daily_report, run_scoring_for_user, sync_macro

logger = logging.getLogger(__name__)
settings = get_settings()
scheduler = AsyncIOScheduler()


async def _init_db() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with AsyncSessionLocal() as db:
        await ensure_discovery_universe(db)


async def _user_ids() -> list[str]:
    async with AsyncSessionLocal() as db:
        rows = (await db.execute(select(UserSettings.user_id))).scalars().all()
        return list(rows)


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


async def job_macro() -> None:
    async with AsyncSessionLocal() as db:
        try:
            await sync_macro(db)
        except Exception as exc:
            logger.warning("macro job failed: %s", exc)


@asynccontextmanager
async def lifespan(_: FastAPI):
    await _init_db()
    hours = [int(h.strip()) for h in settings.scoring_cron_hours.split(",") if h.strip()]
    scheduler.add_job(job_price_poll, "interval", minutes=settings.price_poll_minutes, id="price_poll")
    scheduler.add_job(job_scoring, "cron", hour=hours, minute=10, id="scoring")
    scheduler.add_job(job_daily_report, "cron", hour=6, minute=30, id="daily_report")
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
