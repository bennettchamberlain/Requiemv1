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
from collections.abc import Sequence

from ci.hbpe.buckets import BUCKET_MINUTES, BUCKETS_PER_DAY
from ci.hbpe.pipeline.baselines import _as_date
from ci.hbpe.tokenizer.vocab_registry import L0_CLASSES

_L0_SET = frozenset(L0_CLASSES)

# Default filler for ``densify``. The L0 taxonomy has no "nothing recorded"
# member, and adding one would change N_CLASSES and every array shape scoring
# depends on, so the densified corpus borrows UNKNOWN. That is a proxy, not a
# synonym: UNKNOWN already means "the labeler could not tell from the title",
# and after densifying it also means "no event covered this bucket". The two
# are indistinguishable afterwards, so UNKNOWN's per-class recall is not
# interpretable on a densified run. Every other class stays clean.
DEFAULT_BACKGROUND = "UNKNOWN"

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


def densify(
    rows: Sequence[dict],
    background: str | Sequence[str] = DEFAULT_BACKGROUND,
    n_buckets: int = BUCKETS_PER_DAY,
) -> list[dict]:
    """
    Give every bucket of every observed day a label, filling gaps with
    *background*.

    The sparse corpus asks "given that something was recorded here, which class
    was it?" — only observed buckets carry a target, so on a corpus at 2.6%
    occupancy a forecaster is fit and scored on a handful of points per day and
    is never asked what happens during the other 97%. That is not the question
    a next-day forecast has to answer.

    Densifying asks "what is happening in this bucket?" for all
    ``n_buckets`` of them, which is the deployable question, and takes the
    corpus from hundreds of labelled points to tens of thousands.

    Only days already present in *rows* are filled. A day absent from the token
    stream stays absent rather than becoming a fabricated day of background:
    ingestion gaps are not evidence that nothing happened.

    The filler is applied to history and actuals alike, because they are the
    same rows. Densifying actuals alone would score every forecaster against a
    class none of them had ever been fit on.

    *background* is either one class for every bucket, or a per-bucket sequence
    of length *n_buckets*. The sequence form is how a declared daily rhythm
    enters the corpus — see ``rhythm.background_by_bucket``, which marks the
    user's stated sleep window SLEEP and leaves the rest flat. An observed
    token always beats the filler, so a night actually spent working still
    reads WORK.
    """
    if isinstance(background, str):
        per_bucket = [background] * n_buckets
    else:
        per_bucket = list(background)
        if len(per_bucket) != n_buckets:
            raise ValueError(
                f"background has {len(per_bucket)} entries, expected {n_buckets}"
            )
    unknown = sorted({c for c in per_bucket if c not in _L0_SET})
    if unknown:
        raise ValueError(f"background {unknown[0]!r} is not an L0 class")

    seen: dict[datetime.date, set[int]] = {}
    out: list[dict] = []
    for row in rows:
        day = _as_date(row["date"])
        seen.setdefault(day, set())
        out.append(row)
        token = str(row.get("token_id") or "")
        if token not in _L0_SET:
            continue
        bucket = int(row["bucket_idx"])
        if 0 <= bucket < n_buckets:
            seen[day].add(bucket)

    for day, occupied in seen.items():
        for bucket in range(n_buckets):
            if bucket in occupied:
                continue
            out.append(
                {"date": day, "bucket_idx": bucket, "token_id": per_bucket[bucket]}
            )

    out.sort(key=lambda r: (_as_date(r["date"]), int(r["bucket_idx"])))
    return out
