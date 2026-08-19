"""
P0 baselines against live ``prediction_log`` actuals.

B0  per-bucket Laplace occupancy (mode = argmax)
B1  per-(bucket, day-of-week) occupancy
B2  daypart Markov: one-step from B1[t-1] through the daypart transition matrix

All three emit an 8-class probability vector so they can be scored with the
same Brier / top-1 / ECE path as the served histogram. Per-class recall is
attached so SLEEP/WORK cannot hide in the average.

Walk-forward: occupancy is counted on token_stream dates strictly before the
forecast's ``horizon_start`` date.
"""

from __future__ import annotations

import datetime
import logging
from collections import defaultdict
from collections.abc import Sequence
from typing import Any

import numpy as np

from ci.hbpe.buckets import BUCKETS_PER_DAY
from ci.hbpe.pipeline.hmm import LAPLACE, N_DAYPARTS, daypart_of, laplace_transitions
from ci.hbpe.pipeline.scoring import ScoreResult, score_predictions
from ci.hbpe.pipeline.serve import MODEL_B0, MODEL_B1, MODEL_B2
from ci.hbpe.tokenizer.vocab_registry import L0_CLASSES

log = logging.getLogger(__name__)

N_CLASSES = len(L0_CLASSES)
CLASS_INDEX = {c: i for i, c in enumerate(L0_CLASSES)}


def _as_date(value: Any) -> datetime.date:
    if isinstance(value, datetime.datetime):
        return value.date()
    if isinstance(value, datetime.date):
        return value
    return datetime.date.fromisoformat(str(value)[:10])


def occupancy_counts(
    rows: Sequence[dict],
    until: datetime.date | None = None,
    n_buckets: int = BUCKETS_PER_DAY,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """
    Returns
    -------
    b0 : (n_buckets, C)
    b1 : (n_buckets, 7, C)
    transitions : (n_dayparts, C, C)  from→to consecutive buckets on the same day
    """
    b0 = np.zeros((n_buckets, N_CLASSES), dtype=np.float64)
    b1 = np.zeros((n_buckets, 7, N_CLASSES), dtype=np.float64)
    trans = np.zeros((N_DAYPARTS, N_CLASSES, N_CLASSES), dtype=np.float64)

    by_day: dict[datetime.date, dict[int, int]] = defaultdict(dict)
    for row in rows:
        day = _as_date(row["date"])
        if until is not None and day >= until:
            continue
        token = str(row.get("token_id") or "")
        idx = CLASS_INDEX.get(token)
        if idx is None:
            continue
        b = int(row["bucket_idx"])
        if b < 0 or b >= n_buckets:
            continue
        b0[b, idx] += 1
        b1[b, day.weekday(), idx] += 1
        by_day[day][b] = idx

    for _day, buckets in by_day.items():
        prev_b, prev_c = None, None
        for b in sorted(buckets):
            c = buckets[b]
            if prev_b is not None and b == prev_b + 1:
                trans[daypart_of(b, n_buckets), prev_c, c] += 1
            prev_b, prev_c = b, c

    return b0, b1, trans


def _laplace_row(counts: np.ndarray) -> np.ndarray:
    c = np.asarray(counts, dtype=np.float64) + LAPLACE
    return c / c.sum()


def b0_probs(b0_counts: np.ndarray, bucket: int) -> dict[str, float]:
    p = _laplace_row(b0_counts[bucket])
    return {cls: float(p[i]) for i, cls in enumerate(L0_CLASSES)}


def b1_probs(b1_counts: np.ndarray, bucket: int, dow: int) -> dict[str, float]:
    p = _laplace_row(b1_counts[bucket, dow])
    return {cls: float(p[i]) for i, cls in enumerate(L0_CLASSES)}


def b2_day_emissions(
    b1_counts: np.ndarray,
    transitions: np.ndarray,
    dow: int,
    n_buckets: int = BUCKETS_PER_DAY,
) -> np.ndarray:
    """One-step Markov: B2[0]=B1[0]; B2[t] = T[daypart(t)]^T wait — from→to @ B1[t-1]."""
    tr = laplace_transitions(transitions)
    out = np.zeros((n_buckets, N_CLASSES), dtype=np.float64)
    out[0] = _laplace_row(b1_counts[0, dow])
    for t in range(1, n_buckets):
        prev = _laplace_row(b1_counts[t - 1, dow])
        out[t] = prev @ tr[daypart_of(t, n_buckets)]
        s = out[t].sum()
        if s > 0:
            out[t] /= s
        else:
            out[t] = np.ones(N_CLASSES) / N_CLASSES
    return out


def fetch_occupancy_rows(user_id: str) -> list[dict]:
    from ci.hbpe.database import get_conn

    sql = """
        SELECT date, bucket_idx, token_id
        FROM hbpe.token_stream
        WHERE user_id = %s AND level = 'L0'
        ORDER BY date, bucket_idx
    """
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, (user_id,))
            cols = [d[0] for d in cur.description]
            rows = [dict(zip(cols, r, strict=True)) for r in cur.fetchall()]
    for row in rows:
        row["date"] = _as_date(row["date"])
    return rows


def fetch_actual_rows(
    user_id: str, start: datetime.datetime, end: datetime.datetime
) -> list[dict]:
    """Backfilled log rows with horizon + bucket so baselines can emit a vector."""
    from ci.hbpe.database import get_conn

    sql = """
        SELECT horizon_start, bucket_index, actual_l0, actual_l1
        FROM hbpe.prediction_log
        WHERE user_id = %s
          AND predicted_at >= %s
          AND predicted_at <  %s
          AND actual_l0 IS NOT NULL
    """
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, (user_id, start, end))
            cols = [d[0] for d in cur.description]
            return [dict(zip(cols, r, strict=True)) for r in cur.fetchall()]


def emit_for_actuals(
    occupancy: Sequence[dict],
    actuals: Sequence[dict],
    n_buckets: int = BUCKETS_PER_DAY,
) -> dict[str, list[dict]]:
    """Build scored-row dicts for B0/B1/B2 against the same actuals."""
    by_until: dict[datetime.date, list[dict]] = defaultdict(list)
    for row in actuals:
        horizon = row.get("horizon_start")
        if horizon is None:
            continue
        by_until[_as_date(horizon)].append(row)

    out: dict[str, list[dict]] = {MODEL_B0: [], MODEL_B1: [], MODEL_B2: []}
    for until, group in by_until.items():
        b0, b1, trans = occupancy_counts(occupancy, until=until, n_buckets=n_buckets)
        b2_by_dow: dict[int, np.ndarray] = {}
        for row in group:
            b = int(row["bucket_index"])
            if b < 0 or b >= n_buckets:
                continue
            dow = _as_date(row["horizon_start"]).weekday()
            if dow not in b2_by_dow:
                b2_by_dow[dow] = b2_day_emissions(b1, trans, dow, n_buckets)
            actual = {
                "actual_l0": row["actual_l0"],
                "actual_l1": row.get("actual_l1"),
                "l1_probs": {},
            }
            out[MODEL_B0].append({**actual, "l0_probs": b0_probs(b0, b)})
            out[MODEL_B1].append({**actual, "l0_probs": b1_probs(b1, b, dow)})
            p = b2_by_dow[dow][b]
            out[MODEL_B2].append(
                {
                    **actual,
                    "l0_probs": {cls: float(p[i]) for i, cls in enumerate(L0_CLASSES)},
                }
            )
    return out


def score_baseline_rows(rows: list[dict]) -> tuple[ScoreResult, dict]:
    result = score_predictions(rows)
    return result, result.per_class


def count_history_days(occupancy: Sequence[dict]) -> int:
    return len({_as_date(r["date"]) for r in occupancy})


def score_baselines_and_store(
    user_id: str,
    window_start: datetime.datetime | None = None,
    window_end: datetime.datetime | None = None,
    window_days: int = 14,
) -> dict:
    """Fit B0/B1/B2 walk-forward against the same actuals as ``score_and_store``."""
    from ci.hbpe.database import get_conn
    from ci.hbpe.pipeline.scoring import (
        DEFAULT_WINDOW_DAYS,
        ensure_score_table,
        insert_score_row,
    )

    days = window_days or DEFAULT_WINDOW_DAYS
    end = window_end or datetime.datetime.now(datetime.UTC)
    start = window_start or (end - datetime.timedelta(days=days))

    try:
        occupancy = fetch_occupancy_rows(user_id)
        actuals = fetch_actual_rows(user_id, start, end)
    except Exception as exc:
        log.info("baseline occupancy/actuals skipped: %s", exc)
        return {"status": "skipped", "reason": str(exc)}

    if not actuals:
        return {"status": "skipped", "reason": "no_scored_buckets"}

    emitted = emit_for_actuals(occupancy, actuals)
    coverage = 1.0
    out: dict = {
        "status": "scored",
        "models": {},
        "history_days": count_history_days(occupancy),
    }

    with get_conn() as conn:
        ensure_score_table(conn)
        for version, rows in emitted.items():
            if not rows:
                continue
            result, recall = score_baseline_rows(rows)
            insert_score_row(
                conn,
                user_id=user_id,
                window_start=start,
                window_end=end,
                result=result,
                coverage=coverage,
                drift_flag=False,
                model_version=version,
            )
            out["models"][version] = {
                **result.as_dict(),
                "per_class": recall,
            }
            log.info(
                "baseline %s user=%s n=%d top1=%s brier=%s ece=%s",
                version,
                (user_id or "?")[:8],
                result.n_l0,
                result.l0_top1_acc,
                result.brier,
                result.ece,
            )
    return out
