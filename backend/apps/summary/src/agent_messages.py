"""
Agent message queue tracking for LLM usage management.

Tracks when summary agents are queued, running, and completed
to manage LLM bottleneck.
"""
import json
import structlog
from datetime import datetime
from typing import Dict, Any, Optional
from uuid import UUID, uuid4

from .database import db

logger = structlog.get_logger()


class AgentMessageTracker:
    """Tracks agent execution in the agent_messages queue."""

    def __init__(self, agent_registration):
        """Initialize with agent registration to get agent_id."""
        self.agent_registration = agent_registration

    def create_message(
        self,
        user_id: UUID,
        task_type: str,
        input_payload: Dict[str, Any],
        priority: int = 5,
    ) -> UUID:
        """
        Create a new agent message in 'queued' status.

        Returns message_id for later updates.
        """
        message_id = uuid4()

        # Get agent_id from registration
        if not self.agent_registration.agent_id:
            logger.warning("agent_not_registered_skipping_message_creation")
            return message_id

        try:
            db.execute_write(
                """
                INSERT INTO agent_messages (
                    message_id, user_id, agent_id, status, priority,
                    input_payload, goal_description, created_at
                ) VALUES (
                    :message_id, :user_id, :agent_id, 'queued', :priority,
                    CAST(:input_payload AS jsonb), :goal_description, NOW()
                )
                """,
                {
                    "message_id": str(message_id),
                    "user_id": str(user_id),
                    "agent_id": str(self.agent_registration.agent_id),
                    "priority": priority,
                    "input_payload": json.dumps(input_payload),
                    "goal_description": f"Generate {task_type} summary",
                },
            )
            logger.debug("agent_message_created",
                        message_id=str(message_id),
                        task_type=task_type,
                        status="queued")
        except Exception as exc:
            logger.error("failed_to_create_agent_message", error=str(exc))

        return message_id

    def mark_running(self, message_id: UUID, execution_context: Optional[Dict[str, Any]] = None):
        """
        Update message to 'running' status with started_at timestamp.
        Call this before making LLM calls.
        """
        try:
            db.execute_write(
                """
                UPDATE agent_messages
                SET
                    status = 'running',
                    started_at = NOW(),
                    execution_context = COALESCE(CAST(:execution_context AS jsonb), execution_context)
                WHERE message_id = :message_id
                """,
                {
                    "message_id": str(message_id),
                    "execution_context": json.dumps(execution_context) if execution_context else None,
                },
            )
            logger.debug("agent_message_running", message_id=str(message_id))
        except Exception as exc:
            logger.error("failed_to_update_agent_message_running",
                        message_id=str(message_id),
                        error=str(exc))

    def mark_completed(
        self,
        message_id: UUID,
        output_payload: Dict[str, Any],
        tokens_used: int = 0,
    ):
        """
        Update message to 'completed' status with completed_at timestamp.
        Call this after receiving LLM response.
        """
        try:
            db.execute_write(
                """
                UPDATE agent_messages
                SET
                    status = 'completed',
                    completed_at = NOW(),
                    output_payload = CAST(:output_payload AS jsonb),
                    tokens_used = :tokens_used,
                    completion_percentage = 100
                WHERE message_id = :message_id
                """,
                {
                    "message_id": str(message_id),
                    "output_payload": json.dumps(output_payload),
                    "tokens_used": tokens_used,
                },
            )
            logger.debug("agent_message_completed", message_id=str(message_id))
        except Exception as exc:
            logger.error("failed_to_update_agent_message_completed",
                        message_id=str(message_id),
                        error=str(exc))

    def mark_failed(
        self,
        message_id: UUID,
        error_message: str,
        error_details: Optional[Dict[str, Any]] = None,
    ):
        """
        Update message to 'failed' status with error information.
        Call this if summary generation fails.
        """
        try:
            db.execute_write(
                """
                UPDATE agent_messages
                SET
                    status = 'failed',
                    completed_at = NOW(),
                    error_message = :error_message,
                    error_details = CAST(:error_details AS jsonb)
                WHERE message_id = :message_id
                """,
                {
                    "message_id": str(message_id),
                    "error_message": error_message,
                    "error_details": json.dumps(error_details) if error_details else None,
                },
            )
            logger.debug("agent_message_failed",
                        message_id=str(message_id),
                        error=error_message)
        except Exception as exc:
            logger.error("failed_to_update_agent_message_failed",
                        message_id=str(message_id),
                        error=str(exc))


# This will be initialized in summaries.py to avoid circular imports
agent_message_tracker = None


def initialize_tracker(agent_registration):
    """Initialize the global tracker with agent registration."""
    global agent_message_tracker
    agent_message_tracker = AgentMessageTracker(agent_registration)


__all__ = ["AgentMessageTracker", "agent_message_tracker", "initialize_tracker"]
