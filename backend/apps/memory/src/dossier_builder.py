"""Utilities to synthesize a compact user dossier."""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any, Dict, Optional
from uuid import UUID

import structlog

from .config import settings
from .storage import storage
from .summarizer import summarizer

logger = structlog.get_logger()


class UserDossierBuilder:
    """Constructs dossier payloads from most recent daily summaries."""

    def __init__(self, lookback_days: int, max_chars: int):
        self._lookback_days = max(1, lookback_days)
        self._max_chars = max(512, max_chars)

    def build(
        self,
        user_id: UUID,
        period_end: datetime,
        timezone: str,
        *,
        lookback_override: Optional[int] = None,
        previous_dossier: Optional[Dict[str, Any]] = None,
    ) -> Optional[Dict[str, Any]]:
        lookback_days = max(1, lookback_override or self._lookback_days)
        window_end = period_end
        daily_window_start = window_end - timedelta(days=lookback_days)
        hourly_window_start = window_end - timedelta(days=1)

        daily_summaries = storage.get_daily_summaries(user_id, daily_window_start, window_end)
        hourly_summaries = storage.get_hourly_summaries(user_id, hourly_window_start, window_end)

        if not daily_summaries and not hourly_summaries:
            logger.info(
                "dossier_builder_skipped_no_summaries",
                user_id=str(user_id),
                window_start=daily_window_start.isoformat(),
                window_end=window_end.isoformat(),
            )
            return None

        context_payload = daily_summaries[-30:]
        dossier = summarizer.generate_user_dossier(
            user_id=str(user_id),
            lookback_start=daily_window_start,
            lookback_end=window_end,
            timezone=timezone,
            daily_summaries=context_payload,
            hourly_summaries=hourly_summaries[-24:],
            max_chars=self._max_chars,
            previous_dossier=previous_dossier,
        )

        if not dossier:
            return None

        dossier.setdefault("version", 1)
        dossier.setdefault("lastUpdatedAt", datetime.utcnow().isoformat())
        dossier.setdefault(
            "sourceWindow",
            {
                "start": daily_window_start.isoformat(),
                "end": window_end.isoformat(),
                "timezone": timezone,
            },
        )

        return dossier


dossier_builder = UserDossierBuilder(
    lookback_days=settings.dossier_lookback_days,
    max_chars=settings.dossier_max_chars,
)

__all__ = ["UserDossierBuilder", "dossier_builder"]
