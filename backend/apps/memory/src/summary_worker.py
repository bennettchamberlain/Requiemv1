"""
PgBoss worker - listens to queue and executes summary jobs.

Simple: fetch jobs, delegate to summaries.py, update metrics.
"""
import json
import time
import uuid
import structlog
from datetime import datetime
from typing import Dict, Any, Optional

from .agent_registration import agent_registration
from .config import settings
from .database import db
from . import summaries

logger = structlog.get_logger()


class SummaryWorker:
    """Fetches summary jobs from PgBoss and executes them."""

    def __init__(self):
        self.running = False

    def start(self):
        """Start listening to queue."""
        self.running = True
        logger.info("worker_started", queue=settings.summary_queue_name)

        while self.running:
            jobs = self._fetch_jobs()
            if not jobs:
                time.sleep(settings.queue_empty_backoff_seconds)
                continue

            for job in jobs:
                self._handle_job(job)

    def stop(self):
        """Stop worker."""
        self.running = False
        logger.info("worker_stopped")

    # ========================================================================
    # Job handling
    # ========================================================================

    def _handle_job(self, job: Dict[str, Any]):
        """Handle a single job."""
        job_id = str(job.get("id"))
        start_time = time.time()
        message_id = None

        try:
            # Parse payload
            payload = job.get("data") or job.get("DATA")
            if isinstance(payload, str):
                payload = json.loads(payload)

            user_id = uuid.UUID(payload["userId"])
            period_type = payload["periodType"].lower()
            start = self._parse_iso(payload["periodStart"])
            end = self._parse_iso(payload["periodEnd"])
            timezone = payload.get("timezone", "UTC")

            logger.info("processing_job", job_id=job_id, user_id=str(user_id), period_type=period_type)

            # Record agent message
            message_id = self._record_agent_message(user_id, period_type, start, end, job_id, payload)

            # Execute summary
            result = self._execute_summary(user_id, period_type, start, end, timezone, payload)
            result["agent_message_id"] = str(message_id)

            # Complete
            self._complete_job(job_id, result)
            self._complete_agent_message(message_id, result)
            agent_registration.update_metrics(True, int((time.time() - start_time) * 1000))

            logger.info("job_completed", job_id=job_id, period_type=period_type)

        except Exception as exc:
            logger.error("job_failed", job_id=job_id, error=str(exc))
            self._fail_job(job_id, str(exc))
            if message_id:
                self._fail_agent_message(message_id, str(exc))
            agent_registration.update_metrics(False, int((time.time() - start_time) * 1000))

    def _execute_summary(
        self,
        user_id: uuid.UUID,
        period_type: str,
        start: datetime,
        end: datetime,
        timezone: str,
        payload: Dict[str, Any],
    ) -> Dict[str, Any]:
        """Execute summary based on type."""
        if period_type == "hourly":
            return summaries.execute_hourly_summary(user_id, start, end, timezone)
        elif period_type == "daily":
            return summaries.execute_daily_summary(user_id, start, end, timezone)
        elif period_type == "weekly":
            return summaries.execute_weekly_summary(user_id, start, end, timezone)
        elif period_type == "monthly":
            return summaries.execute_monthly_summary(user_id, start, end, timezone)
        elif period_type == "dossier":
            lookback = payload.get("lookbackDays")
            return summaries.execute_dossier_refresh(user_id, end, timezone, lookback)
        else:
            raise ValueError(f"Unsupported period type: {period_type}")

    # ========================================================================
    # PgBoss operations
    # ========================================================================

    def _fetch_jobs(self) -> list:
        """Fetch jobs from PgBoss queue."""
        try:
            return db.execute_query(
                """
                WITH ready AS (
                    SELECT id
                    FROM pgboss.job
                    WHERE name = :queue
                      AND state = 'created'
                      AND startafter <= NOW()
                    ORDER BY priority DESC, createdon
                    LIMIT :limit
                    FOR UPDATE SKIP LOCKED
                )
                UPDATE pgboss.job AS job
                SET state = 'active', startedon = NOW()
                FROM ready
                WHERE job.id = ready.id
                RETURNING job.id, job.data
                """,
                {
                    "queue": settings.summary_queue_name,
                    "limit": settings.queue_fetch_batch_size,
                },
            )
        except Exception as exc:
            logger.error("fetch_jobs_failed", error=str(exc))
            time.sleep(settings.queue_error_backoff_seconds)
            return []

    def _complete_job(self, job_id: str, output: Dict[str, Any]):
        """Mark job as completed."""
        db.execute_write(
            """
            UPDATE pgboss.job
            SET state = 'completed', completedon = NOW(), output = CAST(:output AS jsonb)
            WHERE id = :job_id
            """,
            {"job_id": job_id, "output": json.dumps(output)},
        )

    def _fail_job(self, job_id: str, reason: str):
        """Mark job as failed."""
        db.execute_write(
            """
            UPDATE pgboss.job
            SET state = 'failed', output = CAST(:output AS jsonb)
            WHERE id = :job_id
            """,
            {"job_id": job_id, "output": json.dumps({"error": reason})},
        )

    # ========================================================================
    # Agent message tracking
    # ========================================================================

    def _record_agent_message(
        self,
        user_id: uuid.UUID,
        period_type: str,
        start: datetime,
        end: datetime,
        job_id: str,
        payload: Dict[str, Any],
    ) -> uuid.UUID:
        """Record agent message for tracking."""
        if not agent_registration.agent_id:
            raise RuntimeError("Agent not registered")

        message_id = uuid.uuid4()
        db.execute_write(
            """
            INSERT INTO agent_messages (
                message_id, user_id, agent_id, root_message_id,
                input_payload, status, priority, created_at, started_at,
                goal_description, execution_context
            ) VALUES (
                :message_id, :user_id, :agent_id, :message_id,
                CAST(:payload AS jsonb), 'running', 5, NOW(), NOW(),
                :goal, CAST(:context AS jsonb)
            )
            """,
            {
                "message_id": str(message_id),
                "user_id": str(user_id),
                "agent_id": str(agent_registration.agent_id),
                "payload": json.dumps(payload),
                "goal": f"{period_type.title()} summary: {start.isoformat()} to {end.isoformat()}",
                "context": json.dumps({"pgboss_job_id": job_id, "queue": settings.summary_queue_name}),
            },
        )
        return message_id

    def _complete_agent_message(self, message_id: uuid.UUID, output: Dict[str, Any]):
        """Mark agent message as completed."""
        db.execute_write(
            """
            UPDATE agent_messages
            SET status = 'completed', completed_at = NOW(), output_payload = CAST(:output AS jsonb)
            WHERE message_id = :message_id
            """,
            {"message_id": str(message_id), "output": json.dumps(output)},
        )

    def _fail_agent_message(self, message_id: uuid.UUID, error: str):
        """Mark agent message as failed."""
        db.execute_write(
            """
            UPDATE agent_messages
            SET status = 'failed', error_message = :error, output_payload = CAST(:output AS jsonb)
            WHERE message_id = :message_id
            """,
            {"message_id": str(message_id), "error": error, "output": json.dumps({"error": error})},
        )

    # ========================================================================
    # Helpers
    # ========================================================================

    def _parse_iso(self, iso_str: str) -> datetime:
        """Parse ISO timestamp."""
        if not iso_str:
            raise ValueError("Missing timestamp")
        if iso_str.endswith("Z"):
            iso_str = iso_str.replace("Z", "+00:00")
        return datetime.fromisoformat(iso_str)


# Global worker instance
worker = SummaryWorker()

__all__ = ["worker", "SummaryWorker"]
