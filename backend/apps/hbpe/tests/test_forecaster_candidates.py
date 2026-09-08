"""Densification, shrinkage, balanced transitions, and the macro-recall metric."""

from __future__ import annotations

import datetime

import numpy as np
import pytest

from ci.hbpe.evaluation.corpus import densify
from ci.hbpe.evaluation.forecaster import CLASS_INDEX, N_CLASSES, DayFit
from ci.hbpe.evaluation.report import macro_recall
from ci.hbpe.evaluation.shrinkage import (
    ShrinkageForecaster,
    balanced_transitions,
    shrunk_emissions,
    weighted_counts,
)

DAY = datetime.date(2026, 3, 2)  # a Monday
N_BUCKETS = 8


def _row(day: datetime.date, bucket: int, token: str) -> dict:
    return {"date": day, "bucket_idx": bucket, "token_id": token}


# ── densify ───────────────────────────────────────────────────────────────────


def test_densify_fills_every_bucket_of_an_observed_day():
    rows = densify([_row(DAY, 3, "WORK")], "UNKNOWN", N_BUCKETS)
    assert len(rows) == N_BUCKETS
    by_bucket = {r["bucket_idx"]: r["token_id"] for r in rows}
    assert by_bucket[3] == "WORK"
    assert all(by_bucket[b] == "UNKNOWN" for b in range(N_BUCKETS) if b != 3)


def test_densify_leaves_unobserved_days_absent():
    """A gap in ingestion is not evidence that nothing happened."""
    rows = densify(
        [_row(DAY, 0, "WORK"), _row(DAY + datetime.timedelta(days=3), 0, "WORK")],
        "UNKNOWN",
        N_BUCKETS,
    )
    assert {r["date"] for r in rows} == {DAY, DAY + datetime.timedelta(days=3)}


def test_densify_rejects_a_background_outside_the_taxonomy():
    with pytest.raises(ValueError, match="not an L0 class"):
        densify([_row(DAY, 0, "WORK")], "IDLE", N_BUCKETS)


def test_densify_is_idempotent():
    once = densify([_row(DAY, 3, "WORK")], "UNKNOWN", N_BUCKETS)
    assert densify(once, "UNKNOWN", N_BUCKETS) == once


# ── recency weighting ─────────────────────────────────────────────────────────


def test_recent_days_outweigh_old_ones():
    target = DAY + datetime.timedelta(days=30)
    history = [
        _row(DAY, 0, "WORK"),
        _row(DAY + datetime.timedelta(days=28), 0, "SOCIAL"),
    ]
    b0, _, _ = weighted_counts(history, target, n_buckets=N_BUCKETS, half_life_days=7.0)
    assert b0[0, CLASS_INDEX["SOCIAL"]] > b0[0, CLASS_INDEX["WORK"]]


def test_half_life_is_what_it_says():
    target = DAY + datetime.timedelta(days=7)
    b0, _, _ = weighted_counts(
        [_row(DAY, 0, "WORK")], target, n_buckets=N_BUCKETS, half_life_days=7.0
    )
    assert b0[0, CLASS_INDEX["WORK"]] == pytest.approx(0.5, abs=1e-9)


# ── shrinkage ─────────────────────────────────────────────────────────────────


def test_thin_cell_inherits_from_its_parent_not_from_uniform():
    """
    The whole point of shrinking to the parent. One WORK observation in a
    bucket whose other weekdays are all SOCIAL should still favour SOCIAL over
    the six classes nothing was ever seen in.
    """
    b0 = np.zeros((N_BUCKETS, N_CLASSES))
    b1 = np.zeros((N_BUCKETS, 7, N_CLASSES))
    social, work = CLASS_INDEX["SOCIAL"], CLASS_INDEX["WORK"]
    b0[0, social] = 40.0
    b1[0, 1, social] = 40.0  # Tuesdays
    b0[0, work] = 1.0
    b1[0, 0, work] = 1.0  # the single Monday

    probs = shrunk_emissions(b0, b1, dow=0, k=4.0)[0]
    assert probs[social] > probs[CLASS_INDEX["LEISURE"]]
    assert probs.sum() == pytest.approx(1.0)


def test_a_well_observed_cell_is_barely_moved():
    b0 = np.zeros((N_BUCKETS, N_CLASSES))
    b1 = np.zeros((N_BUCKETS, 7, N_CLASSES))
    work = CLASS_INDEX["WORK"]
    b0[0, work] = 200.0
    b1[0, 0, work] = 200.0
    assert shrunk_emissions(b0, b1, dow=0, k=4.0)[0, work] > 0.95


def test_shrunk_emissions_are_distributions():
    rng = np.random.default_rng(0)
    b0 = rng.integers(0, 5, size=(N_BUCKETS, N_CLASSES)).astype(float)
    b1 = rng.integers(0, 3, size=(N_BUCKETS, 7, N_CLASSES)).astype(float)
    out = shrunk_emissions(b0, b1, dow=3, k=4.0)
    assert np.allclose(out.sum(axis=1), 1.0)
    assert (out > 0).all()


# ── transitions ───────────────────────────────────────────────────────────────


def test_balanced_transitions_do_not_force_the_diagonal():
    """
    A daypart where WORK always hands over to SOCIAL. Flat Laplace would put
    the largest off-diagonal mass on the diagonal for the unseen rows; shrinking
    toward the destination marginal keeps them pointed at SOCIAL.
    """
    counts = np.zeros((4, N_CLASSES, N_CLASSES))
    work, social = CLASS_INDEX["WORK"], CLASS_INDEX["SOCIAL"]
    counts[0, work, social] = 50.0

    tr = balanced_transitions(counts, k=8.0)
    assert np.allclose(tr.sum(axis=2), 1.0)
    unseen = tr[0, CLASS_INDEX["ERRAND"]]
    assert unseen[social] > unseen[CLASS_INDEX["ERRAND"]]


def test_balanced_transitions_reject_the_wrong_shape():
    with pytest.raises(ValueError, match=r"expected \(P, C, C\)"):
        balanced_transitions(np.zeros((N_CLASSES, N_CLASSES)))


# ── forecaster contract ───────────────────────────────────────────────────────


def test_shrinkage_forecaster_returns_a_valid_simplex():
    history = [
        _row(DAY - datetime.timedelta(days=d), b, "WORK")
        for d in range(1, 15)
        for b in range(3)
    ]
    fit = DayFit.build(history, n_buckets=N_BUCKETS)
    out = ShrinkageForecaster().forecast(history, DAY, fit)
    assert out.shape == (N_BUCKETS, N_CLASSES)
    assert np.isfinite(out).all()
    assert np.allclose(out.sum(axis=1), 1.0)


# ── macro recall ──────────────────────────────────────────────────────────────


class _Score:
    def __init__(self, per_class):
        self.per_class = per_class


def test_macro_recall_ignores_zero_support_classes():
    score = _Score(
        {
            "WORK": {"support": 10, "recall": 0.5},
            "SOCIAL": {"support": 10, "recall": 1.0},
            "SLEEP": {"support": 0, "recall": None},
        }
    )
    assert macro_recall(score) == pytest.approx(0.75)


def test_macro_recall_excludes_the_densification_filler():
    score = _Score(
        {
            "WORK": {"support": 10, "recall": 0.5},
            "UNKNOWN": {"support": 9000, "recall": 1.0},
        }
    )
    assert macro_recall(score, exclude="UNKNOWN") == pytest.approx(0.5)


def test_macro_recall_punishes_majority_class_collapse():
    """The number top-1 and Brier both fail to report on a skewed corpus."""
    collapsed = _Score(
        {
            "UNKNOWN": {"support": 9000, "recall": 1.0},
            "WORK": {"support": 50, "recall": 0.0},
            "SOCIAL": {"support": 20, "recall": 0.0},
        }
    )
    assert macro_recall(collapsed, exclude="UNKNOWN") == pytest.approx(0.0)
