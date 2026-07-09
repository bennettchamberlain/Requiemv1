"""
Recurrence profiler — week/month-horizon occurrence and due forecasts.

The 24h histogram (inference_engine) predicts *occupancy*: which L0/L1 class
fills each 30-min bucket.  That object dissolves at longer horizons — nobody
cares whether gym is 14:00 or 14:30 next Thursday.  The right objects are:

  week  →  *occurrence*:  P(cluster happens on day D), Bernoulli per day
  month →  *renewal*:     when is the cluster due again, given its
                          inter-arrival distribution and time-since-last

Both are derived from a per-(user, L1 cluster) statistical profile rebuilt
nightly from ``hbpe.token_stream``:

  • day-of-week occurrence counts        (the "when within a week")
  • daypart token counts                 (night/morning/afternoon/evening)
  • inter-arrival gaps in days           (the "how often")
  • periodicity_confidence ∈ [0,1]       (is this recurrent at all?)

Forecast math
-------------
Occurrence probability uses a discrete renewal process over the empirical gap
distribution.  The hazard ``h(g) = P(gap == g | gap >= g)`` (Laplace-smoothed)
drives a small dynamic program over "days since last occurrence", so that a
possible occurrence on Tuesday correctly *resets* the clock for Wednesday —
without this, frequent clusters get badly underestimated late in the week.
The renewal estimate is blended with the day-of-week base rate, weighted by
``periodicity_confidence``: clusters with regular intervals trust the hazard;
ad-hoc clusters fall back to "how often does this happen on a Tuesday".

Due predictions only make sense for clusters with periodic structure
(confidence >= DUE_CONFIDENCE_MIN): due_in = median gap − days since last,
credible window from the p25/p75 gap quantiles, overdue once the p90 is
exceeded — the "deviation flag" (you usually see friends weekly; it's been
16 days).

All dates are UTC calendar days, matching token_stream serialization; clients
localize at display per the platform timezone convention.

Implements CI-Server-ci4 (profiler) and the occurrence-actuals backfill half
of CI-Server-a9w.
"""
from __future__ import annotations

import datetime
import logging

import numpy as np
import psycopg2.extras

from ci.database import get_conn

log = logging.getLogger(__name__)

HISTORY_DAYS        = 180   # profile lookback window
MIN_INTERVALS_CONF  = 4     # intervals needed before confidence can exceed 0
MAX_INTERVALS_KEPT  = 64    # cap stored raw gaps (most recent kept)
HAZARD_ALPHA        = 0.5   # Laplace smoothing for the empirical hazard
DUE_CONFIDENCE_MIN  = 0.5   # clusters below this get no due prediction
FORECAST_P_FLOOR    = 0.01  # don't log/return occurrence probs below this
MODEL_VERSION       = "recurrence-v1"

BUCKETS_PER_DAY   = 48
BUCKETS_PER_PART  = 12      # 4 dayparts × 12 half-hour buckets
DAYPART_NAMES     = ("night", "morning", "afternoon", "evening")


# ── Profile building ───────────────────────────────────────────────────────────

# Distinct occurrence days (with their dayparts) per L1 cluster, restricted to
# clusters that still exist in hbpe.l1_clusters — summary-derived tokens can
# carry labels that were never promoted to clusters.
_OCCURRENCES_SQL = """
    SELECT ts.token_id::uuid AS cluster_id,
           ts.date,
           ARRAY_AGG(DISTINCT ts.bucket_idx / %(per_part)s) AS dayparts
    FROM hbpe.token_stream ts
    JOIN hbpe.l1_clusters c
      ON c.cluster_id::text = ts.token_id AND c.user_id = ts.user_id
    WHERE ts.user_id = %(user_id)s
      AND ts.level = 'L1'
      AND ts.date >= (NOW() AT TIME ZONE 'UTC')::date - %(history)s::int
    GROUP BY ts.token_id, ts.date
    ORDER BY ts.token_id, ts.date
"""

_UPSERT_PROFILE_SQL = """
    INSERT INTO hbpe.recurrence_profiles
        (user_id, l1_cluster_id, computed_at, history_days, n_occurrence_days,
         first_seen, last_seen, dow_counts, daypart_counts, intervals_days,
         interval_median, interval_p25, interval_p75, interval_p90,
         interval_mean, interval_std, periodicity_confidence)
    VALUES (%(user_id)s, %(cluster_id)s, NOW(), %(history)s, %(n_days)s,
            %(first_seen)s, %(last_seen)s, %(dow)s, %(daypart)s, %(gaps)s,
            %(median)s, %(p25)s, %(p75)s, %(p90)s, %(mean)s, %(std)s, %(conf)s)
    ON CONFLICT (user_id, l1_cluster_id) DO UPDATE SET
        computed_at            = EXCLUDED.computed_at,
        history_days           = EXCLUDED.history_days,
        n_occurrence_days      = EXCLUDED.n_occurrence_days,
        first_seen             = EXCLUDED.first_seen,
        last_seen              = EXCLUDED.last_seen,
        dow_counts             = EXCLUDED.dow_counts,
        daypart_counts         = EXCLUDED.daypart_counts,
        intervals_days         = EXCLUDED.intervals_days,
        interval_median        = EXCLUDED.interval_median,
        interval_p25           = EXCLUDED.interval_p25,
        interval_p75           = EXCLUDED.interval_p75,
        interval_p90           = EXCLUDED.interval_p90,
        interval_mean          = EXCLUDED.interval_mean,
        interval_std           = EXCLUDED.interval_std,
        periodicity_confidence = EXCLUDED.periodicity_confidence
"""


def _profile_stats(dates: list[datetime.date], daypart_lists: list[list[int]]) -> dict:
    """Compute the statistical fields of one cluster's profile row."""
    dow = [0] * 7
    daypart = [0] * 4
    for d, parts in zip(dates, daypart_lists):
        dow[d.weekday()] += 1
        for p in parts:
            if 0 <= p < 4:
                daypart[p] += 1

    gaps = [(b - a).days for a, b in zip(dates, dates[1:])]
    gaps = gaps[-MAX_INTERVALS_KEPT:]

    stats: dict = {
        "n_days": len(dates),
        "first_seen": dates[0],
        "last_seen": dates[-1],
        "dow": dow,
        "daypart": daypart,
        "gaps": gaps,
        "median": None, "p25": None, "p75": None, "p90": None,
        "mean": None, "std": None,
        "conf": 0.0,
    }
    if gaps:
        arr = np.asarray(gaps, dtype=np.float64)
        stats.update(
            median=float(np.median(arr)),
            p25=float(np.percentile(arr, 25)),
            p75=float(np.percentile(arr, 75)),
            p90=float(np.percentile(arr, 90)),
            mean=float(arr.mean()),
            std=float(arr.std()),
        )
        if len(gaps) >= MIN_INTERVALS_CONF and stats["mean"] > 0:
            # Regularity heuristic: 1 − coefficient of variation, shrunk toward 0
            # for small samples. CV≈0 (metronomic weekly habit) → ~1; bursty or
            # irregular (CV ≥ 1) → 0.
            cv = stats["std"] / stats["mean"]
            stats["conf"] = float(np.clip(1.0 - cv, 0.0, 1.0) * min(1.0, len(gaps) / 8.0))
    return stats


def build_recurrence_profiles(user_id: str, history_days: int = HISTORY_DAYS) -> dict:
    """
    Rebuild ``hbpe.recurrence_profiles`` for *user_id* from token_stream history.

    Upserts one row per L1 cluster observed in the window and deletes profiles
    for clusters no longer observed (or deactivated).  Idempotent.

    Returns ``{"user_id", "profiles", "periodic"}`` — total profiles written and
    how many have periodicity_confidence >= DUE_CONFIDENCE_MIN.
    """
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(_OCCURRENCES_SQL, {
                "user_id": user_id, "history": history_days,
                "per_part": BUCKETS_PER_PART,
            })
            rows = cur.fetchall()

    # Group by cluster (rows arrive ordered by cluster, date)
    by_cluster: dict[str, tuple[list, list]] = {}
    for cluster_id, date, dayparts in rows:
        dates, parts = by_cluster.setdefault(str(cluster_id), ([], []))
        dates.append(date)
        parts.append(list(dayparts or []))

    periodic = 0
    with get_conn() as conn:
        with conn.cursor() as cur:
            for cluster_id, (dates, parts) in by_cluster.items():
                s = _profile_stats(dates, parts)
                if s["conf"] >= DUE_CONFIDENCE_MIN:
                    periodic += 1
                cur.execute(_UPSERT_PROFILE_SQL, {
                    "user_id": user_id, "cluster_id": cluster_id,
                    "history": history_days, **s,
                })
            # Drop profiles for clusters that vanished from the window
            if by_cluster:
                cur.execute(
                    """DELETE FROM hbpe.recurrence_profiles
                       WHERE user_id = %s AND NOT (l1_cluster_id = ANY(%s::uuid[]))""",
                    (user_id, list(by_cluster.keys())),
                )
            else:
                cur.execute(
                    "DELETE FROM hbpe.recurrence_profiles WHERE user_id = %s",
                    (user_id,),
                )

    log.info("recurrence profiles user=%s written=%d periodic=%d",
             user_id[:8], len(by_cluster), periodic)
    return {"user_id": user_id, "profiles": len(by_cluster), "periodic": periodic}


# ── Forecasting ────────────────────────────────────────────────────────────────

_LOAD_PROFILES_SQL = """
    SELECT p.l1_cluster_id::text, c.display_name, c.l0_class,
           p.n_occurrence_days, p.first_seen, p.last_seen,
           p.dow_counts, p.daypart_counts, p.intervals_days,
           p.interval_median, p.interval_p25, p.interval_p75, p.interval_p90,
           p.periodicity_confidence
    FROM hbpe.recurrence_profiles p
    JOIN hbpe.l1_clusters c ON c.cluster_id = p.l1_cluster_id
    WHERE p.user_id = %s AND c.is_active
"""


def _load_profiles(user_id: str) -> list[dict]:
    with get_conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(_LOAD_PROFILES_SQL, (user_id,))
            return [dict(r) for r in cur.fetchall()]


def _hazard(gaps: list[int]) -> np.ndarray:
    """
    Smoothed discrete hazard h(g) = P(gap == g | gap >= g) for g in [1, G].

    Laplace smoothing (HAZARD_ALPHA) keeps the hazard defined for gaps never
    observed; the array is long enough that the DP can run past the largest
    observed gap without index errors.
    """
    G = max(gaps) * 2 + 7
    counts = np.zeros(G + 1)
    for g in gaps:
        counts[min(g, G)] += 1
    h = np.zeros(G + 1)
    for g in range(1, G + 1):
        at_risk = counts[g:].sum()
        h[g] = (counts[g] + HAZARD_ALPHA) / (at_risk + HAZARD_ALPHA * (G - g + 1))
    return h


def _renewal_probs(gaps: list[int], days_since_last: int, horizon: int) -> list[float]:
    """
    P(cluster occurs on each of the next *horizon* days) via a renewal DP.

    ``days_since_last`` is the gap an occurrence on the *first* forecast day
    would complete: (first_forecast_date - last_seen).days.

    State: distribution over "days since last occurrence" at the start of each
    forecast day.  An occurrence resets the state to 1 the following day, so a
    likely Tuesday occurrence correctly feeds Wednesday's probability.
    """
    h = _hazard(gaps)
    G = len(h) - 1
    dist = np.zeros(G + 1)
    dist[min(max(days_since_last, 1), G)] = 1.0

    probs: list[float] = []
    for _ in range(horizon):
        p_today = float((dist * h).sum())
        probs.append(p_today)
        nxt = np.zeros(G + 1)
        nxt[1] = p_today                       # occurred → clock resets
        survived = dist * (1.0 - h)            # didn't occur → gap grows
        nxt[2:] += survived[1:-1]
        nxt[G] += survived[G]                  # absorb at max gap
        dist = nxt
    return probs


def week_forecast(
    user_id: str,
    days: int = 7,
    start: datetime.date | None = None,
) -> list[dict]:
    """
    Per-day occurrence forecast for the next *days* days (default: starting
    tomorrow UTC — today is partially elapsed and already covered by /histogram).

    Returns one dict per day:
      {date, dow, clusters: [{cluster_id, name, l0_class, p_occur,
                              daypart_probs}, ...]}
    sorted by p_occur descending, probabilities below FORECAST_P_FLOOR dropped.
    """
    today = datetime.datetime.utcnow().date()
    start = start or (today + datetime.timedelta(days=1))
    profiles = _load_profiles(user_id)

    day_cluster_probs: list[list[dict]] = [[] for _ in range(days)]
    for p in profiles:
        gaps = list(p["intervals_days"] or [])
        if not gaps or p["n_occurrence_days"] < 2:
            continue
        conf = float(p["periodicity_confidence"] or 0.0)
        since = max((start - p["last_seen"]).days, 1)
        renewal = _renewal_probs(gaps, since, days)

        # Day-of-week base rate: occurrences on that DoW / weeks observed
        dow_counts = list(p["dow_counts"])
        span_days = max((p["last_seen"] - p["first_seen"]).days + 1, 7)
        weeks = max(span_days / 7.0, 1.0)
        dow_rate = [min(c / weeks, 1.0) for c in dow_counts]

        dp_counts = np.asarray(p["daypart_counts"], dtype=np.float64)
        dp_total = dp_counts.sum()
        daypart_probs = (
            {DAYPART_NAMES[i]: round(float(v / dp_total), 3)
             for i, v in enumerate(dp_counts) if v > 0}
            if dp_total > 0 else {}
        )

        for i in range(days):
            d = start + datetime.timedelta(days=i)
            p_occur = conf * renewal[i] + (1.0 - conf) * dow_rate[d.weekday()]
            p_occur = float(np.clip(p_occur, 0.0, 0.99))
            if p_occur >= FORECAST_P_FLOOR:
                day_cluster_probs[i].append({
                    "cluster_id":    p["l1_cluster_id"],
                    "name":          p["display_name"],
                    "l0_class":      p["l0_class"],
                    "p_occur":       round(p_occur, 4),
                    "daypart_probs": daypart_probs,
                })

    out = []
    for i in range(days):
        d = start + datetime.timedelta(days=i)
        out.append({
            "date":     d.isoformat(),
            "dow":      d.strftime("%A"),
            "clusters": sorted(day_cluster_probs[i],
                               key=lambda c: c["p_occur"], reverse=True),
        })
    return out


def due_list(user_id: str) -> list[dict]:
    """
    Renewal ("due") predictions for periodic clusters.

    Returns, for each cluster with periodicity_confidence >= DUE_CONFIDENCE_MIN
    and >= 3 observed intervals:
      {cluster_id, name, l0_class, last_seen, days_since_last,
       median_interval_days, due_in_days, window: [lo, hi], overdue, confidence}

    ``due_in_days`` may be negative (past the median but not yet past p90);
    ``overdue`` flips once days_since_last exceeds the p90 gap — the deviation
    signal ("you usually do this every ~7 days; it's been 16").
    Sorted: overdue first, then soonest due.
    """
    today = datetime.datetime.utcnow().date()
    out = []
    for p in _load_profiles(user_id):
        conf = float(p["periodicity_confidence"] or 0.0)
        gaps = list(p["intervals_days"] or [])
        if conf < DUE_CONFIDENCE_MIN or len(gaps) < 3:
            continue
        since = (today - p["last_seen"]).days
        median = float(p["interval_median"])
        out.append({
            "cluster_id":           p["l1_cluster_id"],
            "name":                 p["display_name"],
            "l0_class":             p["l0_class"],
            "last_seen":            p["last_seen"].isoformat(),
            "days_since_last":      since,
            "median_interval_days": median,
            "due_in_days":          round(median - since, 1),
            "window":               [round(float(p["interval_p25"]) - since, 1),
                                     round(float(p["interval_p75"]) - since, 1)],
            "overdue":              since > float(p["interval_p90"]),
            "confidence":           round(conf, 3),
        })
    return sorted(out, key=lambda r: (not r["overdue"], r["due_in_days"]))


# ── Occurrence forecast logging + actuals backfill ─────────────────────────────

_INSERT_OCCURRENCE_SQL = """
    INSERT INTO hbpe.occurrence_log
        (user_id, predicted_at, target_date, l1_cluster_id, p_occur, model_version)
    VALUES (%s, %s, %s, %s, %s, %s)
"""


def log_occurrence_forecast(
    user_id: str,
    forecast: list[dict],
    predicted_at: datetime.datetime,
) -> None:
    """
    Write an issued week forecast to hbpe.occurrence_log for retrospective
    Brier scoring.  Non-fatal, mirroring histogram_api._log_prediction.
    """
    rows = [
        (user_id, predicted_at, day["date"], c["cluster_id"],
         c["p_occur"], MODEL_VERSION)
        for day in forecast
        for c in day["clusters"]
    ]
    if not rows:
        return
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                psycopg2.extras.execute_batch(cur, _INSERT_OCCURRENCE_SQL, rows)
        log.debug("Logged %d occurrence forecasts for user=%s", len(rows), user_id[:8])
    except Exception:
        log.exception("occurrence_log write failed (non-fatal)")


# actual = TRUE/FALSE only when the elapsed day has *any* token_stream coverage —
# a day with no rows means "no data", not "didn't happen", and stays NULL.
_BACKFILL_OCCURRENCE_SQL = """
    UPDATE hbpe.occurrence_log o
    SET actual = EXISTS (
        SELECT 1 FROM hbpe.token_stream ts
        WHERE ts.user_id = o.user_id
          AND ts.date = o.target_date
          AND ts.level = 'L1'
          AND ts.token_id = o.l1_cluster_id::text
    )
    WHERE o.user_id = %(user_id)s
      AND o.actual IS NULL
      AND o.target_date < (NOW() AT TIME ZONE 'UTC')::date
      AND o.target_date >= (NOW() AT TIME ZONE 'UTC')::date - %(lookback)s::int
      AND EXISTS (
        SELECT 1 FROM hbpe.token_stream ts
        WHERE ts.user_id = o.user_id AND ts.date = o.target_date
      )
"""


def backfill_occurrence_actuals(user_id: str, lookback_days: int = 14) -> dict:
    """
    Fill hbpe.occurrence_log.actual for elapsed target days from observed
    token_stream L1 presence.  Idempotent (only touches NULL rows).
    """
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(_BACKFILL_OCCURRENCE_SQL,
                        {"user_id": user_id, "lookback": lookback_days})
            updated = cur.rowcount or 0
    log.info("occurrence actuals user=%s updated=%d", user_id[:8], updated)
    return {"user_id": user_id, "updated": updated}
