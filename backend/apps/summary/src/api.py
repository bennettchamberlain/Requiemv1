"""
FastAPI endpoints for manual summary triggers.

Simple HTTP layer - delegates to summaries.py for execution logic.
"""
import uuid
import nest_asyncio
from datetime import datetime, timedelta
from typing import Any, Dict, Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from .data_aggregator import aggregator
from . import summaries
from . import workflow_control
from . import __version__

# Allow nested event loops (needed for run_sync() in async FastAPI context)
nest_asyncio.apply()

app = FastAPI(
    title="CI Summary API",
    version=__version__,
    description="Manual summary triggers and data aggregation.",
)


# ============================================================================
# Manual summary triggers
# ============================================================================

class ManualSummaryRequest(BaseModel):
    user_id: str = Field(description="User UUID")
    period_type: str = Field(default="hourly", description="hourly|daily|weekly|monthly|dossier")
    start_time: Optional[str] = Field(default=None, description="ISO start time")
    end_time: Optional[str] = Field(default=None, description="ISO end time")
    timezone: str = Field(default="UTC", description="Timezone")
    lookback_days: Optional[int] = Field(default=None, description="For dossier: lookback days")


@app.post("/summary/manual-trigger")
async def manual_trigger_summary(request: ManualSummaryRequest) -> Dict[str, Any]:
    """Manually trigger summary generation (bypasses queue)."""
    try:
        user_id = uuid.UUID(request.user_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid user_id: {exc}") from exc

    # Parse time range
    end_time = _parse_iso(request.end_time) if request.end_time else datetime.utcnow()
    if request.start_time:
        start_time = _parse_iso(request.start_time)
    else:
        # Default window
        delta = {
            "hourly": timedelta(hours=1),
            "daily": timedelta(days=1),
            "weekly": timedelta(weeks=1),
            "monthly": timedelta(days=30),
            "dossier": timedelta(days=1),
        }.get(request.period_type, timedelta(hours=1))
        start_time = end_time - delta

    # Execute
    try:
        if request.period_type == "hourly":
            result = summaries.execute_hourly_summary(user_id, start_time, end_time, request.timezone)
        elif request.period_type == "daily":
            result = summaries.execute_daily_summary(user_id, start_time, end_time, request.timezone)
        elif request.period_type == "weekly":
            result = summaries.execute_weekly_summary(user_id, start_time, end_time, request.timezone)
        elif request.period_type == "monthly":
            result = summaries.execute_monthly_summary(user_id, start_time, end_time, request.timezone)
        elif request.period_type == "dossier":
            result = summaries.execute_dossier_refresh(
                user_id, end_time, request.timezone, request.lookback_days
            )
        else:
            raise HTTPException(status_code=400, detail=f"Unknown period_type: {request.period_type}")

        return {
            "status": "success",
            "message": f"{request.period_type.title()} summary generated",
            "result": result,
            "time_range": {"start": start_time.isoformat(), "end": end_time.isoformat()},
        }

    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Generation failed: {str(exc)}") from exc


# ============================================================================
# Dossier endpoints
# ============================================================================

class DossierRefreshRequest(BaseModel):
    user_id: str = Field(description="User UUID")
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    timezone: str = Field(default="UTC")
    lookback_days: Optional[int] = None


class DossierFetchRequest(BaseModel):
    user_id: str


@app.post("/dossier/refresh")
async def refresh_dossier(request: DossierRefreshRequest) -> Dict[str, Any]:
    """Manually refresh user dossier."""
    try:
        user_id = uuid.UUID(request.user_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid user_id: {exc}") from exc

    end_time = _parse_iso(request.end_time) if request.end_time else datetime.utcnow()

    try:
        result = summaries.execute_dossier_refresh(
            user_id, end_time, request.timezone, request.lookback_days
        )
        return {
            "status": "success",
            "message": "Dossier refreshed",
            "result": result,
        }
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Refresh failed: {exc}") from exc


@app.post("/dossier/get")
async def get_dossier(request: DossierFetchRequest) -> Dict[str, Any]:
    """Fetch current user dossier."""
    try:
        user_id = uuid.UUID(request.user_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid user_id: {exc}") from exc

    from .database import db

    # Get entity
    rows = db.execute_query(
        "SELECT entity_id, dossier FROM entities WHERE owner_user_id = :user_id AND entity_type = 'Person' LIMIT 1",
        {"user_id": str(user_id)},
    )

    if not rows:
        raise HTTPException(status_code=404, detail="No entity found for user")

    entity_id = rows[0].get("entity_id")
    dossier = rows[0].get("dossier")

    if not dossier:
        raise HTTPException(status_code=404, detail="No dossier available")

    return {"entity_id": entity_id, "dossier": dossier}


# ============================================================================
# Insights endpoints
# ============================================================================

class InsightsRequest(BaseModel):
    user_id: str = Field(description="User UUID")
    timezone: str = Field(default="UTC", description="User's timezone")
    lookback_hours: Optional[int] = Field(default=72, description="Hours to look back for context (default 72)")


@app.post("/insights/generate")
async def generate_insights(request: InsightsRequest) -> Dict[str, Any]:
    """
    Manually trigger proactive insights generation.

    Generates actionable insights based on:
    - Recent graph deltas (new people, relationship changes)
    - Upcoming events (next 14 days)
    - Recent activity summaries
    - Strongest and recently-changed relationships
    - Recent communications

    Will skip if no new data since last insight generation.
    """
    try:
        user_id = uuid.UUID(request.user_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid user_id: {exc}") from exc

    try:
        result = summaries.execute_insights(
            user_id,
            request.timezone,
            request.lookback_hours,
        )

        if result.get("skipped"):
            return {
                "status": "skipped",
                "reason": result.get("reason"),
                "user_id": request.user_id,
                "message": f"Insights generation skipped: {result.get('reason')}",
            }

        return {
            "status": "success",
            "message": f"Generated {result.get('num_insights', 0)} insights",
            "summary_id": result.get("summary_id"),
            "num_insights": result.get("num_insights"),
            "insights": result.get("insights", []),
            "tokens_used": result.get("tokens_used", 0),
        }

    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Insights generation failed: {str(exc)}") from exc


@app.post("/insights/force-generate")
async def force_generate_insights(request: InsightsRequest) -> Dict[str, Any]:
    """
    Force insights generation even if no new data.

    Use this to regenerate insights regardless of whether there's new data.
    Sets lookback to specified hours (default 72) from now.
    """
    try:
        user_id = uuid.UUID(request.user_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid user_id: {exc}") from exc

    from datetime import datetime, timedelta
    from .insight_aggregator import insight_aggregator
    from .summarizer import summarizer as summary_gen
    from .database import db
    import json

    try:
        now = datetime.utcnow()
        since = now - timedelta(hours=request.lookback_hours)

        # Aggregate context (skip the new data check)
        context = insight_aggregator.aggregate_insights_context(user_id, since, now)

        total_context_items = (
            len(context.get("graph_deltas", []))
            + len(context.get("upcoming_events", []))
            + len(context.get("recent_summaries", []))
        )

        if total_context_items < 1:
            return {
                "status": "skipped",
                "reason": "no_context_available",
                "message": "No context data available for insights generation",
            }

        # Generate insights (LLM call)
        insights_data = summary_gen.generate_insights(context)

        num_insights = len(insights_data.get("insights", []))
        if num_insights == 0:
            return {
                "status": "skipped",
                "reason": "no_insights_generated",
                "message": "LLM did not generate any insights from available context",
            }

        # Store
        from uuid import uuid4
        # Prepare each insight for separate storage
        for insight in insights_list:
            summary_id = uuid4()
            
            # 1. Tags for this insight
            tags_list = insight.get("tags", [])

            # 2. Participants for this insight (valid UUIDs only)
            participants_list = []
            ids = insight.get("related_entity_ids", [])
            if ids:
                for entity_id in ids:
                    try:
                        uuid.UUID(str(entity_id))
                        participants_list.append(str(entity_id))
                    except (ValueError, TypeError):
                        pass

            # 3. Content: lightweight text summary and keys
            content = {
                "summary_text": insight.get("summary_text", ""),
                "key_actions": insight.get("key_actions", []),
                # Include tokens/metadata for this generation
                "tokens_used": insights_data.get("tokens_used", 0) // (len(insights_list) or 1),
                "data_sources_used": insights_data.get("data_sources_used", []) 
            }

            source_types = insights_data.get("data_sources_used", ["graph_deltas", "events", "summaries"])
            title = insight.get("title", "Proactive Insight")
            embedding = insights_data.get("embedding", []) # Shared embedding for now, or could compute per insight if needed
            metadata = {
                "seen": False, 
                "forced": True,
                "relevance_score": insight.get("relevance_score", 0),
            }

            db.execute_write(
                """
                INSERT INTO ci.summaries (
                    summary_id, user_id, period_start, period_end, period_type,
                    timezone, source_types, title, content, structured_context,
                    tags, participants, confidence_score, summary_embedding,
                    metadata, created_at, updated_at
                ) VALUES (
                    :summary_id, :user_id, :period_start, :period_end, 'insight',
                    :timezone, :source_types, :title, CAST(:content AS jsonb), CAST(:structured_context AS jsonb),
                    CAST(:tags AS jsonb), CAST(:participants AS uuid[]), :confidence_score,
                    CASE WHEN :embedding = '[]' THEN NULL ELSE CAST(:embedding AS vector) END,
                    CAST(:metadata AS jsonb), NOW(), NOW()
                )
                """,
                {
                    "summary_id": str(summary_id),
                    "user_id": str(user_id),
                    "period_start": since,
                    "period_end": now,
                    "timezone": request.timezone,
                    "source_types": source_types,
                    "title": title,
                    "content": json.dumps(content),
                    "structured_context": json.dumps(insight), # Store full object for safety
                    "tags": json.dumps(tags_list),
                    "participants": participants_list,
                    "confidence_score": insight.get("relevance_score", 0),
                    "embedding": json.dumps(embedding),
                    "metadata": json.dumps(metadata),
                },
            )

        return {
            "status": "success",
            "message": f"Force-generated {num_insights} insights",
            "summary_id": str(summary_id),
            "num_insights": num_insights,
            "insights": insights_list,
            "tokens_used": insights_data.get("tokens_used", 0),
            "context_items": total_context_items,
        }

    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Insights generation failed: {str(exc)}") from exc


# ============================================================================
# Aggregate preview (for debugging)
# ============================================================================

@app.get("/summary/aggregate")
async def get_aggregate_preview(request: ManualSummaryRequest) -> Dict[str, Any]:
    """Get aggregated data preview (no summary generation)."""
    try:
        user_id = uuid.UUID(request.user_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid user_id: {exc}") from exc

    end_time = _parse_iso(request.end_time) if request.end_time else datetime.utcnow()
    start_time = _parse_iso(request.start_time) if request.start_time else end_time - timedelta(hours=1)

    aggregated = aggregator.aggregate_hour(user_id, start_time, end_time)
    return {
        "user_id": str(user_id),
        "start_time": start_time.isoformat(),
        "end_time": end_time.isoformat(),
        "aggregated_data": aggregated,
    }


# ============================================================================
# Workflow Control (for LLM resource management)
# ============================================================================

class CancelWorkflowsRequest(BaseModel):
    workflow_types: Optional[list[str]] = Field(
        default=None,
        description="Workflow types to cancel (hourly, daily, weekly, monthly, dossier). If None, cancels all."
    )


class CancelUserWorkflowsRequest(BaseModel):
    user_id: str = Field(description="User ID whose workflows to cancel")
    workflow_types: Optional[list[str]] = Field(
        default=None,
        description="Workflow types to cancel. If None, cancels all user workflows."
    )


@app.post("/workflows/cancel-system")
async def cancel_system_workflows_endpoint(request: CancelWorkflowsRequest) -> Dict[str, Any]:
    """
    Cancel running system workflows to free up LLM resources for high-priority work.

    Use this when critical LLM operations need immediate access and background
    summarization can be paused.
    """
    try:
        results = await workflow_control.cancel_system_workflows(request.workflow_types)
        return {
            "status": "success",
            "message": "System workflow cancellation requested",
            "results": results,
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Cancellation failed: {str(exc)}") from exc


@app.post("/workflows/cancel-user")
async def cancel_user_workflows_endpoint(request: CancelUserWorkflowsRequest) -> Dict[str, Any]:
    """
    Cancel running workflows for a specific user.

    Use this to stop background processing for a particular user when needed.
    """
    try:
        user_id_uuid = uuid.UUID(request.user_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid user_id: {exc}") from exc

    try:
        results = await workflow_control.cancel_user_workflows(
            str(user_id_uuid),
            request.workflow_types
        )
        return {
            "status": "success",
            "message": f"User workflow cancellation requested for {request.user_id}",
            "results": results,
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Cancellation failed: {str(exc)}") from exc


@app.get("/workflows/status")
async def get_workflow_status() -> Dict[str, Any]:
    """
    Get information about currently running workflows.

    Useful for monitoring LLM resource usage and deciding when to cancel workflows.
    """
    try:
        workflow_counts = await workflow_control.get_running_workflows()
        return {
            "status": "success",
            "workflows": workflow_counts,
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Status fetch failed: {str(exc)}") from exc


# ============================================================================
# Helpers
# ============================================================================

def _parse_iso(iso_str: Optional[str]) -> datetime:
    """Parse ISO timestamp."""
    if not iso_str:
        return datetime.utcnow()
    if iso_str.endswith("Z"):
        iso_str = iso_str.replace("Z", "+00:00")
    return datetime.fromisoformat(iso_str)


__all__ = ["app"]
