"""
FastAPI application for HBPE — Hierarchical Behavioral Prediction Engine.

Lifecycle:
  • On startup: load InferenceEngine per user, start EventIngester background task.
  • On shutdown: stop ingester.

Endpoints:
  GET /health               — liveness probe
  GET /histogram            — 48-bucket 24h behavioral forecast
  POST /invalidate/{date}   — manual cache invalidation (for testing / admin)

The engine registry maps user_id → InferenceEngine.  In a single-user
deployment (Phase 4 target), the registry has one entry loaded from the DB.
In multi-user mode, engines are created on first request and cached.

Implements T4.4 (CI-Server-k64) and integrates T4.3 ingester.
"""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from datetime import date

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import JSONResponse

from ci.pipeline.histogram_api import build_histogram

log = logging.getLogger(__name__)

# Global engine registry: user_id → InferenceEngine
_engines: dict = {}
_ingester = None


def _get_or_create_engine(user_id: str):
    if user_id not in _engines:
        from ci.pipeline.inference_engine import InferenceEngine
        log.info("Creating InferenceEngine for user %s", user_id[:8])
        _engines[user_id] = InferenceEngine(user_id)
    return _engines[user_id]


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _ingester

    # Init database connection pool early to fail fast
    from ci.database import init_db
    init_db()

    # Start event ingester
    from ci.pipeline.ingester import EventIngester
    _ingester = EventIngester(_engines)
    await _ingester.start()

    yield

    # Shutdown
    if _ingester:
        await _ingester.stop()


app = FastAPI(
    title       = "HBPE — Hierarchical Behavioral Prediction Engine",
    version     = "0.2.0",
    lifespan    = lifespan,
)


@app.get("/health")
async def health() -> dict:
    return {
        "status":   "ok",
        "service":  "hbpe",
        "engines":  list(_engines.keys()),
    }


@app.get("/histogram")
async def histogram(
    user_id: str | None = Query(None, description="User UUID"),
    horizon: str = Query("24h", description="Forecast window (only '24h' supported)"),
) -> dict:
    """
    Return a 48-bucket 24-hour behavioral forecast.

    Response: { horizon, generated_at, buckets: [...48 items...] }
    Each bucket: { bucket_index, start_time, l0_probs, l1_probs, l2_probs, q10, q50, q90 }
    """
    if not user_id:
        raise HTTPException(status_code=401, detail="user_id is required")

    try:
        engine = _get_or_create_engine(user_id)
        result = build_histogram(engine, horizon=horizon, user_id=user_id)
        return JSONResponse(content=result)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception:
        log.exception("Histogram generation failed")
        raise HTTPException(status_code=500, detail="Internal error")


@app.post("/invalidate/{date_str}")
async def invalidate_cache(
    date_str: str,
    user_id: str | None = Query(None, description="User UUID"),
) -> dict:
    """
    Manually invalidate the inference cache for a specific date.
    Useful for admin tooling and integration tests.
    """
    if not user_id:
        raise HTTPException(status_code=401, detail="user_id is required")

    try:
        d = date.fromisoformat(date_str)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid date: {date_str}")

    if user_id in _engines:
        _engines[user_id].invalidate(d)
        return {"invalidated": str(d), "user_id": user_id}
    return {"invalidated": str(d), "user_id": user_id, "note": "no engine loaded"}
