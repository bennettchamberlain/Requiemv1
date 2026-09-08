"""
The daily rhythm the user typed into onboarding, as a densification prior.

``corpus.densify`` fills unobserved buckets with a single filler class, which
made 97.5% of a densified corpus one meaningless label. But the user has
already *told* us what most of that time is. The FTUE's "Time and place" step
(``frontend/apps/web/src/pages/OnboardingPage/TimeAndPlaceStep.tsx``) asks when
they usually wake, go to bed, and start and end work, and stores the answers on
the self-entity:

    ci.entities.properties->'schedule'
        {"wake_time": "09:00", "sleep_time": "02:00",
         "work_start": "10:00", "work_end": "18:00", "source": "onboarding"}

Nothing under ``ci.hbpe`` reads it. For a corpus whose SLEEP class has zero
support while the user sleeps seven hours a night, that is the cheapest real
signal available: the sleep window alone accounts for ~29% of the day here and
is currently labelled "nothing recorded".

This is a *declared* rhythm, not an observed one. It is a prior over
unobserved buckets and nothing more: an actual token always wins, so a night
spent working still reads as WORK. Treating it as ground truth would be
fabricating observations. Treating it as a default is what the user was asked
for.

The work window is deliberately **not** applied. Work is the class the corpus
already observes densely through the calendar, so defaulting to it would
manufacture agreement between the prior and the labels it is being scored
against, which is the same circularity ``schedule.py`` warns about. Sleep is
the class nothing else supplies.
"""

from __future__ import annotations

import datetime

from ci.hbpe.buckets import BUCKET_MINUTES, BUCKETS_PER_DAY

_PROFILE_SQL = """
    SELECT properties -> 'schedule'
    FROM ci.entities
    WHERE owner_user_id = %s
      AND is_self IS TRUE
      AND properties -> 'schedule' IS NOT NULL
    LIMIT 1
"""


def fetch_rhythm(user_id: str) -> dict | None:
    """The self-entity's declared schedule, or None when onboarding skipped it."""
    from ci.hbpe.database import get_conn

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(_PROFILE_SQL, (user_id,))
            row = cur.fetchone()
    return row[0] if row and row[0] else None


def _bucket_of(clock: str) -> int | None:
    """``"09:15"`` → bucket index. None when unparseable."""
    try:
        parsed = datetime.time.fromisoformat(clock.strip())
    except (AttributeError, ValueError):
        return None
    return (parsed.hour * 60 + parsed.minute) // BUCKET_MINUTES


def sleep_buckets(rhythm: dict | None, n_buckets: int = BUCKETS_PER_DAY) -> set[int]:
    """
    Bucket indices covered by the declared sleep window, ``[sleep, wake)``.

    Wraps midnight when bedtime is later in the clock than wake time, which is
    the common case (22:00 → 07:00). It does not wrap when it need not: this
    user's 02:00 → 09:00 is a single contiguous run inside one day.

    An empty set when the window is missing, unparseable, or degenerate, so a
    caller can fall back to a flat filler without special-casing.
    """
    if not rhythm:
        return set()
    start = _bucket_of(str(rhythm.get("sleep_time") or ""))
    end = _bucket_of(str(rhythm.get("wake_time") or ""))
    if start is None or end is None or start == end:
        return set()
    if start < end:
        return set(range(start, end))
    return set(range(start, n_buckets)) | set(range(0, end))


def background_by_bucket(
    rhythm: dict | None,
    filler: str,
    n_buckets: int = BUCKETS_PER_DAY,
) -> list[str]:
    """Per-bucket default class: SLEEP inside the declared window, else *filler*."""
    asleep = sleep_buckets(rhythm, n_buckets)
    return ["SLEEP" if b in asleep else filler for b in range(n_buckets)]
