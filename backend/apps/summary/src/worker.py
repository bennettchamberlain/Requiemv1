"""
Temporal worker for summary service.

The worker connects to Temporal server, registers workflows and activities,
and polls for work to execute.
"""
import sys
import signal
import asyncio
import structlog
from temporalio.client import Client
from temporalio.worker import Worker

from .config import settings
from .llm_config import create_llm_config
from .database import db
from .agent_registration import agent_registration

# Import workflows
from .workflows import (
    HourlySummaryWorkflow,
    DailySummaryWorkflow,
    WeeklySummaryWorkflow,
    MonthlySummaryWorkflow,
    SeasonalSummaryWorkflow,
    YearlySummaryWorkflow,
    DossierRefreshWorkflow,
)

# Import system workflows
from .system_workflows import (
    SystemHourlySummariesWorkflow,
    SystemDailySummariesWorkflow,
    SystemWeeklySummariesWorkflow,
    SystemMonthlySummariesWorkflow,
    SystemDossierRefreshWorkflow,
)

# Import activities
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

# Configure structured logging
structlog.configure(
    processors=[
        structlog.stdlib.filter_by_level,
        structlog.stdlib.add_logger_name,
        structlog.stdlib.add_log_level,
        structlog.stdlib.PositionalArgumentsFormatter(),
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
        structlog.processors.UnicodeDecoder(),
        structlog.processors.JSONRenderer()
    ],
    context_class=dict,
    logger_factory=structlog.stdlib.LoggerFactory(),
    cache_logger_on_first_use=True,
)

logger = structlog.get_logger()


# Global worker instance for cleanup
_worker = None
_client = None


def signal_handler(sig, frame):
    """Handle shutdown signals gracefully."""
    logger.info("shutdown_signal_received", signal=sig)
    cleanup()
    sys.exit(0)


def cleanup():
    """Cleanup resources on shutdown."""
    logger.info("cleaning_up")
    agent_registration.deregister()
    db.close()


async def run_worker():
    """Run the Temporal worker."""
    global _worker, _client

    logger.info("temporal_worker_starting",
               version=settings.agent_version,
               model=settings.llm_model)

    try:
        # Create LLM config once at startup
        logger.info("creating_llm_config")
        llm_config = create_llm_config()
        logger.info("llm_config_created", model=settings.llm_model)

        # Connect to Temporal
        logger.info("connecting_to_temporal", address=settings.temporal_address)
        _client = await Client.connect(
            settings.temporal_address,
            namespace=settings.temporal_namespace,
        )
        logger.info("temporal_connected")

        # Create worker with all workflows and activities
        _worker = Worker(
            _client,
            task_queue="summary-tasks",
            workflows=[
                # Per-user workflows (can be triggered manually or by system workflows)
                HourlySummaryWorkflow,
                DailySummaryWorkflow,
                WeeklySummaryWorkflow,
                MonthlySummaryWorkflow,
                SeasonalSummaryWorkflow,
                YearlySummaryWorkflow,
                DossierRefreshWorkflow,
                # System workflows (process all users)
                SystemHourlySummariesWorkflow,
                SystemDailySummariesWorkflow,
                SystemWeeklySummariesWorkflow,
                SystemMonthlySummariesWorkflow,
                SystemDossierRefreshWorkflow,
            ],
            activities=[
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
            ],
            # Pass LLM config to activities via data_converter context
            # Activities can access this via activity.info().workflow_run_id
            activity_executor=None,  # Use default thread pool
        )

        logger.info("worker_configured",
                   workflows=12,
                   activities=10,
                   task_queue="summary-tasks")

        # Register agent with control plane
        try:
            agent_id = agent_registration.register()
            logger.info("agent_registered_successfully", agent_id=str(agent_id))
        except Exception as e:
            logger.warning("agent_registration_failed", error=str(e))
            # Continue without registration - not critical for Temporal worker

        # Run worker (blocking)
        logger.info("worker_starting_polling")
        await _worker.run()

    except Exception as e:
        logger.error("worker_failed", error=str(e), exc_info=True)
        cleanup()
        sys.exit(1)


def main():
    """Main entry point for worker."""
    # Register signal handlers
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)

    # Run worker
    asyncio.run(run_worker())


if __name__ == "__main__":
    main()
