"""
Temporal activities for summary generation.

Activities are retriable units of work that can fail and be retried.
They are thin wrappers around pure functions and database operations.
"""
import json
import structlog
from typing import Dict, List, Any, Optional
from datetime import datetime, timedelta
from uuid import UUID, uuid4
from temporalio import activity

from .config import settings
from .data_aggregator import aggregator
from .database import db
from .llm_config import LLMConfig, create_llm_config
from .summary_functions import (
    generate_hourly_summary,
    generate_rollup_summary,
    generate_user_dossier,
)

logger = structlog.get_logger()


# ============================================================================
# Data Aggregation Activities
# ============================================================================

@activity.defn
async def aggregate_data_activity(
    user_id: str,
    start_time: str,  # ISO format
    end_time: str,    # ISO format
) -> Dict[str, Any]:
    """
    Aggregate user activity data for a time period.

    This activity queries all configured data sources and returns
    aggregated data for summary generation.
    """
    activity.logger.info("aggregating_data", user_id=user_id, start=start_time, end=end_time)

    # Send heartbeat for long-running operation
    activity.heartbeat("Starting data aggregation")

    user_uuid = UUID(user_id)
    start_dt = datetime.fromisoformat(start_time)
    end_dt = datetime.fromisoformat(end_time)

    # Add overlap for context
    overlap = timedelta(minutes=settings.summary_overlap_minutes)
    adjusted_start = start_dt - overlap
    adjusted_end = end_dt + overlap

    # Call pure aggregator function
    aggregated_data = aggregator.aggregate_hour(user_uuid, adjusted_start, adjusted_end)

    activity.heartbeat("Data aggregation complete")

    activity.logger.info(
        "data_aggregated",
        user_id=user_id,
        total_sources=len([k for k, v in aggregated_data.items() if isinstance(v, list) and v])
    )

    return aggregated_data


# ============================================================================
# Summary Generation Activities
# ============================================================================

@activity.defn
async def generate_hourly_summary_activity(
    aggregated_data: Dict[str, Any],
) -> Dict[str, Any]:
    """
    Generate hourly summary from aggregated data using LLM.

    This activity calls the LLM to create a summary and is the main
    point where LLM API failures can occur (handled by retry policy).
    """
    activity.logger.info("generating_hourly_summary")
    activity.heartbeat("Calling LLM for hourly summary")

    # Create LLM config
    llm_config = create_llm_config()

    # Call pure function
    summary_data = generate_hourly_summary(llm_config, aggregated_data)

    activity.heartbeat("Hourly summary generated")
    activity.logger.info(
        "hourly_summary_generated",
        tokens_used=summary_data.get("tokens_used", 0),
        has_activity=summary_data.get("activity_counts", {}).get("total", 0) > 0
    )

    return summary_data


@activity.defn
async def generate_rollup_summary_activity(
    period_type: str,
    child_summaries: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """
    Generate rollup summary (daily/weekly/monthly/seasonal/yearly).

    This activity synthesizes child summaries into a higher-level summary.
    """
    activity.logger.info("generating_rollup_summary", period_type=period_type, child_count=len(child_summaries))
    activity.heartbeat(f"Generating {period_type} summary")

    # Create LLM config
    llm_config = create_llm_config()

    # Call pure function
    summary_data = generate_rollup_summary(llm_config, period_type, child_summaries)

    activity.heartbeat(f"{period_type.title()} summary generated")
    activity.logger.info(
        "rollup_summary_generated",
        period_type=period_type,
        tokens_used=summary_data.get("tokens_used", 0)
    )

    return summary_data


# ============================================================================
# Database Activities - Summaries
# ============================================================================

@activity.defn
async def store_summary_activity(
    user_id: str,
    summary_data: Dict[str, Any],
    start_time: str,
    end_time: str,
    timezone: str,
) -> str:
    """
    Store a summary in the database.

    Returns the summary_id as a string.
    """
    activity.logger.info("storing_summary", summary_type=summary_data.get("summary_type"))
    activity.heartbeat("Storing summary to database")

    user_uuid = UUID(user_id)
    start_dt = datetime.fromisoformat(start_time)
    end_dt = datetime.fromisoformat(end_time)

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

    # Prepare embedding (use None if empty)
    embedding = summary_data.get("embedding", [])
    embedding_value = json.dumps(embedding) if embedding else None

    # Insert
    db.execute_write(
        """
        INSERT INTO summaries (
            summary_id, user_id, period_start, period_end, period_type,
            timezone, source_types, title, content, summary_embedding, created_at, updated_at
        ) VALUES (
            :summary_id, :user_id, :period_start, :period_end, :period_type,
            :timezone, :source_types, :title, CAST(:content AS jsonb),
            CASE WHEN :embedding IS NULL THEN NULL ELSE CAST(:embedding AS vector) END, NOW(), NOW()
        )
        """,
        {
            "summary_id": str(summary_id),
            "user_id": str(user_uuid),
            "period_start": start_dt,
            "period_end": end_dt,
            "period_type": summary_type,
            "timezone": timezone,
            "source_types": source_types,
            "title": f"{summary_type.title()} Summary",
            "content": json.dumps(content),
            "embedding": embedding_value,
        },
    )

    activity.heartbeat("Summary stored")
    activity.logger.info("summary_stored", summary_id=str(summary_id), type=summary_type)

    return str(summary_id)


@activity.defn
async def fetch_child_summaries_activity(
    user_id: str,
    start_time: str,
    end_time: str,
    period_type: str,
) -> List[Dict[str, Any]]:
    """
    Fetch child summaries for rollup generation.

    For example, fetch hourly summaries to create daily summary,
    or daily summaries to create weekly summary.
    """
    activity.logger.info("fetching_child_summaries", period_type=period_type)
    activity.heartbeat(f"Fetching {period_type} summaries")

    user_uuid = UUID(user_id)
    start_dt = datetime.fromisoformat(start_time)
    end_dt = datetime.fromisoformat(end_time)

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
            "user_id": str(user_uuid),
            "period_type": period_type,
            "start_time": start_dt,
            "end_time": end_dt,
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

    activity.heartbeat(f"Found {len(rows)} {period_type} summaries")
    activity.logger.info("child_summaries_fetched", count=len(rows))

    return rows


# ============================================================================
# Database Activities - Dossier
# ============================================================================

@activity.defn
async def get_entity_id_activity(user_id: str) -> Optional[str]:
    """
    Get or find entity_id for a user.

    Returns entity_id or None if not found.
    """
    activity.logger.info("getting_entity_id", user_id=user_id)
    activity.heartbeat("Looking up entity ID")

    user_uuid = UUID(user_id)

    # Try from users table first
    rows = db.execute_query(
        "SELECT entity_id FROM ci.users WHERE id = :user_id",
        {"user_id": str(user_uuid)},
    )
    if rows and rows[0].get("entity_id"):
        entity_id = str(rows[0]["entity_id"])
        activity.logger.info("entity_id_found_from_users", entity_id=entity_id)
        return entity_id

    # Fallback: find Person entity
    rows = db.execute_query(
        """
        SELECT entity_id FROM entities
        WHERE owner_user_id = :user_id AND entity_type = 'Person'
        ORDER BY created_at LIMIT 1
        """,
        {"user_id": str(user_uuid)},
    )

    if rows:
        entity_id = str(rows[0]["entity_id"])
        activity.logger.info("entity_id_found_from_entities", entity_id=entity_id)
        return entity_id

    activity.logger.warning("entity_id_not_found", user_id=user_id)
    return None


@activity.defn
async def fetch_previous_dossier_activity(entity_id: str) -> Optional[Dict[str, Any]]:
    """
    Fetch the previous dossier for an entity.

    Returns the dossier dict or None if not found.
    """
    activity.logger.info("fetching_previous_dossier", entity_id=entity_id)
    activity.heartbeat("Fetching previous dossier")

    rows = db.execute_query(
        "SELECT dossier FROM entities WHERE entity_id = :entity_id",
        {"entity_id": entity_id},
    )

    if not rows:
        activity.logger.info("no_previous_dossier_found")
        return None

    dossier = rows[0].get("dossier")

    if isinstance(dossier, dict):
        activity.logger.info("previous_dossier_fetched")
        return dossier

    if isinstance(dossier, str):
        try:
            parsed = json.loads(dossier)
            activity.logger.info("previous_dossier_parsed")
            return parsed
        except json.JSONDecodeError:
            activity.logger.warning("dossier_parse_failed")
            return None

    activity.logger.info("no_dossier_data")
    return None


@activity.defn
async def fetch_summaries_for_dossier_activity(
    user_id: str,
    lookback_days: int,
    end_time: str,
) -> Dict[str, List[Dict[str, Any]]]:
    """
    Fetch recent summaries for dossier generation.

    Returns dict with 'daily' and 'hourly' summary lists.
    """
    activity.logger.info("fetching_summaries_for_dossier", lookback_days=lookback_days)
    activity.heartbeat("Fetching recent summaries")

    user_uuid = UUID(user_id)
    end_dt = datetime.fromisoformat(end_time)
    daily_start = end_dt - timedelta(days=lookback_days)
    hourly_start = end_dt - timedelta(days=1)

    # Fetch daily summaries
    daily_rows = db.execute_query(
        """
        SELECT summary_id, content, period_start, period_end
        FROM summaries
        WHERE user_id = :user_id
          AND period_type = 'daily'
          AND period_start >= :start
          AND period_start < :end
        ORDER BY period_start
        """,
        {"user_id": str(user_uuid), "start": daily_start, "end": end_dt},
    )

    # Fetch hourly summaries (last 24 hours)
    hourly_rows = db.execute_query(
        """
        SELECT summary_id, content, period_start, period_end
        FROM summaries
        WHERE user_id = :user_id
          AND period_type = 'hourly'
          AND period_start >= :start
          AND period_start < :end
        ORDER BY period_start
        """,
        {"user_id": str(user_uuid), "start": hourly_start, "end": end_dt},
    )

    # Parse content for both
    for row in daily_rows + hourly_rows:
        content = row.get("content")
        if isinstance(content, str):
            try:
                row["content"] = json.loads(content)
            except json.JSONDecodeError:
                row["content"] = {}
        row["summary_text"] = row.get("content", {}).get("summary_text", "")
        row["activity_counts"] = row.get("content", {}).get("activity_counts", {})

    activity.heartbeat(f"Found {len(daily_rows)} daily, {len(hourly_rows)} hourly summaries")
    activity.logger.info(
        "summaries_fetched_for_dossier",
        daily_count=len(daily_rows),
        hourly_count=len(hourly_rows)
    )

    return {
        "daily": daily_rows[-30:],  # Last 30 days max
        "hourly": hourly_rows[-24:],  # Last 24 hours max
    }


@activity.defn
async def generate_dossier_activity(
    user_id: str,
    daily_summaries: List[Dict[str, Any]],
    hourly_summaries: List[Dict[str, Any]],
    previous_dossier: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Generate user dossier from summaries using LLM.

    Returns the dossier payload ready to be stored.
    """
    activity.logger.info(
        "generating_dossier",
        daily_count=len(daily_summaries),
        hourly_count=len(hourly_summaries)
    )
    activity.heartbeat("Calling LLM for dossier generation")

    # Create LLM config
    llm_config = create_llm_config()

    # Call pure function
    dossier = generate_user_dossier(
        llm_config,
        user_id,
        daily_summaries,
        hourly_summaries,
        previous_dossier,
    )

    activity.heartbeat("Dossier generated")
    activity.logger.info("dossier_generated")

    return dossier


@activity.defn
async def store_dossier_activity(
    entity_id: str,
    dossier: Dict[str, Any],
) -> None:
    """
    Store dossier in the entities table.
    """
    activity.logger.info("storing_dossier", entity_id=entity_id)
    activity.heartbeat("Storing dossier to database")

    db.execute_write(
        """
        UPDATE entities
        SET dossier = CAST(:dossier AS jsonb), updated_at = NOW()
        WHERE entity_id = :entity_id
        """,
        {"entity_id": entity_id, "dossier": json.dumps(dossier)},
    )

    activity.heartbeat("Dossier stored")
    activity.logger.info("dossier_stored", entity_id=entity_id)


__all__ = [
    "aggregate_data_activity",
    "generate_hourly_summary_activity",
    "generate_rollup_summary_activity",
    "store_summary_activity",
    "fetch_child_summaries_activity",
    "get_entity_id_activity",
    "fetch_previous_dossier_activity",
    "fetch_summaries_for_dossier_activity",
    "generate_dossier_activity",
    "store_dossier_activity",
]
