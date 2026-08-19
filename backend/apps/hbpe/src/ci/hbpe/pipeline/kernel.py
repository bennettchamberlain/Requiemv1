"""
Inference-time kernel weights (paper §3.4, extended).

w = recency(λ=7) × dow_boost(2) × moy_boost × day_coverage_weight

Month-of-year boost shrinks to 1 until two distinct years of token history
exist. Metric *class* priors live in ``metric_lifts.py``; this module only
handles per-history-day scalar weights.
"""

from __future__ import annotations

import datetime

DECAY_LAMBDA = 7.0
DOW_BOOST = 2.0
MOY_BOOST = 1.5
MOY_MIN_YEARS = 2


def recency_weight(days_ago: int, lam: float = DECAY_LAMBDA) -> float:
    """``exp(-i / λ)``; ``days_ago=0`` is yesterday in the paper's window loop."""
    return float(__import__("math").exp(-days_ago / lam))


def dow_boost(hist_dow: int, forecast_dow: int, boost: float = DOW_BOOST) -> float:
    return boost if hist_dow == forecast_dow else 1.0


def moy_boost(
    hist_date: datetime.date,
    forecast_date: datetime.date,
    distinct_years: int,
    boost: float = MOY_BOOST,
    min_years: int = MOY_MIN_YEARS,
) -> float:
    """Same calendar month as the forecast, shrunk until ``min_years`` of history."""
    if distinct_years < min_years:
        return 1.0
    if hist_date.month != forecast_date.month:
        return 1.0
    shrink = min(1.0, distinct_years / 3.0)
    return 1.0 + shrink * (boost - 1.0)


def kernel_weight(
    days_ago: int,
    hist_date: datetime.date,
    forecast_date: datetime.date,
    distinct_years: int,
    day_coverage_weight: float = 1.0,
) -> float:
    return (
        recency_weight(days_ago)
        * dow_boost(hist_date.weekday(), forecast_date.weekday())
        * moy_boost(hist_date, forecast_date, distinct_years)
        * max(float(day_coverage_weight), 0.0)
    )
