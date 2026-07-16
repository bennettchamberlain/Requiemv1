"""
Unit tests for the Phase 5b forecast scoring loop (ci.pipeline.scoring).

Two layers:
  * Pure metric math (Brier / accuracy / ECE / drift) on hand-computed fixtures
    with known closed-form answers (perfect → Brier 0, uniform → 0.875,
    confidently wrong → 2.0, etc.).
  * The DB orchestration (score_and_store) against a fake psycopg2 connection —
    asserts the self-bootstrap DDL runs, coverage is derived from the count
    query, and the INSERT carries the computed metrics — without a live Postgres.

The 8 fixed L0 classes are
("WORK","EXERCISE","SOCIAL","ERRAND","LEISURE","TRANSIT","SLEEP","UNKNOWN").
"""
from __future__ import annotations

import contextlib
import datetime
import sys
import uuid
from pathlib import Path

import pytest

SRC = Path(__file__).resolve().parents[1] / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from ci.pipeline import scoring  # noqa: E402
from ci.pipeline.scoring import (  # noqa: E402
    argmax_class,
    detect_drift,
    l1_actual_keys,
    multiclass_brier,
    reliability_bins,
    score_predictions,
    top1_confidence,
    topk_keys,
)

WORK = "WORK"
LEISURE = "LEISURE"
UNIFORM = {c: 0.125 for c in scoring.L0_CLASSES}  # 8 classes → 1/8 each


def _row(l0_probs, actual_l0, l1_probs=None, actual_l1=None, actual_l1_label=None):
    return {
        "l0_probs": l0_probs,
        "l1_probs": l1_probs or {},
        "actual_l0": actual_l0,
        "actual_l1": actual_l1,
        "actual_l1_label": actual_l1_label,
    }


# ── Brier ────────────────────────────────────────────────────────────────────


def test_brier_perfect_is_zero():
    assert multiclass_brier({WORK: 1.0}, WORK) == 0.0


def test_brier_uniform_is_0875():
    # sum_c (p_c - y_c)^2 = (1/8 - 1)^2 + 7*(1/8)^2 = 49/64 + 7/64 = 56/64 = 0.875
    assert multiclass_brier(UNIFORM, LEISURE) == pytest.approx(0.875)


def test_brier_confidently_wrong_is_two():
    # all mass on the wrong class: (1-0)^2 predicted + (0-1)^2 actual = 2.0
    assert multiclass_brier({LEISURE: 1.0}, WORK) == pytest.approx(2.0)


def test_brier_missing_classes_treated_as_zero():
    # {WORK:0.7} vs actual WORK: (0.7-1)^2 + 0 (all other absent classes) = 0.09
    assert multiclass_brier({WORK: 0.7}, WORK) == pytest.approx(0.09)


# ── argmax / confidence / topk ───────────────────────────────────────────────


def test_argmax_picks_highest():
    assert argmax_class({WORK: 0.2, LEISURE: 0.8}) == LEISURE


def test_argmax_ties_break_by_class_order():
    # uniform → first class in the canonical order wins the tie
    assert argmax_class(UNIFORM) == scoring.L0_CLASSES[0]


def test_top1_confidence_is_max_prob():
    assert top1_confidence({WORK: 0.2, LEISURE: 0.8}) == pytest.approx(0.8)


def test_topk_keys_descending():
    probs = {"A": 0.5, "B": 0.3, "C": 0.15, "D": 0.05}
    assert topk_keys(probs, 3) == ["A", "B", "C"]


# ── ECE / reliability bins ───────────────────────────────────────────────────


def test_ece_perfect_calibration_is_zero():
    ece, bins = reliability_bins([1.0], [True])
    assert ece == pytest.approx(0.0)
    assert len(bins) == 10
    # conf 1.0 lands in the last bin
    assert bins[9]["count"] == 1
    assert bins[9]["accuracy"] == pytest.approx(1.0)


def test_ece_confident_and_wrong_is_one():
    ece, _ = reliability_bins([1.0], [False])
    assert ece == pytest.approx(1.0)


def test_ece_two_bins_weighted_gap():
    # 0.95→bin9 (acc 1.0, gap 0.05); 0.85→bin8 (acc 0.0, gap 0.85)
    # ECE = 0.5*0.05 + 0.5*0.85 = 0.45
    ece, bins = reliability_bins([0.95, 0.85], [True, False])
    assert ece == pytest.approx(0.45)
    assert bins[8]["count"] == 1
    assert bins[9]["count"] == 1


def test_ece_empty_returns_none_and_ten_bins():
    ece, bins = reliability_bins([], [])
    assert ece is None
    assert len(bins) == 10
    assert all(b["count"] == 0 for b in bins)
    assert all(b["avg_confidence"] is None for b in bins)


# ── score_predictions (aggregate) ────────────────────────────────────────────


def test_score_all_perfect():
    rows = [_row({WORK: 1.0}, WORK) for _ in range(5)]
    r = score_predictions(rows)
    assert r.n_l0 == 5
    assert r.brier == pytest.approx(0.0)
    assert r.l0_top1_acc == pytest.approx(1.0)
    assert r.ece == pytest.approx(0.0)


def test_score_uniform_predictions():
    # uniform predicting the wrong class every time
    rows = [_row(dict(UNIFORM), LEISURE) for _ in range(4)]
    r = score_predictions(rows)
    assert r.brier == pytest.approx(0.875)
    assert r.l0_top1_acc == pytest.approx(0.0)  # argmax = WORK != LEISURE
    # confidence 0.125 → bin 1, accuracy 0 → ECE = 0.125
    assert r.ece == pytest.approx(0.125)


def test_score_mixed_accuracy():
    rows = [
        _row({WORK: 0.9, LEISURE: 0.1}, WORK),      # correct
        _row({WORK: 0.9, LEISURE: 0.1}, WORK),      # correct
        _row({LEISURE: 0.9, WORK: 0.1}, WORK),      # wrong
        _row({LEISURE: 0.9, WORK: 0.1}, WORK),      # wrong
    ]
    r = score_predictions(rows)
    assert r.n_l0 == 4
    assert r.l0_top1_acc == pytest.approx(0.5)


def test_score_l1_top3():
    l1 = {"A": 0.5, "B": 0.3, "C": 0.15, "D": 0.05}
    rows = [
        _row({WORK: 1.0}, WORK, l1_probs=l1, actual_l1="C"),   # in top-3 → hit
        _row({WORK: 1.0}, WORK, l1_probs=l1, actual_l1="D"),   # not in top-3 → miss
        _row({WORK: 1.0}, WORK),                               # no L1 actual → ignored
    ]
    r = score_predictions(rows)
    assert r.n_l1 == 2
    assert r.l1_top3_acc == pytest.approx(0.5)


# ── L1 UUID → display-name translation ───────────────────────────────────────


CLUSTER_UUID = "3f2b1a9c-1111-2222-3333-444455556666"


def test_l1_actual_keys_translates_label_to_display_name():
    # engine keying: label.replace('_', ' ').title()
    keys = l1_actual_keys(CLUSTER_UUID, "DEEP_FOCUS")
    assert "Deep Focus" in keys
    # raw UUID + 8-char engine fallback stay as candidates
    assert CLUSTER_UUID in keys
    assert CLUSTER_UUID[:8] in keys


def test_l1_actual_keys_missing_cluster_row_falls_back_to_uuid():
    keys = l1_actual_keys(CLUSTER_UUID, None)
    assert keys == {CLUSTER_UUID, CLUSTER_UUID[:8]}


def test_l1_actual_keys_null_actual_is_empty():
    assert l1_actual_keys(None) == set()
    assert l1_actual_keys("") == set()


def test_score_l1_uuid_actual_matches_display_name_key():
    # actuals_backfill writes the cluster UUID; the fetch SQL carries the
    # cluster label; l1_probs is keyed by the titled display name.
    l1 = {"Deep Focus": 0.6, "Meeting": 0.3, "Cycling": 0.1}
    rows = [
        _row({WORK: 1.0}, WORK, l1_probs=l1,
             actual_l1=CLUSTER_UUID, actual_l1_label="DEEP_FOCUS"),
    ]
    r = score_predictions(rows)
    assert r.n_l1 == 1
    assert r.l1_top3_acc == pytest.approx(1.0)


def test_score_l1_uuid_actual_display_name_not_in_top3_is_miss():
    l1 = {"Deep Focus": 0.5, "Meeting": 0.3, "Cycling": 0.15, "Reading": 0.05}
    rows = [
        _row({WORK: 1.0}, WORK, l1_probs=l1,
             actual_l1=CLUSTER_UUID, actual_l1_label="READING"),
    ]
    r = score_predictions(rows)
    assert r.n_l1 == 1
    assert r.l1_top3_acc == pytest.approx(0.0)


def test_score_l1_missing_cluster_row_matches_engine_uuid_fallback():
    # When the engine can't resolve a display name it keys by uuid[:8]; a
    # deleted cluster row (label None from the LEFT JOIN) should still match.
    l1 = {CLUSTER_UUID[:8]: 0.9, "Meeting": 0.1}
    rows = [
        _row({WORK: 1.0}, WORK, l1_probs=l1,
             actual_l1=CLUSTER_UUID, actual_l1_label=None),
    ]
    r = score_predictions(rows)
    assert r.n_l1 == 1
    assert r.l1_top3_acc == pytest.approx(1.0)


def test_score_l1_null_actual_not_counted():
    rows = [
        _row({WORK: 1.0}, WORK, l1_probs={"Deep Focus": 1.0},
             actual_l1=None, actual_l1_label=None),
    ]
    r = score_predictions(rows)
    assert r.n_l1 == 0
    assert r.l1_top3_acc is None


def test_fetch_sql_joins_l1_clusters_for_label():
    # the UUID → display-name translation is driven by the fetch SQL's join
    assert "LEFT JOIN hbpe.l1_clusters" in scoring._FETCH_ROWS_SQL
    assert "actual_l1_label" in scoring._FETCH_ROWS_SQL


def test_score_empty_is_all_none():
    r = score_predictions([])
    assert r.n_l0 == 0
    assert r.brier is None
    assert r.l0_top1_acc is None
    assert r.l1_top3_acc is None
    assert r.ece is None


def test_score_skips_rows_without_actual():
    rows = [_row({WORK: 1.0}, None), _row({WORK: 1.0}, WORK)]
    r = score_predictions(rows)
    assert r.n_l0 == 1


def test_score_parses_json_string_probs():
    # a driver without the JSON typecaster hands back a string
    rows = [{"l0_probs": '{"WORK": 1.0}', "actual_l0": WORK, "l1_probs": "{}", "actual_l1": None}]
    r = score_predictions(rows)
    assert r.brier == pytest.approx(0.0)
    assert r.l0_top1_acc == pytest.approx(1.0)


# ── drift ────────────────────────────────────────────────────────────────────


def test_drift_flags_accuracy_drop():
    assert detect_drift(recent_acc=0.7, baseline_acc=0.9, recent_n=30, baseline_n=30) is True


def test_drift_ignores_small_drop():
    assert detect_drift(recent_acc=0.85, baseline_acc=0.9, recent_n=30, baseline_n=30) is False


def test_drift_guarded_by_min_samples():
    # big drop but too few recent samples → no alarm
    assert detect_drift(recent_acc=0.2, baseline_acc=0.9, recent_n=5, baseline_n=30) is False


def test_drift_none_baseline_is_false():
    assert detect_drift(recent_acc=0.5, baseline_acc=None, recent_n=30, baseline_n=0) is False


# ── DB orchestration (score_and_store) ───────────────────────────────────────


class _FakeCursor:
    """Routes execute() by SQL content and replays canned results.

    Returns two prediction_log row batches in order (main window, then trailing
    baseline window); a coverage tuple; and an INSERT ... RETURNING result.
    """

    _DESC = [("l0_probs",), ("l1_probs",), ("actual_l0",), ("actual_l1",), ("actual_l1_label",)]

    def __init__(self, row_batches, coverage):
        self._row_batches = list(row_batches)
        self._coverage = coverage
        self.description = None
        self.executed = []
        self.insert_params = None
        self._last = None

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql, params=None):
        self.executed.append((sql, params))
        if "CREATE TABLE IF NOT EXISTS hbpe.prediction_score" in sql:
            self._last = "ddl"
        elif "INSERT INTO hbpe.prediction_score" in sql:
            self._last = "insert"
            self.insert_params = params
        elif "COUNT(*)" in sql:
            self._last = "coverage"
        elif "SELECT p.l0_probs" in sql:
            self._last = "rows"
            self.description = self._DESC
        else:
            self._last = "other"

    def fetchall(self):
        return self._row_batches.pop(0) if self._row_batches else []

    def fetchone(self):
        if self._last == "coverage":
            return self._coverage
        if self._last == "insert":
            return (uuid.uuid4(), datetime.datetime.now(datetime.timezone.utc))
        return None


class _FakeConn:
    def __init__(self, cursor):
        self._cursor = cursor

    def cursor(self):
        return self._cursor


def _patch_conn(monkeypatch, cursor):
    @contextlib.contextmanager
    def fake_get_conn():
        yield _FakeConn(cursor)

    monkeypatch.setattr(scoring, "get_conn", fake_get_conn)


def _correct_row():
    return ({WORK: 0.9, LEISURE: 0.1}, {}, WORK, None, None)


def _wrong_row():
    return ({LEISURE: 0.9, WORK: 0.1}, {}, WORK, None, None)


def test_score_and_store_persists_metrics(monkeypatch):
    main = [_correct_row() for _ in range(25)]      # acc 1.0
    baseline = [_correct_row() for _ in range(25)]  # acc 1.0 → no drift
    cur = _FakeCursor(row_batches=[main, baseline], coverage=(30, 25))
    _patch_conn(monkeypatch, cur)

    out = scoring.score_and_store("user-1")

    assert out["status"] == "scored"
    assert out["n_buckets"] == 25
    assert out["brier"] == pytest.approx(0.02)            # (0.9-1)^2 + (0.1)^2
    assert out["l0_top1_acc"] == pytest.approx(1.0)
    assert out["coverage"] == pytest.approx(25 / 30, abs=1e-4)
    assert out["drift_flag"] is False

    # self-bootstrap DDL ran, and the INSERT carried the computed metrics
    assert any("CREATE TABLE IF NOT EXISTS hbpe.prediction_score" in s for s, _ in cur.executed)
    assert cur.insert_params["n_buckets"] == 25
    assert cur.insert_params["l0_top1_acc"] == pytest.approx(1.0)
    assert cur.insert_params["drift_flag"] is False
    # reliability_json is serialized JSON of the 10-bin table
    assert '"bin": 9' in cur.insert_params["reliability_json"]


def test_score_and_store_detects_drift(monkeypatch):
    main = [_wrong_row() for _ in range(25)]        # recent acc 0.0
    baseline = [_correct_row() for _ in range(25)]  # baseline acc 1.0
    cur = _FakeCursor(row_batches=[main, baseline], coverage=(25, 25))
    _patch_conn(monkeypatch, cur)

    out = scoring.score_and_store("user-2")

    assert out["l0_top1_acc"] == pytest.approx(0.0)
    assert out["baseline_top1_acc"] == pytest.approx(1.0)
    assert out["drift_flag"] is True
    assert cur.insert_params["drift_flag"] is True


def test_score_and_store_skips_when_no_actuals(monkeypatch):
    cur = _FakeCursor(row_batches=[[]], coverage=(10, 0))
    _patch_conn(monkeypatch, cur)

    out = scoring.score_and_store("user-3")

    assert out["status"] == "skipped"
    assert out["reason"] == "no_scored_buckets"
    assert out["coverage"] == pytest.approx(0.0)
    # nothing was inserted
    assert cur.insert_params is None
    assert not any("INSERT INTO hbpe.prediction_score" in s for s, _ in cur.executed)
