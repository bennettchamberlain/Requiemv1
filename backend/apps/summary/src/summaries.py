"""
Core summary execution logic - single source of truth.

Both the worker and API delegate to these functions.
"""
import json
import structlog
from typing import Dict, Any
from datetime import datetime, timedelta
from uuid import UUID

from .config import settings
from .data_aggregator import aggregator
from .database import db
from .summarizer import summarizer

logger = structlog.get_logger()


def execute_hourly_summary(
    user_id: UUID,
    start_time: datetime,
    end_time: datetime,
    timezone: str = "UTC",
) -> Dict[str, Any]:
    """Execute hourly summary generation."""
    try:
        # Add overlap for context
        overlap = timedelta(minutes=settings.summary_overlap_minutes)
        adjusted_start = start_time - overlap
        adjusted_end = end_time + overlap

        # Aggregate data
        aggregated_data = aggregator.aggregate_hour(user_id, adjusted_start, adjusted_end)
        logger.info("data_aggregated",
                    user_id=str(user_id),
                    measurements=len(aggregated_data.get("measurements", [])),
                    events=len(aggregated_data.get("events", [])),
                    communications=len(aggregated_data.get("communications", [])),
                    browser_activity=len(aggregated_data.get("browser_activity", [])))

        # Generate summary (LLM call happens here)
        summary_data = summarizer.generate_hourly_summary(aggregated_data)
        logger.info("summary_generated", has_activity=summary_data.get("activity_counts", {}).get("total", 0) > 0)

        # Store summary
        summary_id = _store_summary(user_id, summary_data, start_time, end_time, timezone)

        return {
            "summary_id": str(summary_id),
            "summary_type": "hourly",
            "summary_text": summary_data.get("summary_text", ""),
            "key_insights": summary_data.get("key_insights", []),
            "activity_counts": summary_data.get("activity_counts", {}),
        }

    except Exception as exc:
        raise


def execute_daily_summary(
    user_id: UUID,
    start_time: datetime,
    end_time: datetime,
    timezone: str = "UTC",
) -> Dict[str, Any]:
    """Execute daily summary from hourly summaries."""
    try:
        # Get hourly summaries
        hourly_summaries = _get_summaries(user_id, start_time, end_time, "hourly")
        if not hourly_summaries:
            raise ValueError("No hourly summaries found for daily aggregation")

        # Generate daily summary from hourlies (LLM call)
        summary_data = summarizer.generate_daily_summary(hourly_summaries)

        # Store
        summary_id = _store_summary(user_id, summary_data, start_time, end_time, timezone)

        return {
            "summary_id": str(summary_id),
            "summary_type": "daily",
            "summary_text": summary_data.get("summary_text", ""),
            "activity_counts": summary_data.get("activity_counts", {}),
            "num_hourly_summaries": len(hourly_summaries),
        }

    except Exception as exc:
        raise


def execute_weekly_summary(
    user_id: UUID,
    start_time: datetime,
    end_time: datetime,
    timezone: str = "UTC",
) -> Dict[str, Any]:
    """Execute weekly summary from daily summaries."""
    return _execute_rollup("weekly", user_id, start_time, end_time, timezone)


def execute_monthly_summary(
    user_id: UUID,
    start_time: datetime,
    end_time: datetime,
    timezone: str = "UTC",
) -> Dict[str, Any]:
    """Execute monthly summary from daily summaries."""
    return _execute_rollup("monthly", user_id, start_time, end_time, timezone)


def execute_dossier_refresh(
    user_id: UUID,
    end_time: datetime,
    timezone: str = "UTC",
    lookback_days: int = None,
) -> Dict[str, Any]:
    """Refresh user dossier from recent summaries."""
    try:
        from .dossier_builder import dossier_builder

        logger.info("dossier_refresh_started", user_id=str(user_id))

        # Get entity and previous dossier
        entity_id = _get_user_entity_id(user_id)
        if not entity_id:
            raise ValueError(f"No entity found for user {user_id}")

        logger.info("entity_found", entity_id=entity_id)

        previous_dossier = _get_entity_dossier(entity_id)
        logger.info("previous_dossier_fetched", has_dossier=bool(previous_dossier))

        # Build new dossier (LLM call)
        logger.info("building_new_dossier", lookback_days=lookback_days)
        dossier_payload = dossier_builder.build(
            user_id,
            end_time,
            timezone,
            lookback_override=lookback_days,
            previous_dossier=previous_dossier,
        )
        logger.info("dossier_built_successfully")

        if not dossier_payload:
            raise ValueError("Unable to build dossier from available summaries")

        # Persist
        db.execute_write(
            """
            UPDATE entities
            SET dossier = CAST(:dossier AS jsonb), updated_at = NOW()
            WHERE entity_id = :entity_id
            """,
            {"entity_id": entity_id, "dossier": json.dumps(dossier_payload)},
        )

        return {
            "entity_id": entity_id,
            "dossier": dossier_payload,
        }

    except Exception as exc:
        raise


# ============================================================================
# Internal helpers
# ============================================================================

def _execute_rollup(
    period_type: str,
    user_id: UUID,
    start_time: datetime,
    end_time: datetime,
    timezone: str,
) -> Dict[str, Any]:
    """Generic rollup (weekly/monthly/seasonal/yearly) from daily summaries."""
    try:
        daily_summaries = _get_summaries(user_id, start_time, end_time, "daily")
        if not daily_summaries:
            raise ValueError(f"No daily summaries found for {period_type} aggregation")

        # Generate rollup (LLM call)
        summary_data = summarizer.generate_period_rollup(period_type, daily_summaries)
        summary_id = _store_summary(user_id, summary_data, start_time, end_time, timezone)

        return {
            "summary_id": str(summary_id),
            "summary_type": period_type,
            "summary_text": summary_data.get("summary_text", ""),
            "activity_counts": summary_data.get("activity_counts", {}),
            "num_daily_summaries": len(daily_summaries),
        }

    except Exception as exc:
        raise


def _store_summary(
    user_id: UUID,
    summary_data: Dict[str, Any],
    start_time: datetime,
    end_time: datetime,
    timezone: str,
) -> UUID:
    """Store a summary in the database."""
    from uuid import uuid4

    summary_id = uuid4()
    summary_type = summary_data.get("summary_type", "unknown")

    # Build content payload
    content = {
        "summary_text": summary_data.get("summary_text", ""),
        "key_insights": summary_data.get("key_insights", []),
        "activity_counts": summary_data.get("activity_counts", {}),
        "tokens_used": summary_data.get("tokens_used", 0),
    }

    # Include structured data if present (time-scale specific fields)
    if "structured_data" in summary_data:
        content["structured_data"] = summary_data["structured_data"]

    # Determine source types from activity counts
    activity_counts = summary_data.get("activity_counts", {})
    source_types = [
        key for key, count in activity_counts.items()
        if key != "total" and count > 0
    ]

    # Insert
    db.execute_write(
        """
        INSERT INTO summaries (
            summary_id, user_id, period_start, period_end, period_type,
            timezone, source_types, title, content, summary_embedding, created_at, updated_at
        ) VALUES (
            :summary_id, :user_id, :period_start, :period_end, :period_type,
            :timezone, :source_types, :title, CAST(:content AS jsonb),
            CAST(:embedding AS vector), NOW(), NOW()
        )
        """,
        {
            "summary_id": str(summary_id),
            "user_id": str(user_id),
            "period_start": start_time,
            "period_end": end_time,
            "period_type": summary_type,
            "timezone": timezone,
            "source_types": source_types,
            "title": f"{summary_type.title()} Summary",
            "content": json.dumps(content),
            "embedding": json.dumps(summary_data.get("embedding", [])),
        },
    )

    logger.info("summary_stored", summary_id=str(summary_id), type=summary_type)
    return summary_id


def _get_summaries(
    user_id: UUID,
    start_time: datetime,
    end_time: datetime,
    period_type: str,
) -> list:
    """Get summaries of a given type for a time range."""
    rows = db.execute_query(
        """
        SELECT summary_id, content, period_start, period_end
        FROM summaries
        WHERE user_id = :user_id
          AND period_type = :period_type
          AND period_start >= :start_time
          AND period_start < :end_time
        ORDER BY period_start
        """,
        {
            "user_id": str(user_id),
            "period_type": period_type,
            "start_time": start_time,
            "end_time": end_time,
        },
    )

    # Parse content
    for row in rows:
        content = row.get("content")
        if isinstance(content, str):
            try:
                row["content"] = json.loads(content)
            except json.JSONDecodeError:
                row["content"] = {}
        row["summary_text"] = row.get("content", {}).get("summary_text", "")
        row["activity_counts"] = row.get("content", {}).get("activity_counts", {})

    return rows


def _get_user_entity_id(user_id: UUID) -> str:
    """Get or find entity_id for a user."""
    rows = db.execute_query(
        "SELECT entity_id FROM ci.users WHERE id = :user_id",
        {"user_id": str(user_id)},
    )
    if rows and rows[0].get("entity_id"):
        return str(rows[0]["entity_id"])

    # Fallback: find Person entity
    rows = db.execute_query(
        """
        SELECT entity_id FROM entities
        WHERE owner_user_id = :user_id AND entity_type = 'Person'
        ORDER BY created_at LIMIT 1
        """,
        {"user_id": str(user_id)},
    )
    return str(rows[0]["entity_id"]) if rows else None


def _get_entity_dossier(entity_id: str) -> dict:
    """Get dossier for an entity."""
    rows = db.execute_query(
        "SELECT dossier FROM entities WHERE entity_id = :entity_id",
        {"entity_id": entity_id},
    )
    if not rows:
        return None

    dossier = rows[0].get("dossier")
    if isinstance(dossier, dict):
        return dossier
    if isinstance(dossier, str):
        try:
            return json.loads(dossier)
        except json.JSONDecodeError:
            return None
    return None


# ============================================================================
# Insights Generation
# ============================================================================

def execute_insights(
    user_id: UUID,
    timezone: str = "UTC",
    lookback_hours: int = 72,
) -> Dict[str, Any]:
    """
    Execute proactive insights generation.

    Args:
        user_id: User to generate insights for
        timezone: User's timezone
        lookback_hours: How far back to look for context (default 72 hours / 3 days)

    Returns:
        Dict with insight results or skip reason
    """
    from uuid import uuid4
    from .insight_aggregator import insight_aggregator

    logger.info("insights_generation_started", user_id=str(user_id))

    now = datetime.utcnow()

    # Get last insight time to determine lookback
    last_insight_time = insight_aggregator.get_last_insight_time(user_id)
    if last_insight_time:
        since = last_insight_time
    else:
        since = now - timedelta(hours=lookback_hours)

    logger.info("lookback_window", since=since.isoformat(), until=now.isoformat())

    # Check if there's new data
    has_new_data = insight_aggregator.has_new_data(user_id, since)
    if not has_new_data:
        logger.info("no_new_data_skipping")
        return {
            "skipped": True,
            "reason": "no_new_data",
            "user_id": str(user_id),
        }

    # Aggregate context
    context = insight_aggregator.aggregate_insights_context(user_id, since, now)

    # Count all context sources for threshold check
    context_counts = {
        "graph_deltas": len(context.get("graph_deltas", [])),
        "upcoming_events": len(context.get("upcoming_events", [])),
        "recent_summaries": len(context.get("recent_summaries", [])),
        "strongest_relationships": len(context.get("strongest_relationships", [])),
        "recently_changed_relationships": len(context.get("recently_changed_relationships", [])),
        "event_relevant_relationships": len(context.get("event_relevant_relationships", [])),
        "recent_communications": len(context.get("recent_communications", [])),
    }
    total_context_items = sum(context_counts.values())
    has_dossier = context.get("user_dossier") is not None

    # Require at least 2 context items to generate insights
    if total_context_items < 2:
        logger.info(
            "insufficient_context",
            total_items=total_context_items,
            context_counts=context_counts,
            has_dossier=has_dossier,
        )
        return {
            "skipped": True,
            "reason": "insufficient_context",
            "user_id": str(user_id),
            "context_items": total_context_items,
        }

    logger.info("context_aggregated", total_items=total_context_items)

    # Generate insights (LLM call)
    insights_data = summarizer.generate_insights(context)

    num_insights = len(insights_data.get("insights", []))
    if num_insights == 0:
        logger.info("no_insights_generated")
        return {
            "skipped": True,
            "reason": "no_insights_generated",
            "user_id": str(user_id),
        }

    # Store each insight as a separate summary row
    insights_list = insights_data.get("insights", [])
    source_types = insights_data.get("data_sources_used", ["graph_deltas", "events", "summaries"])
    total_tokens = insights_data.get("tokens_used", 0)
    tokens_per_insight = total_tokens // num_insights if num_insights > 0 else 0

    # Prepare all inserts for transaction
    writes: list[tuple[str, dict]] = []
    summary_ids: list[str] = []

    insert_query = """
        INSERT INTO ci.summaries (
            summary_id, user_id, period_start, period_end, period_type,
            timezone, source_types, title, content, structured_context,
            tags, participants, confidence_score, metadata, created_at, updated_at
        ) VALUES (
            :summary_id, :user_id, :period_start, :period_end, 'insight',
            :timezone, :source_types, :title, CAST(:content AS jsonb),
            CAST(:structured_context AS jsonb), CAST(:tags AS jsonb),
            CAST(:participants AS uuid[]), :confidence_score,
            CAST(:metadata AS jsonb), NOW(), NOW()
        )
    """

    for insight in insights_list:
        summary_id = str(uuid4())
        summary_ids.append(summary_id)

        # Extract and validate participant UUIDs
        participants_list = []
        related_ids = insight.get("related_entity_ids", [])
        if related_ids:
            for entity_id in related_ids:
                try:
                    UUID(str(entity_id))
                    participants_list.append(str(entity_id))
                except (ValueError, TypeError):
                    pass

        # Content: lightweight payload for UI consumption
        content = {
            "summary_text": insight.get("summary_text", ""),
            "key_actions": insight.get("key_actions", []),
            "tokens_used": tokens_per_insight,
            "data_sources_used": source_types,
        }

        metadata = {
            "seen": False,
            "relevance_score": insight.get("relevance_score", 0),
        }

        params = {
            "summary_id": summary_id,
            "user_id": str(user_id),
            "period_start": since,
            "period_end": now,
            "timezone": timezone,
            "source_types": source_types,
            "title": insight.get("title", "Proactive Insight"),
            "content": json.dumps(content),
            "structured_context": json.dumps(insight),
            "tags": json.dumps(insight.get("tags", [])),
            "participants": participants_list,
            "confidence_score": insight.get("relevance_score", 0),
            "metadata": json.dumps(metadata),
        }

        writes.append((insert_query, params))

    # Execute all inserts in a single transaction
    db.execute_writes_in_transaction(writes)

    logger.info("insights_stored", summary_ids=summary_ids, num_insights=num_insights)

    return {
        "skipped": False,
        "summary_ids": summary_ids,
        "user_id": str(user_id),
        "num_insights": num_insights,
        "insights": insights_list,
        "tokens_used": total_tokens,
    }
