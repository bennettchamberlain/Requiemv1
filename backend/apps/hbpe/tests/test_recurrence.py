"""
Unit tests for the recurrence profiler (ci.pipeline.recurrence).

Covers the pure math — profile statistics, smoothed hazard, renewal DP — and
the forecast/due formatting against monkeypatched profiles, without a live
Postgres. DB-backed integration of the upsert/backfill SQL is exercised in the
staging compose environment.
"""
from __future__ import annotations

import datetime
import sys
from pathlib import Path

import numpy as np

SRC = Path(__file__).resolve().parents[1] / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from ci.pipeline import recurrence as rec


def _dates(start: str, step_days: list[int]) -> list[datetime.date]:
    """Build a date sequence from a start date and successive gaps."""
    d = datetime.date.fromisoformat(start)
    out = [d]
    for g in step_days:
        d = d + datetime.timedelta(days=g)
        out.append(d)
    return out


# ── _profile_stats ─────────────────────────────────────────────────────────────


def test_profile_stats_weekly_habit_is_high_confidence():
    dates = _dates("2026-01-05", [7] * 10)         # every Monday, 11 occurrences
    s = rec._profile_stats(dates, [[1]] * len(dates))

    assert s["n_days"] == 11
    assert s["gaps"] == [7] * 10
    assert s["median"] == 7.0
    assert s["std"] == 0.0
    assert s["conf"] == 1.0                        # metronomic + enough samples
    assert s["dow"][0] == 11                       # all Mondays
    assert sum(s["dow"]) == 11
    assert s["daypart"] == [0, 11, 0, 0]           # all morning


def test_profile_stats_irregular_is_low_confidence():
    dates = _dates("2026-01-01", [1, 9, 2, 15, 1, 20])
    s = rec._profile_stats(dates, [[0]] * len(dates))
    assert 0.0 <= s["conf"] < 0.3                  # CV near/above 1


def test_profile_stats_too_few_intervals_gets_zero_confidence():
    dates = _dates("2026-01-01", [7, 7, 7])        # 3 intervals < MIN_INTERVALS_CONF
    s = rec._profile_stats(dates, [[2]] * len(dates))
    assert s["conf"] == 0.0
    assert s["median"] == 7.0                      # stats still computed


def test_profile_stats_single_day_has_no_intervals():
    s = rec._profile_stats([datetime.date(2026, 1, 1)], [[3]])
    assert s["gaps"] == []
    assert s["median"] is None
    assert s["conf"] == 0.0


# ── _hazard / _renewal_probs ───────────────────────────────────────────────────


def test_hazard_peaks_at_observed_gap():
    h = rec._hazard([7] * 20)
    assert h[7] > h[6] and h[7] > h[8]
    assert h[7] > 0.5
    assert np.all((h >= 0) & (h <= 1))


def test_renewal_probs_daily_cluster_stays_high_all_week():
    """The DP resets the clock on occurrence — without it, a daily habit's
    forecast would collapse to ~0 by mid-week."""
    probs = rec._renewal_probs([1] * 30, days_since_last=1, horizon=7)
    assert len(probs) == 7
    assert all(p > 0.6 for p in probs)


def test_renewal_probs_weekly_cluster_peaks_at_due_day():
    # An occurrence on the first forecast day would complete a gap of 7 —
    # exactly the habitual interval — so day index 0 is the peak.
    probs = rec._renewal_probs([7] * 20, days_since_last=7, horizon=7)
    assert probs[0] == max(probs)
    assert all(0.0 <= p <= 1.0 for p in probs)


# ── week_forecast / due_list ───────────────────────────────────────────────────


def _weekly_profile(**overrides) -> dict:
    p = {
        "l1_cluster_id": "c1",
        "display_name": "Gym Session",
        "l0_class": "EXERCISE",
        "n_occurrence_days": 11,
        "first_seen": datetime.date(2026, 1, 5),
        "last_seen": datetime.date(2026, 3, 16),
        "dow_counts": [11, 0, 0, 0, 0, 0, 0],
        "daypart_counts": [0, 11, 0, 0],
        "intervals_days": [7] * 10,
        "interval_median": 7.0,
        "interval_p25": 7.0,
        "interval_p75": 7.0,
        "interval_p90": 7.0,
        "periodicity_confidence": 1.0,
    }
    p.update(overrides)
    return p


def test_week_forecast_shape_and_sorting(monkeypatch):
    monkeypatch.setattr(rec, "_load_upcoming_events", lambda uid, h: [])
    monkeypatch.setattr(rec, "_load_profiles", lambda uid: [
        _weekly_profile(),
        _weekly_profile(l1_cluster_id="c2", display_name="Groceries",
                        l0_class="ERRAND", intervals_days=[3] * 10,
                        interval_median=3.0),
    ])
    start = datetime.date(2026, 3, 17)             # Tuesday after last_seen Monday
    days = rec.week_forecast("user", days=7, start=start)

    assert len(days) == 7
    assert days[0]["date"] == "2026-03-17"
    assert days[0]["dow"] == "Tuesday"
    for day in days:
        probs = [c["p_occur"] for c in day["clusters"]]
        assert probs == sorted(probs, reverse=True)
        assert all(rec.FORECAST_P_FLOOR <= p <= 0.99 for p in probs)

    # Weekly Monday habit should peak the following Monday (index 6)
    gym_by_day = [
        next((c["p_occur"] for c in d["clusters"] if c["cluster_id"] == "c1"), 0.0)
        for d in days
    ]
    assert gym_by_day[6] == max(gym_by_day)
    # Daypart tendencies survive into the response
    gym = next(c for c in days[6]["clusters"] if c["cluster_id"] == "c1")
    assert gym["daypart_probs"] == {"morning": 1.0}


def test_week_forecast_skips_single_occurrence_clusters(monkeypatch):
    monkeypatch.setattr(rec, "_load_upcoming_events", lambda uid, h: [])
    monkeypatch.setattr(rec, "_load_profiles", lambda uid: [
        _weekly_profile(n_occurrence_days=1, intervals_days=[]),
    ])
    days = rec.week_forecast("user", days=7, start=datetime.date(2026, 3, 17))
    assert all(d["clusters"] == [] for d in days)


def test_due_list_flags_overdue_and_sorts_first(monkeypatch):
    today = datetime.datetime.utcnow().date()
    fresh   = _weekly_profile(last_seen=today - datetime.timedelta(days=2))
    overdue = _weekly_profile(l1_cluster_id="c9", display_name="See Friends",
                              l0_class="SOCIAL",
                              last_seen=today - datetime.timedelta(days=16))
    low_conf = _weekly_profile(l1_cluster_id="c3", periodicity_confidence=0.1)
    monkeypatch.setattr(rec, "_load_upcoming_events", lambda uid, h: [])
    monkeypatch.setattr(rec, "_load_profiles",
                        lambda uid: [fresh, overdue, low_conf])

    due = rec.due_list("user")

    assert [r["cluster_id"] for r in due] == ["c9", "c1"]   # low-conf excluded
    assert due[0]["overdue"] is True
    assert due[0]["days_since_last"] == 16
    assert due[0]["due_in_days"] == 7.0 - 16
    assert due[0]["scheduled_date"] is None
    assert due[1]["overdue"] is False
    assert due[1]["due_in_days"] == 5.0
    assert due[1]["window"] == [5.0, 5.0]


# ── RRULE parse / expand / cadence (Layer 3) ────────────────────────────────────


def test_parse_recurrence_accepts_string_and_dict():
    assert rec.parse_recurrence("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE") == {
        "freq": "WEEKLY", "interval": 2, "byday": [0, 2]}
    assert rec.parse_recurrence("RRULE:FREQ=DAILY") == {
        "freq": "DAILY", "interval": 1, "byday": []}
    assert rec.parse_recurrence({"freq": "monthly", "interval": 1}) == {
        "freq": "MONTHLY", "interval": 1, "byday": []}


def test_parse_recurrence_rejects_junk():
    assert rec.parse_recurrence(None) is None
    assert rec.parse_recurrence("") is None
    assert rec.parse_recurrence("FREQ=HOURLY") is None
    assert rec.parse_recurrence({"nope": 1}) is None


def test_expand_occurrences_weekly_byday():
    rule = rec.parse_recurrence("FREQ=WEEKLY;BYDAY=TU")
    occ = rec.expand_occurrences(rule, datetime.date(2026, 1, 6),      # a Tuesday
                                 datetime.date(2026, 1, 5), datetime.date(2026, 1, 27))
    assert occ == [datetime.date(2026, 1, 6), datetime.date(2026, 1, 13),
                   datetime.date(2026, 1, 20), datetime.date(2026, 1, 27)]


def test_expand_occurrences_biweekly_skips_alternate_weeks():
    rule = rec.parse_recurrence("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO")
    occ = rec.expand_occurrences(rule, datetime.date(2026, 1, 5),      # a Monday
                                 datetime.date(2026, 1, 5), datetime.date(2026, 2, 2))
    assert occ == [datetime.date(2026, 1, 5), datetime.date(2026, 1, 19),
                   datetime.date(2026, 2, 2)]


def test_rrule_cadence_days():
    assert rec._rrule_cadence_days(rec.parse_recurrence("FREQ=WEEKLY")) == 7.0
    assert rec._rrule_cadence_days(rec.parse_recurrence("FREQ=MONTHLY")) == 30.0
    assert rec._rrule_cadence_days(rec.parse_recurrence("FREQ=WEEKLY;BYDAY=MO,WE,FR")) == round(7 / 3, 1)


# ── Reconciliation: due_list (Layer 1) + week_forecast (Layer 2) ────────────────


def _event(cluster_id, days_ahead, status="confirmed", **kw):
    st = datetime.datetime.utcnow() + datetime.timedelta(days=days_ahead)
    return {"cluster_id": cluster_id, "display_name": "X", "l0_class": "SOCIAL",
            "start_time": st, "status": status, "is_recurring": False,
            "recurrence_pattern": None, **kw}


def test_due_list_suppresses_overdue_when_booked(monkeypatch):
    today = datetime.datetime.utcnow().date()
    overdue = _weekly_profile(l1_cluster_id="c9", display_name="See Friends",
                              l0_class="SOCIAL",
                              last_seen=today - datetime.timedelta(days=16))
    monkeypatch.setattr(rec, "_load_profiles", lambda uid: [overdue])
    # A confirmed catch-up two days out: no longer "neglected".
    monkeypatch.setattr(rec, "_load_upcoming_events",
                        lambda uid, h: [_event("c9", 2)])

    due = rec.due_list("user")
    assert len(due) == 1
    assert due[0]["overdue"] is False
    assert due[0]["scheduled_date"] == (today + datetime.timedelta(days=2)).isoformat()


def test_due_list_cancelled_event_does_not_suppress(monkeypatch):
    # cancelled/no_show are filtered out at the SQL layer, so the loader returns
    # nothing and the overdue flag stands.
    today = datetime.datetime.utcnow().date()
    overdue = _weekly_profile(l1_cluster_id="c9",
                              last_seen=today - datetime.timedelta(days=16))
    monkeypatch.setattr(rec, "_load_profiles", lambda uid: [overdue])
    monkeypatch.setattr(rec, "_load_upcoming_events", lambda uid, h: [])

    due = rec.due_list("user")
    assert due[0]["overdue"] is True
    assert due[0]["scheduled_date"] is None


def test_due_list_seeds_from_calendar_recurrence(monkeypatch):
    # Only 2 statistical intervals (< 3, normally excluded) but a weekly RRULE.
    today = datetime.datetime.utcnow().date()
    thin = _weekly_profile(l1_cluster_id="c5", display_name="Team Standup",
                           l0_class="WORK", intervals_days=[7, 7],
                           periodicity_confidence=0.0,
                           last_seen=today - datetime.timedelta(days=3))
    monkeypatch.setattr(rec, "_load_profiles", lambda uid: [thin])
    monkeypatch.setattr(rec, "_load_upcoming_events", lambda uid, h: [
        {"cluster_id": "c5", "display_name": "Team Standup", "l0_class": "WORK",
         "start_time": datetime.datetime.utcnow() + datetime.timedelta(days=4),
         "status": "confirmed", "is_recurring": True,
         "recurrence_pattern": "FREQ=WEEKLY"},
    ])

    due = rec.due_list("user")
    assert len(due) == 1                       # seeded despite <3 intervals
    assert due[0]["median_interval_days"] == 7.0
    assert due[0]["scheduled_date"] is not None


def test_week_forecast_overlays_booked_event(monkeypatch):
    start = datetime.date(2026, 3, 17)
    monkeypatch.setattr(rec, "_load_profiles", lambda uid: [
        _weekly_profile(l1_cluster_id="c1", last_seen=datetime.date(2026, 3, 16)),
    ])
    # A confirmed event on day index 2 for a cluster with no profile at all.
    ev_dt = datetime.datetime(2026, 3, 19, 15, 0)
    monkeypatch.setattr(rec, "_load_upcoming_events", lambda uid, h: [
        {"cluster_id": "cX", "display_name": "Dentist", "l0_class": "ERRAND",
         "start_time": ev_dt, "status": "confirmed", "is_recurring": False,
         "recurrence_pattern": None},
    ])

    days = rec.week_forecast("user", days=7, start=start)
    dentist = next(c for c in days[2]["clusters"] if c["cluster_id"] == "cX")
    assert dentist["p_occur"] == 1.0
    assert dentist["scheduled"] is True
    # statistical cells remain flagged not-scheduled
    gym = next(c for c in days[0]["clusters"] if c["cluster_id"] == "c1")
    assert gym["scheduled"] is False
