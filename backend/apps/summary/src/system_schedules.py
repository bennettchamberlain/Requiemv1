"""
System-wide schedule setup for summary service.

Creates schedules that process ALL users automatically.
No per-user setup required - just works!
"""
import asyncio
import structlog
from temporalio.client import Client, Schedule, ScheduleActionStartWorkflow, ScheduleSpec

from .config import settings
from .system_workflows import (
    SystemHourlySummariesWorkflow,
    SystemDailySummariesWorkflow,
    SystemWeeklySummariesWorkflow,
    SystemMonthlySummariesWorkflow,
    SystemDossierRefreshWorkflow,
)

logger = structlog.get_logger()


async def setup_system_schedules():
    """
    Set up system-wide schedules that automatically process all users.

    This only needs to be run once - schedules persist in Temporal's database.
    """
    logger.info("system_schedule_setup_starting")

    # Connect to Temporal
    client = await Client.connect(
        settings.temporal_address,
        namespace=settings.temporal_namespace,
    )
    logger.info("temporal_connected", address=settings.temporal_address)

    # Create hourly summary schedule
    try:
        await client.create_schedule(
            "system-hourly-summaries",
            Schedule(
                action=ScheduleActionStartWorkflow(
                    SystemHourlySummariesWorkflow.run,
                    id="system-hourly-{action.scheduled_time}",
                    task_queue="summary-tasks",
                ),
                spec=ScheduleSpec(
                    # Run at 5 minutes past every hour
                    cron_expressions=["5 * * * *"],
                ),
            ),
        )
        logger.info("schedule_created", schedule="system-hourly-summaries", cron="5 * * * *")
    except Exception as e:
        if "already exists" in str(e).lower():
            logger.info("schedule_already_exists", schedule="system-hourly-summaries")
        else:
            logger.error("schedule_creation_failed", schedule="system-hourly-summaries", error=str(e))

    # Create daily summary schedule
    try:
        await client.create_schedule(
            "system-daily-summaries",
            Schedule(
                action=ScheduleActionStartWorkflow(
                    SystemDailySummariesWorkflow.run,
                    id="system-daily-{action.scheduled_time}",
                    task_queue="summary-tasks",
                ),
                spec=ScheduleSpec(
                    # Run at 00:10 UTC every day
                    cron_expressions=["10 0 * * *"],
                ),
            ),
        )
        logger.info("schedule_created", schedule="system-daily-summaries", cron="10 0 * * *")
    except Exception as e:
        if "already exists" in str(e).lower():
            logger.info("schedule_already_exists", schedule="system-daily-summaries")
        else:
            logger.error("schedule_creation_failed", schedule="system-daily-summaries", error=str(e))

    # Create weekly summary schedule
    try:
        await client.create_schedule(
            "system-weekly-summaries",
            Schedule(
                action=ScheduleActionStartWorkflow(
                    SystemWeeklySummariesWorkflow.run,
                    id="system-weekly-{action.scheduled_time}",
                    task_queue="summary-tasks",
                ),
                spec=ScheduleSpec(
                    # Run at 00:15 UTC every Monday
                    cron_expressions=["15 0 * * MON"],
                ),
            ),
        )
        logger.info("schedule_created", schedule="system-weekly-summaries", cron="15 0 * * MON")
    except Exception as e:
        if "already exists" in str(e).lower():
            logger.info("schedule_already_exists", schedule="system-weekly-summaries")
        else:
            logger.error("schedule_creation_failed", schedule="system-weekly-summaries", error=str(e))

    # Create monthly summary schedule
    try:
        await client.create_schedule(
            "system-monthly-summaries",
            Schedule(
                action=ScheduleActionStartWorkflow(
                    SystemMonthlySummariesWorkflow.run,
                    id="system-monthly-{action.scheduled_time}",
                    task_queue="summary-tasks",
                ),
                spec=ScheduleSpec(
                    # Run at 00:20 UTC on the 1st of every month
                    cron_expressions=["20 0 1 * *"],
                ),
            ),
        )
        logger.info("schedule_created", schedule="system-monthly-summaries", cron="20 0 1 * *")
    except Exception as e:
        if "already exists" in str(e).lower():
            logger.info("schedule_already_exists", schedule="system-monthly-summaries")
        else:
            logger.error("schedule_creation_failed", schedule="system-monthly-summaries", error=str(e))

    # Create dossier refresh schedule
    try:
        await client.create_schedule(
            "system-dossier-refresh",
            Schedule(
                action=ScheduleActionStartWorkflow(
                    SystemDossierRefreshWorkflow.run,
                    id="system-dossier-{action.scheduled_time}",
                    task_queue="summary-tasks",
                ),
                spec=ScheduleSpec(
                    # Run at 12 minutes past every hour
                    cron_expressions=["12 * * * *"],
                ),
            ),
        )
        logger.info("schedule_created", schedule="system-dossier-refresh", cron="12 * * * *")
    except Exception as e:
        if "already exists" in str(e).lower():
            logger.info("schedule_already_exists", schedule="system-dossier-refresh")
        else:
            logger.error("schedule_creation_failed", schedule="system-dossier-refresh", error=str(e))

    logger.info("system_schedule_setup_completed", schedules=5)
    print("\n✅ System schedules created successfully!")
    print("\nSchedules:")
    print("  - system-hourly-summaries   (every hour at :05)")
    print("  - system-daily-summaries    (daily at 00:10 UTC)")
    print("  - system-weekly-summaries   (Mondays at 00:15 UTC)")
    print("  - system-monthly-summaries  (1st of month at 00:20 UTC)")
    print("  - system-dossier-refresh    (every hour at :12)")
    print("\n👉 View schedules in Temporal UI: http://localhost:8080")
    print("👉 These will automatically process ALL users - no manual setup needed!\n")


async def delete_system_schedules():
    """Delete all system schedules."""
    logger.info("deleting_system_schedules")

    client = await Client.connect(
        settings.temporal_address,
        namespace=settings.temporal_namespace,
    )

    schedules = [
        "system-hourly-summaries",
        "system-daily-summaries",
        "system-weekly-summaries",
        "system-monthly-summaries",
        "system-dossier-refresh",
    ]

    for schedule_id in schedules:
        try:
            schedule_handle = client.get_schedule_handle(schedule_id)
            await schedule_handle.delete()
            logger.info("schedule_deleted", schedule_id=schedule_id)
        except Exception as e:
            logger.warning("failed_to_delete_schedule", schedule_id=schedule_id, error=str(e))

    logger.info("system_schedules_deleted")
    print("\n✅ System schedules deleted!\n")


async def list_system_schedules():
    """List all system schedules."""
    logger.info("listing_schedules")

    client = await Client.connect(
        settings.temporal_address,
        namespace=settings.temporal_namespace,
    )

    print("\n📋 System Schedules:\n")
    count = 0
    async for schedule in client.list_schedules():
        if schedule.id.startswith("system-"):
            print(f"  ✓ {schedule.id}")
            count += 1

    if count == 0:
        print("  (no system schedules found)")
        print("\n  Run: python -m src.system_schedules setup")
    else:
        print(f"\nTotal: {count} schedules")
        print("\n👉 View details in Temporal UI: http://localhost:8080\n")


def main():
    """Main entry point for schedule setup."""
    import sys

    if len(sys.argv) < 2:
        print("Usage:")
        print("  python -m src.system_schedules setup    # Set up system schedules (run once)")
        print("  python -m src.system_schedules delete   # Delete all system schedules")
        print("  python -m src.system_schedules list     # List all schedules")
        sys.exit(1)

    command = sys.argv[1]

    if command == "setup":
        asyncio.run(setup_system_schedules())
    elif command == "delete":
        asyncio.run(delete_system_schedules())
    elif command == "list":
        asyncio.run(list_system_schedules())
    else:
        print(f"Unknown command: {command}")
        sys.exit(1)


if __name__ == "__main__":
    main()


__all__ = [
    "setup_system_schedules",
    "delete_system_schedules",
    "list_system_schedules",
]
