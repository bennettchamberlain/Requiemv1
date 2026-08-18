"""
L2 topic-head gate.

Serializer can already write ``level='L2'`` content tokens. The histogram keeps
``l2_probs: {}`` until a user clears ``L2_MIN_TOKENS``. Nightly logs the count.
Do not mint L2 from daily_metrics or the life graph.
"""

from __future__ import annotations

import logging

log = logging.getLogger(__name__)

L2_MIN_TOKENS = 50


def count_l2_tokens(user_id: str) -> int:
    from ci.hbpe.database import get_conn

    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT COUNT(*) FROM hbpe.token_stream
                    WHERE user_id = %s AND level = 'L2'
                    """,
                    (user_id,),
                )
                row = cur.fetchone()
        return int(row[0] or 0) if row else 0
    except Exception as exc:
        log.info("l2 token count skipped: %s", exc)
        return 0


def l2_head_enabled(user_id: str, min_tokens: int = L2_MIN_TOKENS) -> bool:
    n = count_l2_tokens(user_id)
    if n < min_tokens:
        log.info(
            "L2 head skipped for user=%s — %d tokens (need %d)",
            (user_id or "?")[:8],
            n,
            min_tokens,
        )
        return False
    return True
