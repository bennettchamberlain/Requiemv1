"""
Corpus access for walk-forward evaluation.

The existing baseline path (``pipeline/baselines.py``) can only score days that
were actually *served*: it reads actuals out of ``hbpe.prediction_log``, which
is written by ``histogram_api.build_histogram`` and backfilled by
``actuals_backfill``.  A forecaster that has never been deployed therefore has
nothing to score against, and history predating the first served forecast is
invisible.

This module derives both history and actuals from ``hbpe.token_stream``
instead — the same table ``occupancy_counts`` fits on — so every day in the
corpus becomes an evaluation day and a candidate forecaster can be measured
offline before it is ever wired to the API.

Bucket collision convention
───────────────────────────
When two L0 tokens land in the same bucket, the later row in iteration order
wins.  This is not obviously the *right* rule, but it is the rule
``occupancy_counts`` already applies when fitting B0/B1/B2
(``baselines.py``: ``by_day[day][b] = idx``).  Matching it matters more than
improving it: if the actuals used a different rule than the baselines were fit
under, every comparison in this harness would carry a constant, invisible bias.
"""

from __future__ import annotations

import datetime
from collections.abc import Sequence

from ci.hbpe.buckets import BUCKETS_PER_DAY
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


def corpus_dates(rows: Sequence[dict]) -> list[datetime.date]:
    """Every distinct calendar date present in the token stream, ascending."""
    return sorted({_as_date(r["date"]) for r in rows})


def history_before(rows: Sequence[dict], day: datetime.date) -> list[dict]:
    """
    Rows strictly before *day*.

    The walk-forward loop filters history here and hands the result to the
    forecaster, rather than passing the full corpus plus an ``until`` argument
    and trusting each forecaster to honour it.  A forecaster that ignores the
    cutoff then cannot leak, because it was never given the future rows.
    """
    return [r for r in rows if _as_date(r["date"]) < day]


def actuals_for_day(
    rows: Sequence[dict],
    day: datetime.date,
    n_buckets: int = BUCKETS_PER_DAY,
) -> dict[int, str]:
    """
    Observed L0 class per bucket on *day*, as ``{bucket_idx: class_name}``.

    Buckets with no token are absent — they are not scored.  Tokens outside the
    fixed L0 taxonomy (special tokens, stale cluster ids) are dropped, matching
    ``occupancy_counts``' ``CLASS_INDEX.get(token)`` guard.
    """
    out: dict[int, str] = {}
    for row in rows:
        if _as_date(row["date"]) != day:
            continue
        token = str(row.get("token_id") or "")
        if token not in _L0_SET:
            continue
        bucket = int(row["bucket_idx"])
        if bucket < 0 or bucket >= n_buckets:
            continue
        out[bucket] = token
    return out


def eval_dates(
    rows: Sequence[dict],
    *,
    min_history_days: int = 14,
    start: datetime.date | None = None,
    end: datetime.date | None = None,
    n_buckets: int = BUCKETS_PER_DAY,
) -> list[datetime.date]:
    """
    Days eligible to be scored.

    A day qualifies when at least *min_history_days* distinct earlier days exist
    in the corpus and the day itself carries at least one L0 actual.  History is
    counted in distinct observed days, not calendar span, so a gap in ingestion
    delays the first eval day instead of silently evaluating against an empty
    fit.
    """
    all_dates = corpus_dates(rows)
    out: list[datetime.date] = []
    for i, day in enumerate(all_dates):
        if i < min_history_days:
            continue
        if start is not None and day < start:
            continue
        if end is not None and day > end:
            continue
        if not actuals_for_day(rows, day, n_buckets):
            continue
        out.append(day)
    return out


def densify(
    rows: Sequence[dict],
    background: str = DEFAULT_BACKGROUND,
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
    """
    if background not in _L0_SET:
        raise ValueError(f"background {background!r} is not an L0 class")

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
            out.append({"date": day, "bucket_idx": bucket, "token_id": background})

    out.sort(key=lambda r: (_as_date(r["date"]), int(r["bucket_idx"])))
    return out
