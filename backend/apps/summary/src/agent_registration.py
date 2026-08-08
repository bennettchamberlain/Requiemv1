"""
Summary-worker lifecycle hooks.

Historically registered into the `agents` / `agent_messages` tables. Those
tables are dropped (schema consolidation); registration is now a local UUID
for log correlation only.
"""
import uuid
from typing import Optional

import structlog

from .config import settings

logger = structlog.get_logger()


class AgentRegistration:
    """In-process identity for the summary worker. No database writes."""

    def __init__(self):
        self.agent_id: Optional[uuid.UUID] = None

    def register(self) -> uuid.UUID:
        if self.agent_id is None:
            self.agent_id = uuid.uuid4()
        logger.info(
            "agent_registered_local",
            agent_id=str(self.agent_id),
            agent_name=settings.agent_name,
            version=getattr(settings, "agent_version", None),
        )
        return self.agent_id

    def deregister(self):
        if self.agent_id:
            logger.info("agent_deregistered_local", agent_id=str(self.agent_id))
            self.agent_id = None

    def update_metrics(self, success: bool, execution_time_ms: int):
        if not self.agent_id:
            return
        logger.debug(
            "agent_metrics_local",
            agent_id=str(self.agent_id),
            success=success,
            execution_time_ms=execution_time_ms,
        )


agent_registration = AgentRegistration()
