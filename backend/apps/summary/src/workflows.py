"""
Temporal workflows for summary generation.

Workflows are durable, fault-tolerant orchestrations that coordinate
activities and maintain state across failures and restarts.
"""
from typing import Dict, Any, Optional
from datetime import timedelta
from temporalio import workflow
from temporalio.common import RetryPolicy

# Import activity definitions (not implementations!)
with workflow.unsafe.imports_passed_through():
    from .activities import (
        aggregate_data_activity,
        generate_hourly_summary_activity,
        generate_rollup_summary_activity,
        store_summary_activity,
        fetch_child_summaries_activity,
        get_entity_id_activity,
        fetch_previous_dossier_activity,
        fetch_summaries_for_dossier_activity,
        generate_dossier_activity,
        store_dossier_activity,
    )
    from .llm_config import LLMConfig


# ============================================================================
# Workflow Configuration
# ============================================================================

# Activity retry policy: exponential backoff for transient failures
ACTIVITY_RETRY_POLICY = RetryPolicy(
    initial_interval=timedelta(seconds=1),
    maximum_interval=timedelta(seconds=60),
    backoff_coefficient=2.0,
    maximum_attempts=5,
)

# Activity options will be passed directly to execute_activity calls
# Kept here for reference and consistency
def get_data_activity_options():
    """Activity options for data operations (fast, low timeout)"""
    return {
        "start_to_close_timeout": timedelta(seconds=30),
        "retry_policy": ACTIVITY_RETRY_POLICY,
    }

def get_llm_activity_options():
    """Activity options for LLM operations (slow, high timeout)"""
    return {
        "start_to_close_timeout": timedelta(minutes=5),
        "heartbeat_timeout": timedelta(seconds=30),
        "retry_policy": ACTIVITY_RETRY_POLICY,
    }


# ============================================================================
# Hourly Summary Workflow
# ============================================================================

@workflow.defn(name="hourly-summary")
class HourlySummaryWorkflow:
    """
    Workflow to generate hourly summary from raw activity data.

    Steps:
    1. Aggregate data from all sources
    2. Generate summary using LLM
    3. Store summary in database
    """

    @workflow.run
    async def run(
        self,
        user_id: str,
        start_time: str,  # ISO format
        end_time: str,    # ISO format
        timezone: str = "UTC",
        llm_config: Optional[LLMConfig] = None,
    ) -> Dict[str, Any]:
        """Execute hourly summary workflow."""
        workflow.logger.info(f"hourly_summary_workflow_started user_id={user_id}")

        # Step 1: Aggregate data
        aggregated_data = await workflow.execute_activity(
            aggregate_data_activity,
            args=[user_id, start_time, end_time],
            **get_data_activity_options(),
        )

        # Check if there's any activity
        total_activity = sum(
            len(v) for v in aggregated_data.values()
            if isinstance(v, list)
        )
        workflow.logger.info(f"data_aggregated total_items={total_activity}")

        # Step 2: Generate summary (LLM call)
        summary_data = await workflow.execute_activity(
            generate_hourly_summary_activity,
            args=[aggregated_data],
            **get_llm_activity_options(),
        )

        # Step 3: Store summary
        summary_id = await workflow.execute_activity(
            store_summary_activity,
            args=[user_id, summary_data, start_time, end_time, timezone],
            **get_data_activity_options(),
        )

        workflow.logger.info(f"hourly_summary_workflow_completed summary_id={summary_id}")

        return {
            "summary_id": summary_id,
            "summary_type": "hourly",
            "summary_text": summary_data.get("summary_text", ""),
            "key_insights": summary_data.get("key_insights", []),
            "activity_counts": summary_data.get("activity_counts", {}),
            "tokens_used": summary_data.get("tokens_used", 0),
        }


# ============================================================================
# Daily Summary Workflow
# ============================================================================

@workflow.defn(name="daily-summary")
class DailySummaryWorkflow:
    """
    Workflow to generate daily summary from hourly summaries.

    Steps:
    1. Fetch hourly summaries for the day
    2. Generate daily summary using LLM
    3. Store summary in database
    """

    @workflow.run
    async def run(
        self,
        user_id: str,
        start_time: str,
        end_time: str,
        timezone: str = "UTC",
        llm_config: Optional[LLMConfig] = None,
    ) -> Dict[str, Any]:
        """Execute daily summary workflow."""
        workflow.logger.info(f"daily_summary_workflow_started user_id={user_id}")

        # Step 1: Fetch hourly summaries
        hourly_summaries = await workflow.execute_activity(
            fetch_child_summaries_activity,
            args=[user_id, start_time, end_time, "hourly"],
            **get_data_activity_options(),
        )

        if not hourly_summaries:
            raise ValueError(f"No hourly summaries found for daily aggregation: {start_time} to {end_time}")

        workflow.logger.info(f"hourly_summaries_fetched count={len(hourly_summaries)}")

        # Step 2: Generate daily summary (LLM call)
        summary_data = await workflow.execute_activity(
            generate_rollup_summary_activity,
            args=["daily", hourly_summaries],
            **get_llm_activity_options(),
        )

        # Step 3: Store summary
        summary_id = await workflow.execute_activity(
            store_summary_activity,
            args=[user_id, summary_data, start_time, end_time, timezone],
            **get_data_activity_options(),
        )

        workflow.logger.info(f"daily_summary_workflow_completed summary_id={summary_id}")

        return {
            "summary_id": summary_id,
            "summary_type": "daily",
            "summary_text": summary_data.get("summary_text", ""),
            "activity_counts": summary_data.get("activity_counts", {}),
            "num_hourly_summaries": len(hourly_summaries),
            "tokens_used": summary_data.get("tokens_used", 0),
        }


# ============================================================================
# Weekly Summary Workflow
# ============================================================================

@workflow.defn(name="weekly-summary")
class WeeklySummaryWorkflow:
    """
    Workflow to generate weekly summary from daily summaries.

    Steps:
    1. Fetch daily summaries for the week
    2. Generate weekly summary using LLM
    3. Store summary in database
    """

    @workflow.run
    async def run(
        self,
        user_id: str,
        start_time: str,
        end_time: str,
        timezone: str = "UTC",
        llm_config: Optional[LLMConfig] = None,
    ) -> Dict[str, Any]:
        """Execute weekly summary workflow."""
        workflow.logger.info(f"weekly_summary_workflow_started user_id={user_id}")

        # Step 1: Fetch daily summaries
        daily_summaries = await workflow.execute_activity(
            fetch_child_summaries_activity,
            args=[user_id, start_time, end_time, "daily"],
            **get_data_activity_options(),
        )

        if not daily_summaries:
            raise ValueError(f"No daily summaries found for weekly aggregation: {start_time} to {end_time}")

        workflow.logger.info(f"daily_summaries_fetched count={len(daily_summaries)}")

        # Step 2: Generate weekly summary (LLM call)
        summary_data = await workflow.execute_activity(
            generate_rollup_summary_activity,
            args=["weekly", daily_summaries],
            **get_llm_activity_options(),
        )

        # Step 3: Store summary
        summary_id = await workflow.execute_activity(
            store_summary_activity,
            args=[user_id, summary_data, start_time, end_time, timezone],
            **get_data_activity_options(),
        )

        workflow.logger.info(f"weekly_summary_workflow_completed summary_id={summary_id}")

        return {
            "summary_id": summary_id,
            "summary_type": "weekly",
            "summary_text": summary_data.get("summary_text", ""),
            "activity_counts": summary_data.get("activity_counts", {}),
            "num_daily_summaries": len(daily_summaries),
            "tokens_used": summary_data.get("tokens_used", 0),
        }


# ============================================================================
# Monthly Summary Workflow
# ============================================================================

@workflow.defn(name="monthly-summary")
class MonthlySummaryWorkflow:
    """
    Workflow to generate monthly summary from daily summaries.

    Steps:
    1. Fetch daily summaries for the month
    2. Generate monthly summary using LLM
    3. Store summary in database
    """

    @workflow.run
    async def run(
        self,
        user_id: str,
        start_time: str,
        end_time: str,
        timezone: str = "UTC",
        llm_config: Optional[LLMConfig] = None,
    ) -> Dict[str, Any]:
        """Execute monthly summary workflow."""
        workflow.logger.info(f"monthly_summary_workflow_started user_id={user_id}")

        # Step 1: Fetch daily summaries
        daily_summaries = await workflow.execute_activity(
            fetch_child_summaries_activity,
            args=[user_id, start_time, end_time, "daily"],
            **get_data_activity_options(),
        )

        if not daily_summaries:
            raise ValueError(f"No daily summaries found for monthly aggregation: {start_time} to {end_time}")

        workflow.logger.info(f"daily_summaries_fetched count={len(daily_summaries)}")

        # Step 2: Generate monthly summary (LLM call)
        summary_data = await workflow.execute_activity(
            generate_rollup_summary_activity,
            args=["monthly", daily_summaries],
            **get_llm_activity_options(),
        )

        # Step 3: Store summary
        summary_id = await workflow.execute_activity(
            store_summary_activity,
            args=[user_id, summary_data, start_time, end_time, timezone],
            **get_data_activity_options(),
        )

        workflow.logger.info(f"monthly_summary_workflow_completed summary_id={summary_id}")

        return {
            "summary_id": summary_id,
            "summary_type": "monthly",
            "summary_text": summary_data.get("summary_text", ""),
            "activity_counts": summary_data.get("activity_counts", {}),
            "num_daily_summaries": len(daily_summaries),
            "tokens_used": summary_data.get("tokens_used", 0),
        }


# ============================================================================
# Seasonal Summary Workflow
# ============================================================================

@workflow.defn(name="seasonal-summary")
class SeasonalSummaryWorkflow:
    """
    Workflow to generate seasonal summary from daily summaries.

    Steps:
    1. Fetch daily summaries for the season (3 months)
    2. Generate seasonal summary using LLM
    3. Store summary in database
    """

    @workflow.run
    async def run(
        self,
        user_id: str,
        start_time: str,
        end_time: str,
        timezone: str = "UTC",
        llm_config: Optional[LLMConfig] = None,
    ) -> Dict[str, Any]:
        """Execute seasonal summary workflow."""
        workflow.logger.info(f"seasonal_summary_workflow_started user_id={user_id}")

        # Step 1: Fetch daily summaries
        daily_summaries = await workflow.execute_activity(
            fetch_child_summaries_activity,
            args=[user_id, start_time, end_time, "daily"],
            **get_data_activity_options(),
        )

        if not daily_summaries:
            raise ValueError(f"No daily summaries found for seasonal aggregation: {start_time} to {end_time}")

        workflow.logger.info(f"daily_summaries_fetched count={len(daily_summaries)}")

        # Step 2: Generate seasonal summary (LLM call)
        summary_data = await workflow.execute_activity(
            generate_rollup_summary_activity,
            args=["seasonal", daily_summaries],
            **get_llm_activity_options(),
        )

        # Step 3: Store summary
        summary_id = await workflow.execute_activity(
            store_summary_activity,
            args=[user_id, summary_data, start_time, end_time, timezone],
            **get_data_activity_options(),
        )

        workflow.logger.info(f"seasonal_summary_workflow_completed summary_id={summary_id}")

        return {
            "summary_id": summary_id,
            "summary_type": "seasonal",
            "summary_text": summary_data.get("summary_text", ""),
            "activity_counts": summary_data.get("activity_counts", {}),
            "num_daily_summaries": len(daily_summaries),
            "tokens_used": summary_data.get("tokens_used", 0),
        }


# ============================================================================
# Yearly Summary Workflow
# ============================================================================

@workflow.defn(name="yearly-summary")
class YearlySummaryWorkflow:
    """
    Workflow to generate yearly summary from daily summaries.

    Steps:
    1. Fetch daily summaries for the year
    2. Generate yearly summary using LLM
    3. Store summary in database
    """

    @workflow.run
    async def run(
        self,
        user_id: str,
        start_time: str,
        end_time: str,
        timezone: str = "UTC",
        llm_config: Optional[LLMConfig] = None,
    ) -> Dict[str, Any]:
        """Execute yearly summary workflow."""
        workflow.logger.info(f"yearly_summary_workflow_started user_id={user_id}")

        # Step 1: Fetch daily summaries
        daily_summaries = await workflow.execute_activity(
            fetch_child_summaries_activity,
            args=[user_id, start_time, end_time, "daily"],
            **get_data_activity_options(),
        )

        if not daily_summaries:
            raise ValueError(f"No daily summaries found for yearly aggregation: {start_time} to {end_time}")

        workflow.logger.info(f"daily_summaries_fetched count={len(daily_summaries)}")

        # Step 2: Generate yearly summary (LLM call)
        summary_data = await workflow.execute_activity(
            generate_rollup_summary_activity,
            args=["yearly", daily_summaries],
            **get_llm_activity_options(),
        )

        # Step 3: Store summary
        summary_id = await workflow.execute_activity(
            store_summary_activity,
            args=[user_id, summary_data, start_time, end_time, timezone],
            **get_data_activity_options(),
        )

        workflow.logger.info(f"yearly_summary_workflow_completed summary_id={summary_id}")

        return {
            "summary_id": summary_id,
            "summary_type": "yearly",
            "summary_text": summary_data.get("summary_text", ""),
            "activity_counts": summary_data.get("activity_counts", {}),
            "num_daily_summaries": len(daily_summaries),
            "tokens_used": summary_data.get("tokens_used", 0),
        }


# ============================================================================
# Dossier Refresh Workflow
# ============================================================================

@workflow.defn(name="dossier-refresh")
class DossierRefreshWorkflow:
    """
    Workflow to refresh user dossier from recent summaries.

    Steps:
    1. Get entity ID for user
    2. Fetch previous dossier
    3. Fetch recent summaries (daily + hourly)
    4. Generate new dossier using LLM
    5. Store dossier in entities table
    """

    @workflow.run
    async def run(
        self,
        user_id: str,
        end_time: str,
        timezone: str = "UTC",
        lookback_days: int = 30,
        llm_config: Optional[LLMConfig] = None,
    ) -> Dict[str, Any]:
        """Execute dossier refresh workflow."""
        workflow.logger.info(f"dossier_refresh_workflow_started user_id={user_id}")

        # Step 1: Get entity ID
        entity_id = await workflow.execute_activity(
            get_entity_id_activity,
            args=[user_id],
            **get_data_activity_options(),
        )

        if not entity_id:
            raise ValueError(f"No entity found for user {user_id}")

        workflow.logger.info(f"entity_id_retrieved entity_id={entity_id}")

        # Step 2: Fetch previous dossier
        previous_dossier = await workflow.execute_activity(
            fetch_previous_dossier_activity,
            args=[entity_id],
            **get_data_activity_options(),
        )

        workflow.logger.info(f"previous_dossier_fetched has_dossier={bool(previous_dossier)}")

        # Step 3: Fetch summaries
        summaries = await workflow.execute_activity(
            fetch_summaries_for_dossier_activity,
            args=[user_id, lookback_days, end_time],
            **get_data_activity_options(),
        )

        daily_summaries = summaries.get("daily", [])
        hourly_summaries = summaries.get("hourly", [])

        if not daily_summaries and not hourly_summaries:
            raise ValueError(f"No summaries found for dossier generation")

        workflow.logger.info(
            f"summaries_fetched daily_count={len(daily_summaries)} hourly_count={len(hourly_summaries)}"
        )

        # Step 4: Generate dossier (LLM call)
        dossier = await workflow.execute_activity(
            generate_dossier_activity,
            args=[user_id, daily_summaries, hourly_summaries, previous_dossier],
            **get_llm_activity_options(),
        )

        # Step 5: Store dossier
        await workflow.execute_activity(
            store_dossier_activity,
            args=[entity_id, dossier],
            **get_data_activity_options(),
        )

        workflow.logger.info(f"dossier_refresh_workflow_completed entity_id={entity_id}")

        return {
            "entity_id": entity_id,
            "dossier": dossier,
        }


__all__ = [
    "HourlySummaryWorkflow",
    "DailySummaryWorkflow",
    "WeeklySummaryWorkflow",
    "MonthlySummaryWorkflow",
    "SeasonalSummaryWorkflow",
    "YearlySummaryWorkflow",
    "DossierRefreshWorkflow",
]
