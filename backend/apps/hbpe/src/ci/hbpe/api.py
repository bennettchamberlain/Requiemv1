"""
FastAPI application for HBPE — Hierarchical Behavioral Prediction Engine.

Lifecycle:
  • On startup: load InferenceEngine per user, start EventIngester background task.
  • On shutdown: stop ingester.

Endpoints:
  GET /health               — liveness probe
  GET /histogram            — 48-bucket 24h behavioral forecast
  GET /forecast             — week-horizon per-day occurrence forecast
  GET /forecast/due         — renewal ("due"/overdue) predictions for periodic clusters
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

from ci.hbpe.pipeline.histogram_api import build_histogram
from ci.telemetry import init_telemetry

log = logging.getLogger(__name__)

# No-op unless SENTRY_DSN is set — see the ci-telemetry package.
init_telemetry("ci-server-hbpe")

# Global engine registry: user_id → InferenceEngine
_engines: dict = {}
_ingester = None
_temporal_client = None

# Fixed workflow ID prefixes for deduplication
_BOOTSTRAP_WF_PREFIX = "hbpe-bootstrap"
_NIGHTLY_WF_PREFIX = "hbpe-nightly"


def _get_or_create_engine(user_id: str):
    if user_id not in _engines:
        from ci.hbpe.pipeline.inference_engine import InferenceEngine

        log.info("Creating InferenceEngine for user %s", user_id[:8])
        _engines[user_id] = InferenceEngine(user_id)
    return _engines[user_id]


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _ingester, _temporal_client

    # Init database connection pool early to fail fast
    from ci.hbpe.database import init_db

    init_db()

    # Connect Temporal client so /trigger can start workflows. Non-fatal if
    # Temporal is unavailable — /trigger will surface a clear 503 instead.
    try:
        from temporalio.client import Client

        from ci.hbpe.config import settings

        _temporal_client = await Client.connect(
            settings.temporal_address, namespace=settings.temporal_namespace
        )
        log.info("Temporal client connected")
    except Exception:
        log.exception("Could not connect Temporal client; /trigger will return 503")

    # Start event ingester
    from ci.hbpe.pipeline.ingester import EventIngester

    _ingester = EventIngester(_engines)
    await _ingester.start()

    yield

    # Shutdown
    if _ingester:
        await _ingester.stop()


app = FastAPI(
    title="HBPE — Hierarchical Behavioral Prediction Engine",
    version="0.2.0",
    lifespan=lifespan,
)


async def _active_workflow_status(uid: str) -> str | None:
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
        ("NIGHTLY", _NIGHTLY_WF_PREFIX),
    ]:
        wf_id = f"{prefix}-{uid[:8]}"
        try:
            handle = _temporal_client.get_workflow_handle(wf_id)
            desc = await asyncio.wait_for(handle.describe(), timeout=1.0)
            if desc.status != WorkflowExecutionStatus.RUNNING:
                continue
            step = await asyncio.wait_for(
                handle.query("current_step"),
                timeout=1.0,
            )
            if step and step != "done":
                return f"{wf_type}:{step}"
        except TimeoutError:
            log.warning("Temporal status query timed out for %s; reporting none", wf_id)
        except Exception:
            pass  # workflow not found, completed, query not registered, etc.
    return None


async def _resolve_system_status(user_id: str) -> str:
    """
    Status string for the forecast response.

    READY once a checkpoint exists; otherwise the live workflow step
    (e.g. ``BOOTSTRAP:train``) so the UI shows real progress instead of a
    permanent "Waiting to initialize…", falling back to COLD_START when no
    workflow is currently running.
    """
    if _model_exists(user_id):
        return "READY"
    status = await _active_workflow_status(user_id)
    return status or "COLD_START"


@app.get("/health")
async def health() -> dict:
    return {
        "status": "ok",
        "service": "hbpe",
        "engines": list(_engines.keys()),
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
        system_status = await _resolve_system_status(user_id)
        result = build_histogram(
            engine, horizon=horizon, user_id=user_id, system_status=system_status
        )
        return JSONResponse(content=result)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        log.exception("Histogram generation failed")
        raise HTTPException(status_code=500, detail="Internal error") from exc


@app.get("/forecast")
async def forecast(
    user_id: str | None = Query(None, description="User UUID"),
    horizon: str = Query("7d", description="Forecast window (only '7d' supported)"),
    include_today: bool = Query(
        False,
        description="Start the window at today (in the user's timezone) instead of "
        "tomorrow. For calendar surfaces that must render a row for today.",
    ),
    timezone: str | None = Query(
        None,
        description="IANA timezone for calendar-day boundaries (e.g. America/Los_Angeles). "
        "Defaults to UTC when omitted.",
    ),
) -> dict:
    """
    Week-horizon occurrence forecast: for each of the next 7 days, the L1
    clusters likely to occur that day with P(occurs) and daypart tendencies.

    Unlike /histogram (bucket occupancy), this predicts *events*: Bernoulli
    per (day × cluster), driven by the nightly recurrence profiles.

    The window starts tomorrow by default — today is partly elapsed, so its
    occurrence probability is a statement about a day already half-spent.
    `include_today` shifts the window back one day for the schedule grid, whose
    first row is today and would otherwise render empty.
    """
    if not user_id:
        raise HTTPException(status_code=401, detail="user_id is required")
    if horizon != "7d":
        raise HTTPException(
            status_code=400, detail=f"Unsupported horizon '{horizon}'. Supported: 7d"
        )

    import datetime
    from zoneinfo import ZoneInfo

    from ci.hbpe.pipeline.recurrence import log_occurrence_forecast, week_forecast

    try:
        try:
            tz = ZoneInfo(timezone) if timezone else datetime.UTC
        except Exception as exc:
            raise HTTPException(
                status_code=400, detail=f"Invalid timezone: {timezone}"
            ) from exc
        now = datetime.datetime.now(tz)
        today = now.date()
        start = today if include_today else today + datetime.timedelta(days=1)
        days = week_forecast(user_id, days=7, start=start)

        # Only log days that are still wholly in the future. Scoring a partly
        # elapsed day against an occurrence prediction issued mid-day would bias
        # the reliability curve (CI-Server-h0m), so today never enters the log.
        loggable = [d for d in days if d["date"] > today.isoformat()]
        log_occurrence_forecast(
            user_id, loggable, predicted_at=now.astimezone(datetime.UTC)
        )

        return {
            "horizon": horizon,
            "generated_at": now.isoformat() + "Z",
            "days": days,
        }
    except Exception as exc:
        log.exception("Week forecast failed")
        raise HTTPException(status_code=500, detail="Internal error") from exc


@app.get("/forecast/due")
async def forecast_due(
    user_id: str | None = Query(None, description="User UUID"),
) -> dict:
    """
    Renewal predictions for periodic clusters: what's coming due, in how many
    days, and what's overdue (past its p90 inter-arrival gap) — the
    month-horizon "haircut due in 6±4 days / it's been 16 days since you saw
    friends" view.
    """
    if not user_id:
        raise HTTPException(status_code=401, detail="user_id is required")

    import datetime

    from ci.hbpe.pipeline.recurrence import due_list

    try:
        return {
            "generated_at": datetime.datetime.utcnow().isoformat() + "Z",
            "due": due_list(user_id),
        }
    except Exception as exc:
        log.exception("Due list failed")
        raise HTTPException(status_code=500, detail="Internal error") from exc


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
    except ValueError as exc:
        raise HTTPException(
            status_code=400, detail=f"Invalid date: {date_str}"
        ) from exc

    if user_id in _engines:
        _engines[user_id].invalidate(d)
        return {"invalidated": str(d), "user_id": user_id}
    return {"invalidated": str(d), "user_id": user_id, "note": "no engine loaded"}


def _model_exists(user_id: str) -> bool:
    """Return True if this user has an HMT checkpoint and predictions can be served."""
    from ci.hbpe.model.checkpoints import model_exists

    return model_exists(user_id)


@app.post("/trigger")
async def trigger_pipeline(
    user_id: str | None = Query(None, description="User UUID"),
) -> dict:
    """
    Manually trigger the HBPE pipeline for the user.

    Cold start (no checkpoint): runs BootstrapHBPEWorkflow — full pipeline from
    labeling through model training, calibration, and ONNX export.

    Warm start (checkpoint exists): runs NightlyHBPEWorkflow — incremental
    label/sweep/LoRA update.

    Starts the workflow directly (not via the nightly schedule) so that manual
    triggers work on a fresh Temporal database.
    """
    if not user_id:
        raise HTTPException(status_code=401, detail="user_id is required")

    client = _temporal_client
    if not client:
        raise HTTPException(status_code=503, detail="Temporal client not available")

    try:
        from temporalio.exceptions import WorkflowAlreadyStartedError

        from ci.hbpe.config import settings

        if _model_exists(user_id):
            from ci.hbpe.pipeline.nightly_runner import NightlyHBPEWorkflow

            workflow_id = f"{_NIGHTLY_WF_PREFIX}-{user_id[:8]}"
            try:
                handle = await client.start_workflow(
                    NightlyHBPEWorkflow.run,
                    user_id,
                    id=workflow_id,
                    task_queue=settings.task_queue,
                )
                return {
                    "status": "triggered",
                    "workflow": "nightly",
                    "workflow_id": handle.id,
                }
            except WorkflowAlreadyStartedError:
                return {
                    "status": "already_running",
                    "workflow": "nightly",
                    "workflow_id": workflow_id,
                }
        else:
            from ci.hbpe.pipeline.bootstrap import BootstrapHBPEWorkflow

            workflow_id = f"{_BOOTSTRAP_WF_PREFIX}-{user_id[:8]}"
            try:
                handle = await client.start_workflow(
                    BootstrapHBPEWorkflow.run,
                    user_id,
                    id=workflow_id,
                    task_queue=settings.task_queue,
                )
                return {
                    "status": "triggered",
                    "workflow": "bootstrap",
                    "workflow_id": handle.id,
                }
            except WorkflowAlreadyStartedError:
                return {
                    "status": "already_running",
                    "workflow": "bootstrap",
                    "workflow_id": workflow_id,
                }

    except HTTPException:
        raise
    except Exception as e:
        log.exception("Failed to manually trigger HBPE pipeline")
        raise HTTPException(status_code=500, detail=str(e)) from e
