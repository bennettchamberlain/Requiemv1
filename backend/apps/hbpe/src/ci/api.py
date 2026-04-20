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
from typing import Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import JSONResponse

from ci.pipeline.histogram_api import build_histogram

log = logging.getLogger(__name__)

# Global engine registry: user_id → InferenceEngine
_engines: dict = {}
_ingester = None
_temporal_client = None

# Fixed workflow ID prefixes for deduplication
_BOOTSTRAP_WF_PREFIX = "hbpe-bootstrap"
_NIGHTLY_WF_PREFIX   = "hbpe-nightly"


def _default_user_id() -> Optional[str]:
    """Return the first user_id found in the DB, or None."""
    try:
        from ci.data_client import get_first_user_id
        return get_first_user_id()
    except Exception:
        log.debug("Could not determine default user ID", exc_info=True)
        return None


def _get_or_create_engine(user_id: str):
    if user_id not in _engines:
        from ci.pipeline.inference_engine import InferenceEngine
        log.info("Creating InferenceEngine for user %s", user_id[:8])
        _engines[user_id] = InferenceEngine(user_id)
    return _engines[user_id]


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _ingester, _temporal_client

    # Init database connection pool early to fail fast
    from ci.database import init_db
    init_db()

    # Pre-load engine for the default user (single-user Phase 4 deployment)
    uid = _default_user_id()
    if uid:
        try:
            _get_or_create_engine(uid)
            log.info("Pre-loaded InferenceEngine for user %s", uid[:8])
        except Exception:
            log.exception("Could not pre-load default inference engine")

    # Connect shared Temporal client for workflow status queries
    try:
        from temporalio.client import Client
        from ci.config import settings
        _temporal_client = await Client.connect(
            settings.temporal_address, namespace=settings.temporal_namespace
        )
        log.info("Temporal client connected for status queries")
    except Exception:
        log.exception("Could not connect Temporal client; status queries will be unavailable")

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


async def _active_workflow_status(uid: str) -> Optional[str]:
    """
    Query the current step of any *running* HBPE workflow for uid.

    Returns a status string like 'BOOTSTRAP:train' or 'NIGHTLY:lora', or None
    if no workflow is actively running. Closed workflows are ignored even if
    their `current_step` variable was never set to "done" — otherwise a
    crash mid-step would leave the API reporting a stale status forever.
    """
    if not _temporal_client:
        return None

    import asyncio
    from temporalio.client import WorkflowExecutionStatus

    for wf_type, prefix in [
        ("BOOTSTRAP", _BOOTSTRAP_WF_PREFIX),
        ("NIGHTLY",   _NIGHTLY_WF_PREFIX),
    ]:
        wf_id = f"{prefix}-{uid[:8]}"
        try:
            handle = _temporal_client.get_workflow_handle(wf_id)
            desc = await asyncio.wait_for(handle.describe(), timeout=1.0)
            if desc.status != WorkflowExecutionStatus.RUNNING:
                continue
            step = await asyncio.wait_for(
                handle.query("current_step"), timeout=1.0,
            )
            if step and step != "done":
                return f"{wf_type}:{step}"
        except asyncio.TimeoutError:
            log.warning("Temporal status query timed out for %s; reporting none", wf_id)
        except Exception:
            pass  # workflow not found, completed, query not registered, etc.
    return None


@app.get("/health")
async def health() -> dict:
    return {
        "status":   "ok",
        "service":  "hbpe",
        "engines":  list(_engines.keys()),
    }


@app.get("/histogram")
async def histogram(
    horizon:  str           = Query("24h", description="Forecast window (only '24h' supported)"),
    user_id:  Optional[str] = Query(None,  description="User UUID (defaults to single-user mode)"),
) -> dict:
    """
    Return a 48-bucket 24-hour behavioral forecast.

    Response: { horizon, generated_at, buckets: [...48 items...] }
    Each bucket: { bucket_index, start_time, l0_probs, l1_probs, l2_probs, q10, q50, q90 }
    """
    uid = user_id or _default_user_id()
    if not uid:
        raise HTTPException(status_code=503, detail="No users found in database")

    try:
        engine = _get_or_create_engine(uid)
        wf_status = await _active_workflow_status(uid)
        result = build_histogram(engine, horizon=horizon, user_id=uid, system_status=wf_status)
        return JSONResponse(content=result)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception:
        log.exception("Histogram generation failed")
        raise HTTPException(status_code=500, detail="Internal error")


@app.post("/invalidate/{date_str}")
async def invalidate_cache(
    date_str: str,
    user_id:  Optional[str] = Query(None),
) -> dict:
    """
    Manually invalidate the inference cache for a specific date.
    Useful for admin tooling and integration tests.
    """
    try:
        d = date.fromisoformat(date_str)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid date: {date_str}")

    uid = user_id or _default_user_id()
    if uid and uid in _engines:
        _engines[uid].invalidate(d)
        return {"invalidated": str(d), "user_id": uid}
    return {"invalidated": str(d), "user_id": uid, "note": "no engine loaded"}


def _model_exists() -> bool:
    """Return True if an HMT checkpoint is present and predictions can be served."""
    from pathlib import Path
    from ci.config import settings
    ckpt_dir = Path(settings.models_dir) / "hmt"
    return any(
        (ckpt_dir / name).exists()
        for name in ("hmt_int8.onnx", "hmt_fp32.onnx", "hmt_calibrated.pt", "hmt_checkpoint.pt")
    )


@app.post("/trigger")
async def trigger_pipeline(user_id: Optional[str] = Query(None)) -> dict:
    """
    Manually trigger the HBPE pipeline for the user.

    Cold start (no checkpoint): runs BootstrapHBPEWorkflow — full pipeline from
    labeling through model training, calibration, and ONNX export.

    Warm start (checkpoint exists): runs NightlyHBPEWorkflow — incremental
    label/sweep/LoRA update.

    Starts the workflow directly (not via the nightly schedule) so that manual
    triggers work on a fresh Temporal database.
    """
    uid = user_id or _default_user_id()
    if not uid:
        raise HTTPException(status_code=503, detail="No users found in database")

    try:
        from temporalio.exceptions import WorkflowAlreadyStartedError
        from ci.config import settings

        client = _temporal_client
        if not client:
            raise RuntimeError("Temporal client not available")

        if _model_exists():
            from ci.pipeline.nightly_runner import NightlyHBPEWorkflow
            workflow_id = f"{_NIGHTLY_WF_PREFIX}-{uid[:8]}"
            try:
                handle = await client.start_workflow(
                    NightlyHBPEWorkflow.run,
                    uid,
                    id=workflow_id,
                    task_queue=settings.task_queue,
                )
                return {"status": "triggered", "workflow": "nightly", "workflow_id": handle.id}
            except WorkflowAlreadyStartedError:
                return {"status": "already_running", "workflow": "nightly", "workflow_id": workflow_id}
        else:
            from ci.pipeline.bootstrap import BootstrapHBPEWorkflow
            workflow_id = f"{_BOOTSTRAP_WF_PREFIX}-{uid[:8]}"
            try:
                handle = await client.start_workflow(
                    BootstrapHBPEWorkflow.run,
                    uid,
                    id=workflow_id,
                    task_queue=settings.task_queue,
                )
                return {"status": "triggered", "workflow": "bootstrap", "workflow_id": handle.id}
            except WorkflowAlreadyStartedError:
                return {"status": "already_running", "workflow": "bootstrap", "workflow_id": workflow_id}

    except Exception as e:
        log.exception("Failed to manually trigger HBPE pipeline")
        raise HTTPException(status_code=500, detail=str(e))

