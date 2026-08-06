"""Runtime + database storage stats for the settings panel."""

from __future__ import annotations

import os
import platform
import time
from datetime import datetime, timezone

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings

_STARTED_AT = time.time()


def _bytes_human(n: int | float | None) -> str:
    if n is None:
        return "—"
    n = float(n)
    units = ["B", "KB", "MB", "GB", "TB"]
    i = 0
    while n >= 1024 and i < len(units) - 1:
        n /= 1024
        i += 1
    if i == 0:
        return f"{int(n)} {units[i]}"
    return f"{n:.1f} {units[i]}"


def _process_memory() -> dict:
    rss = None
    vms = None
    try:
        with open("/proc/self/status", encoding="utf-8") as f:
            for line in f:
                if line.startswith("VmRSS:"):
                    rss = int(line.split()[1]) * 1024
                elif line.startswith("VmSize:"):
                    vms = int(line.split()[1]) * 1024
    except OSError:
        pass
    if rss is None:
        try:
            import resource

            # Linux: ru_maxrss in KiB
            rss = int(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss) * 1024
        except Exception:
            pass
    return {
        "rss_bytes": rss,
        "rss_human": _bytes_human(rss),
        "vms_bytes": vms,
        "vms_human": _bytes_human(vms),
        "pid": os.getpid(),
    }


async def _db_tables(db: AsyncSession) -> list[dict]:
    try:
        rows = (
            await db.execute(
                text(
                    """
                    SELECT
                      c.relname AS name,
                      COALESCE(s.n_live_tup, 0)::bigint AS row_estimate,
                      pg_total_relation_size(c.oid)::bigint AS total_bytes,
                      pg_relation_size(c.oid)::bigint AS table_bytes,
                      pg_indexes_size(c.oid)::bigint AS index_bytes
                    FROM pg_class c
                    JOIN pg_namespace n ON n.oid = c.relnamespace
                    LEFT JOIN pg_stat_user_tables s
                      ON s.relid = c.oid
                    WHERE n.nspname = 'public'
                      AND c.relkind = 'r'
                    ORDER BY pg_total_relation_size(c.oid) DESC
                    """
                )
            )
        ).mappings().all()
    except Exception:
        # Fallback: counts only (e.g. non-Postgres)
        return []

    out = []
    for r in rows:
        total = int(r["total_bytes"] or 0)
        out.append(
            {
                "name": r["name"],
                "rows": int(r["row_estimate"] or 0),
                "total_bytes": total,
                "table_bytes": int(r["table_bytes"] or 0),
                "index_bytes": int(r["index_bytes"] or 0),
                "total_human": _bytes_human(total),
            }
        )
    return out


async def _db_size(db: AsyncSession) -> dict:
    try:
        row = (
            await db.execute(
                text(
                    """
                    SELECT
                      current_database() AS name,
                      pg_database_size(current_database())::bigint AS size_bytes
                    """
                )
            )
        ).mappings().one()
        size = int(row["size_bytes"] or 0)
        return {
            "name": row["name"],
            "size_bytes": size,
            "size_human": _bytes_human(size),
        }
    except Exception:
        return {"name": None, "size_bytes": None, "size_human": "—"}


async def collect_system_stats(db: AsyncSession) -> dict:
    cfg = get_settings()
    tables = await _db_tables(db)
    database = await _db_size(db)
    mem = _process_memory()
    uptime = max(0.0, time.time() - _STARTED_AT)

    price_bars = next((t for t in tables if t["name"] == "price_bars"), None)
    chat_msgs = next((t for t in tables if t["name"] == "chat_messages"), None)
    instruments = next((t for t in tables if t["name"] == "instruments"), None)

    try:
        from app.services.crypto_market import get_crypto_market

        crypto = get_crypto_market().health()
    except Exception as exc:
        crypto = {"error": str(exc)[:160]}

    return {
        "as_of": datetime.now(timezone.utc).isoformat(),
        "service": "stocksense-api",
        "environment": cfg.environment,
        "uptime_seconds": round(uptime),
        "uptime_human": _uptime_human(uptime),
        "host": {
            "python": platform.python_version(),
            "system": platform.system(),
            "machine": platform.machine(),
        },
        "process": mem,
        "database": database,
        "tables": tables,
        "highlights": {
            "price_bars_rows": price_bars["rows"] if price_bars else 0,
            "price_bars_size": price_bars["total_human"] if price_bars else "—",
            "instruments": instruments["rows"] if instruments else 0,
            "chat_messages": chat_msgs["rows"] if chat_msgs else 0,
            "tables_total_bytes": sum(t["total_bytes"] for t in tables),
            "tables_total_human": _bytes_human(sum(t["total_bytes"] for t in tables)),
        },
        "crypto": crypto,
        "llm": {
            "provider": "gemini",
            "cloud_provider": "gemini",
            "ollama_model": None,
            "scheduler": cfg.enable_scheduler,
            "tip_scoring": cfg.enable_tip_scoring,
        },
    }


def _uptime_human(seconds: float) -> str:
    s = int(seconds)
    d, s = divmod(s, 86400)
    h, s = divmod(s, 3600)
    m, s = divmod(s, 60)
    parts = []
    if d:
        parts.append(f"{d}d")
    if h or d:
        parts.append(f"{h}h")
    parts.append(f"{m}m")
    return " ".join(parts)
