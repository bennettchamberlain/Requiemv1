"""
Forecast scoring — Phase 5b (live forecast-vs-actual accuracy loop).

The histogram endpoint logs every issued 48-bucket forecast to
``hbpe.prediction_log`` and the Phase 5a backfill (``actuals_backfill.py``) later
fills ``actual_l0/l1/l2`` once each forecast window has elapsed.  Until now
nothing turned those (prediction, actual) pairs into an accuracy number — the
``drift_detection`` nightly step was a stub and ``model/evaluator.py`` only scores
an *offline* leave-one-out split, never the live predictions the user actually
saw.

This module closes that loop.  Over a window of ``prediction_log`` rows that have
been backfilled (``actual_l0 IS NOT NULL``) it computes:

  * **Brier score** — multiclass Brier over the 8 fixed L0 classes, comparing the
    logged per-bucket L0 probability distribution against the one-hot actual.
    Range ``[0, 2]``; 0 is perfect, a uniform distribution scores ``0.875``, a
    confidently-wrong point mass scores ``2.0``.
  * **L0 top-1 accuracy** — fraction of buckets whose argmax L0 class matched the
    actual.
  * **L1 top-3 accuracy** — fraction of buckets whose actual L1 label was among
    the 3 highest-probability L1 keys (only over buckets that have an L1 actual).
  * **ECE + reliability bins** — expected calibration error over ``n_bins`` (10)
    equal-width confidence bins, using the L0 top-1 probability as the
    confidence and L0 top-1 correctness as the outcome.  The per-bin table is a
    reliability-diagram data structure persisted as JSON.
  * **Coverage** — fraction of buckets in the window that carry an actual (i.e.
    have been backfilled), the same signal the §6 success metric tracks.
  * **Drift** — a rolling-window signal: L0 top-1 accuracy over the scored window
    vs. an equal-length *trailing baseline* window immediately before it.  Flags
    True when the recent accuracy has dropped more than ``DRIFT_THRESHOLD`` below
    baseline (both windows must clear ``DRIFT_MIN_SAMPLES``).

Results are persisted to ``hbpe.prediction_score`` (one row per scoring run).

Schema note
-----------
``hbpe.prediction_score`` is created canonically by the dbmate migration
``backend/apps/api/db/postgres/migrations/20260817190000_hbpe_prediction_score.sql``
(the other ``hbpe.*`` tables live in ``20260227000001_hbpe_all_tables.sql``).
This module keeps an idempotent ``CREATE TABLE IF NOT EXISTS`` self-bootstrap
(``ensure_score_table``) as belt-and-braces for installs that run the sidecar
before the migration; after the migration has run it is a no-op.  The two DDLs
must stay in sync.  Follow-up: add the ``ci.users(id)`` FK once the
self-bootstrap is retired (the sidecar DDL cannot assume the ``ci`` schema).

L1 keying note
--------------
``prediction_log.actual_l1`` is backfilled as the L1 *cluster UUID*
(``actuals_backfill.py``), whereas ``inference_engine.predict`` writes
``l1_probs`` keyed by the cluster's *display name* — derived in Python as
``label.replace('_', ' ').title()`` from ``hbpe.l1_clusters.label`` (the
``display_name`` column was dropped in migration ``20260413000003``), falling
back to the UUID's first 8 chars when the cluster row cannot be resolved.  The
fetch SQL therefore LEFT JOINs ``hbpe.l1_clusters`` to carry the actual's
``label`` alongside the UUID, and ``l1_actual_keys`` translates the actual into
the same display-name keying before the top-3 comparison (raw UUID and 8-char
prefix are kept as fallback candidates for clusters with no surviving row).
L0 metrics are unaffected by any of this.

Spec: CI-HBPE-SPEC-001 §T5 (scoring / drift).
"""

from __future__ import annotations

import datetime
import json
import logging
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from typing import Any

from ci.hbpe.database import get_conn
from ci.hbpe.tokenizer.vocab_registry import L0_CLASSES

log = logging.getLogger(__name__)

# ── Tunables ────────────────────────────────────────────────────────────────────

# Default scoring window: reconsider forecasts issued in the last N days.  Rows
# are only scored once their actuals have been backfilled, so this comfortably
# covers the 14-day backfill lookback.
DEFAULT_WINDOW_DAYS = 14

# Reliability / ECE bin count.
DEFAULT_N_BINS = 10

# Drift: how far recent L0 top-1 accuracy must fall below the trailing baseline
# before we flag drift, and the minimum scored buckets each window needs for the
# comparison to be trusted.
DRIFT_THRESHOLD = 0.10
DRIFT_MIN_SAMPLES = 20


# ── Pure scoring core (no DB — unit-tested directly) ────────────────────────────


def _as_prob_dict(value: Any) -> dict[str, float]:
    """Coerce a JSONB probability column to a ``{label: float}`` dict.

    psycopg2 auto-parses JSONB to a Python dict, but be defensive: some paths
    (or a driver without the JSON typecaster) hand back a JSON string, and a
    NULL ``l2_probs`` comes back as None.
    """
    if value is None:
        return {}
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except (ValueError, TypeError):
            return {}
    if isinstance(value, dict):
        return {str(k): float(v) for k, v in value.items()}
    return {}


def multiclass_brier(
    l0_probs: dict[str, float],
    actual_l0: str,
    classes: Sequence[str] = L0_CLASSES,
) -> float:
    """Single-bucket multiclass Brier score (sum of squared errors over classes).

    ``sum_c (p_c - y_c)^2`` where ``y`` is the one-hot of ``actual_l0``.  Missing
    classes in ``l0_probs`` are treated as probability 0.  Range ``[0, 2]``.
    """
    total = 0.0
    for c in classes:
        p = float(l0_probs.get(c, 0.0))
        y = 1.0 if c == actual_l0 else 0.0
        total += (p - y) ** 2
    return total


def argmax_class(
    l0_probs: dict[str, float],
    classes: Sequence[str] = L0_CLASSES,
) -> str | None:
    """Return the highest-probability class (ties broken by ``classes`` order)."""
    best: str | None = None
    best_p = float("-inf")
    for c in classes:
        p = float(l0_probs.get(c, 0.0))
        if p > best_p:
            best_p = p
            best = c
    return best


def top1_confidence(
    l0_probs: dict[str, float],
    classes: Sequence[str] = L0_CLASSES,
) -> float:
    """Max probability across the known classes (the top-1 confidence)."""
    return max((float(l0_probs.get(c, 0.0)) for c in classes), default=0.0)


def topk_keys(probs: dict[str, float], k: int = 3) -> list[str]:
    """Keys of the ``k`` highest-probability entries (descending)."""
    return [
        key for key, _ in sorted(probs.items(), key=lambda kv: kv[1], reverse=True)[:k]
    ]


def l1_actual_keys(
    actual_l1: str | None, actual_l1_label: str | None = None
) -> set[str]:
    """Candidate ``l1_probs`` keys the backfilled L1 actual may appear under.

    ``actual_l1`` is the raw cluster UUID (see ``actuals_backfill.py``), but
    ``inference_engine.predict`` keys ``l1_probs`` by the cluster's display
    name: ``hbpe.l1_clusters.label`` transformed as
    ``label.replace('_', ' ').title()`` — falling back to the UUID's first
    8 chars when the engine cannot resolve a name.  Translate the actual into
    that keying (plus the raw-UUID / 8-char fallbacks, which cannot
    false-positive against another cluster's keys) so top-3 membership is
    compared display-name vs display-name.
    """
    if not actual_l1:
        return set()
    keys = {actual_l1, actual_l1[:8]}
    if actual_l1_label:
        keys.add(actual_l1_label.replace("_", " ").title())
    return keys


def reliability_bins(
    confidences: Sequence[float],
    correct: Sequence[bool],
    n_bins: int = DEFAULT_N_BINS,
) -> tuple[float | None, list[dict]]:
    """Expected Calibration Error and the reliability-diagram bin table.

    Buckets are assigned to one of ``n_bins`` equal-width confidence bins
    (``bin = min(n_bins-1, floor(conf * n_bins))`` so ``conf == 1.0`` lands in the
    last bin).  For each bin we report ``avg_confidence`` and observed
    ``accuracy``; the empty bins are still emitted (count 0, null stats) so the
    diagram has a fixed 10-row shape.  ECE is the sample-weighted mean gap
    ``sum_b (n_b / N) * |acc_b - conf_b|``.

    Returns ``(ece, bins)``; ``ece`` is ``None`` when there are no samples.
    """
    n = len(confidences)
    edges = [i / n_bins for i in range(n_bins + 1)]
    conf_sum = [0.0] * n_bins
    corr_sum = [0] * n_bins
    count = [0] * n_bins

    for conf, is_correct in zip(confidences, correct, strict=True):
        c = min(max(float(conf), 0.0), 1.0)
        b = min(n_bins - 1, int(c * n_bins))
        conf_sum[b] += c
        corr_sum[b] += 1 if is_correct else 0
        count[b] += 1

    bins: list[dict] = []
    ece = 0.0
    for b in range(n_bins):
        nb = count[b]
        if nb:
            avg_conf = conf_sum[b] / nb
            acc = corr_sum[b] / nb
            ece += (nb / n) * abs(acc - avg_conf)
        else:
            avg_conf = None
            acc = None
        bins.append(
            {
                "bin": b,
                "lower": round(edges[b], 4),
                "upper": round(edges[b + 1], 4),
                "count": nb,
                "avg_confidence": round(avg_conf, 6) if avg_conf is not None else None,
                "accuracy": round(acc, 6) if acc is not None else None,
            }
        )

    return (ece if n else None), bins


@dataclass
class ScoreResult:
    """Scored metrics for a set of backfilled ``prediction_log`` rows."""

    n_l0: int = 0
    n_l1: int = 0
    brier: float | None = None
    l0_top1_acc: float | None = None
    l1_top3_acc: float | None = None
    ece: float | None = None
    reliability: list[dict] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            "n_l0": self.n_l0,
            "n_l1": self.n_l1,
            "brier": self.brier,
            "l0_top1_acc": self.l0_top1_acc,
            "l1_top3_acc": self.l1_top3_acc,
            "ece": self.ece,
            "reliability": self.reliability,
        }


def score_predictions(
    rows: Iterable[dict],
    n_bins: int = DEFAULT_N_BINS,
    classes: Sequence[str] = L0_CLASSES,
) -> ScoreResult:
    """Score an iterable of backfilled prediction rows.

    Each row must provide ``l0_probs`` (dict or JSON), ``actual_l0`` (class name),
    and optionally ``l1_probs`` + ``actual_l1`` (cluster UUID) +
    ``actual_l1_label`` (the cluster's ``hbpe.l1_clusters.label``, carried by the
    fetch SQL's LEFT JOIN; may be absent/None when the cluster row is gone).  The
    L1 actual is translated to the engine's display-name keying via
    ``l1_actual_keys`` before the top-3 comparison.  Rows with no ``actual_l0``
    are skipped defensively (the caller's query already filters them).
    """
    brier_sum = 0.0
    top1_correct = 0
    n_l0 = 0
    confidences: list[float] = []
    correct_flags: list[bool] = []

    l1_total = 0
    l1_correct = 0

    for row in rows:
        actual_l0 = row.get("actual_l0")
        if not actual_l0:
            continue
        l0_probs = _as_prob_dict(row.get("l0_probs"))
        n_l0 += 1

        brier_sum += multiclass_brier(l0_probs, actual_l0, classes)

        pred = argmax_class(l0_probs, classes)
        is_correct = pred == actual_l0
        top1_correct += 1 if is_correct else 0

        confidences.append(top1_confidence(l0_probs, classes))
        correct_flags.append(is_correct)

        actual_l1 = row.get("actual_l1")
        if actual_l1:
            l1_total += 1
            l1_probs = _as_prob_dict(row.get("l1_probs"))
            candidates = l1_actual_keys(actual_l1, row.get("actual_l1_label"))
            if candidates & set(topk_keys(l1_probs, 3)):
                l1_correct += 1

    ece, bins = reliability_bins(confidences, correct_flags, n_bins)

    return ScoreResult(
        n_l0=n_l0,
        n_l1=l1_total,
        brier=(brier_sum / n_l0) if n_l0 else None,
        l0_top1_acc=(top1_correct / n_l0) if n_l0 else None,
        l1_top3_acc=(l1_correct / l1_total) if l1_total else None,
        ece=ece,
        reliability=bins,
    )


def detect_drift(
    recent_acc: float | None,
    baseline_acc: float | None,
    recent_n: int,
    baseline_n: int,
    threshold: float = DRIFT_THRESHOLD,
    min_samples: int = DRIFT_MIN_SAMPLES,
) -> bool:
    """True when recent accuracy dropped ``> threshold`` below the baseline.

    Guarded by ``min_samples`` on both windows so a thin/empty baseline never
    trips a false alarm.
    """
    if recent_acc is None or baseline_acc is None:
        return False
    if recent_n < min_samples or baseline_n < min_samples:
        return False
    return (baseline_acc - recent_acc) > threshold


# ── DB layer ────────────────────────────────────────────────────────────────────

# Canonical DDL lives in the dbmate migration
# ``backend/apps/api/db/postgres/migrations/20260817190000_hbpe_prediction_score.sql``;
# this copy is an idempotent belt-and-braces bootstrap (a no-op once the
# migration has run) for installs where the sidecar starts first.  Keep the two
# in sync — the migration mirrors this SQL exactly.
_ENSURE_TABLE_SQL = """
    CREATE SCHEMA IF NOT EXISTS hbpe;

    CREATE TABLE IF NOT EXISTS hbpe.prediction_score (
        id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id          UUID NOT NULL,
        scored_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        window_start     TIMESTAMPTZ NOT NULL,
        window_end       TIMESTAMPTZ NOT NULL,
        brier            DOUBLE PRECISION,
        l0_top1_acc      DOUBLE PRECISION,
        l1_top3_acc      DOUBLE PRECISION,
        ece              DOUBLE PRECISION,
        coverage         DOUBLE PRECISION,
        reliability_json JSONB,
        drift_flag       BOOLEAN NOT NULL DEFAULT FALSE,
        n_buckets        INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS prediction_score_user_scored_idx
        ON hbpe.prediction_score (user_id, scored_at DESC);
"""

# actual_l1 is a cluster UUID while l1_probs is keyed by display name, so carry
# the cluster's label along (LEFT JOIN — the row may have been deleted) for the
# display-name translation in ``l1_actual_keys``.  Text-cast join: actual_l1 is
# TEXT and not guaranteed to parse as a UUID.
_FETCH_ROWS_SQL = """
    SELECT p.l0_probs, p.l1_probs, p.actual_l0, p.actual_l1,
           c.label AS actual_l1_label
    FROM hbpe.prediction_log p
    LEFT JOIN hbpe.l1_clusters c
      ON c.cluster_id::text = p.actual_l1
    WHERE p.user_id = %(user_id)s
      AND p.predicted_at >= %(start)s
      AND p.predicted_at <  %(end)s
      AND p.actual_l0 IS NOT NULL
"""

_COVERAGE_SQL = """
    SELECT
        COUNT(*)                                       AS total,
        COUNT(*) FILTER (WHERE actual_l0 IS NOT NULL)  AS filled
    FROM hbpe.prediction_log
    WHERE user_id = %(user_id)s
      AND predicted_at >= %(start)s
      AND predicted_at <  %(end)s
"""

_INSERT_SCORE_SQL = """
    INSERT INTO hbpe.prediction_score
        (user_id, window_start, window_end, brier, l0_top1_acc, l1_top3_acc,
         ece, coverage, reliability_json, drift_flag, n_buckets)
    VALUES
        (%(user_id)s, %(window_start)s, %(window_end)s, %(brier)s, %(l0_top1_acc)s,
         %(l1_top3_acc)s, %(ece)s, %(coverage)s, %(reliability_json)s::jsonb,
         %(drift_flag)s, %(n_buckets)s)
    RETURNING id, scored_at
"""


def ensure_score_table(conn) -> None:
    """Idempotently create ``hbpe.prediction_score`` (belt-and-braces bootstrap).

    The dbmate migration ``20260817190000_hbpe_prediction_score.sql`` is the
    canonical DDL; on a migrated database every statement here is a no-op.
    """
    with conn.cursor() as cur:
        cur.execute(_ENSURE_TABLE_SQL)


def _fetch_scored_rows(conn, user_id: str, start, end) -> list[dict]:
    with conn.cursor() as cur:
        cur.execute(_FETCH_ROWS_SQL, {"user_id": user_id, "start": start, "end": end})
        cols = [d[0] for d in cur.description]
        return [dict(zip(cols, r, strict=True)) for r in cur.fetchall()]


def _fetch_coverage(conn, user_id: str, start, end) -> tuple[int, int]:
    with conn.cursor() as cur:
        cur.execute(_COVERAGE_SQL, {"user_id": user_id, "start": start, "end": end})
        total, filled = cur.fetchone()
    return int(total or 0), int(filled or 0)


def score_and_store(
    user_id: str,
    window_start: datetime.datetime | None = None,
    window_end: datetime.datetime | None = None,
    window_days: int = DEFAULT_WINDOW_DAYS,
    n_bins: int = DEFAULT_N_BINS,
) -> dict:
    """Score the user's elapsed forecasts, detect drift, and persist one row.

    Args:
        user_id:      User UUID string.
        window_start: Start of the scoring window (``predicted_at`` lower bound,
                      inclusive).  Defaults to ``window_end - window_days``.
        window_end:   End of the window (exclusive).  Defaults to now (UTC).
        window_days:  Width of the default window in days.
        n_bins:       Reliability/ECE bin count.

    Returns:
        The persisted metrics as a dict, including ``drift_flag`` and ``coverage``.
        When the window has no backfilled buckets, returns a ``skipped`` result
        and writes nothing.
    """
    end = window_end or datetime.datetime.now(datetime.UTC)
    start = window_start or (end - datetime.timedelta(days=window_days))
    window = end - start
    base_start = start - window  # equal-length trailing baseline window
    base_end = start

    with get_conn() as conn:
        ensure_score_table(conn)

        rows = _fetch_scored_rows(conn, user_id, start, end)
        total, filled = _fetch_coverage(conn, user_id, start, end)

        result = score_predictions(rows, n_bins=n_bins)

        if result.n_l0 == 0:
            log.info(
                "scoring user=%s window=[%s,%s) — no backfilled buckets, skipping",
                (user_id or "?")[:8],
                start.isoformat(),
                end.isoformat(),
            )
            return {
                "user_id": user_id,
                "status": "skipped",
                "reason": "no_scored_buckets",
                "window_start": start.isoformat(),
                "window_end": end.isoformat(),
                "coverage": round(filled / total, 4) if total else 0.0,
            }

        # Trailing-baseline accuracy for the drift comparison.
        base_rows = _fetch_scored_rows(conn, user_id, base_start, base_end)
        base_result = score_predictions(base_rows, n_bins=n_bins)
        drift_flag = detect_drift(
            recent_acc=result.l0_top1_acc,
            baseline_acc=base_result.l0_top1_acc,
            recent_n=result.n_l0,
            baseline_n=base_result.n_l0,
        )

        coverage = (filled / total) if total else 0.0
        reliability_json = json.dumps(result.reliability)

        with conn.cursor() as cur:
            cur.execute(
                _INSERT_SCORE_SQL,
                {
                    "user_id": user_id,
                    "window_start": start,
                    "window_end": end,
                    "brier": result.brier,
                    "l0_top1_acc": result.l0_top1_acc,
                    "l1_top3_acc": result.l1_top3_acc,
                    "ece": result.ece,
                    "coverage": coverage,
                    "reliability_json": reliability_json,
                    "drift_flag": drift_flag,
                    "n_buckets": result.n_l0,
                },
            )
            score_id, scored_at = cur.fetchone()

    out = {
        "user_id": user_id,
        "status": "scored",
        "score_id": str(score_id),
        "scored_at": scored_at.isoformat() if scored_at else None,
        "window_start": start.isoformat(),
        "window_end": end.isoformat(),
        "n_buckets": result.n_l0,
        "n_l1": result.n_l1,
        "brier": round(result.brier, 6) if result.brier is not None else None,
        "l0_top1_acc": round(result.l0_top1_acc, 6)
        if result.l0_top1_acc is not None
        else None,
        "l1_top3_acc": round(result.l1_top3_acc, 6)
        if result.l1_top3_acc is not None
        else None,
        "ece": round(result.ece, 6) if result.ece is not None else None,
        "coverage": round(coverage, 4),
        "drift_flag": drift_flag,
        "baseline_top1_acc": (
            round(base_result.l0_top1_acc, 6)
            if base_result.l0_top1_acc is not None
            else None
        ),
        "baseline_n": base_result.n_l0,
    }

    log.info(
        "scoring user=%s n=%d brier=%.4f l0_top1=%.3f ece=%.4f coverage=%.3f drift=%s",
        (user_id or "?")[:8],
        result.n_l0,
        result.brier or 0.0,
        result.l0_top1_acc or 0.0,
        result.ece or 0.0,
        coverage,
        drift_flag,
    )
    if drift_flag:
        log.warning(
            "forecast drift for user=%s: recent L0 top-1 %.3f vs baseline %.3f "
            "(delta=%.3f > %.2f threshold)",
            (user_id or "?")[:8],
            result.l0_top1_acc or 0.0,
            base_result.l0_top1_acc or 0.0,
            (base_result.l0_top1_acc or 0.0) - (result.l0_top1_acc or 0.0),
            DRIFT_THRESHOLD,
        )

    return out
