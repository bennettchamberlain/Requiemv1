"""
A supervised head over per-bucket features.

B0, B1 and B2 are contingency tables: each conditions on a fixed key and can
only sharpen a cell by observing that exact cell again. Nothing lets them share
strength between 09:00 and 09:15, or notice that yesterday predicts today
independently of which weekday it was, or use anything outside the token stream.

This fits a multinomial logistic regression over features that carry those
relationships explicitly, refit from scratch on each eval day's history:

    cyclical bucket-of-day at three harmonics   6
    day-of-week one-hot                         7
    weekend flag                                1
    same bucket yesterday, one-hot + missing    9
    same bucket a week ago, one-hot + missing   9
    causal recency-weighted class histogram     8

Features are rebuilt from ``history`` on every call rather than precomputed
once over the corpus. That is slower, and it is what makes the row structurally
leak-proof in the same way the other forecasters are: the model never receives
a row it is not allowed to see, so leaking would take fabricating data rather
than forgetting a cutoff.

Two features that look obvious are deliberately absent. **The previous bucket
of the target day** is the strongest single predictor available and is not
known at prediction time — using it would need sequential decoding, and the
HMM smoother already supplies within-day continuity. **The class histogram
computed as of the eval day** would let a training row from week one see week
ten; the histogram here is accumulated forward, so each row sees only days
before its own.
"""

from __future__ import annotations

import datetime
import warnings
from collections.abc import Sequence

import numpy as np

from ci.hbpe.evaluation.forecaster import CLASS_INDEX, N_CLASSES, DayFit
from ci.hbpe.evaluation.shrinkage import DEFAULT_HALF_LIFE_DAYS
from ci.hbpe.pipeline.baselines import _as_date

N_HARMONICS = 3
N_FEATURES = 2 * N_HARMONICS + 7 + 1 + (N_CLASSES + 1) * 2 + N_CLASSES

# Below this many labelled history rows a 40-feature multinomial fit is not
# worth attempting; the caller falls back to the prior it was handed.
MIN_TRAIN_ROWS = 200


def _day_matrix(
    rows: Sequence[dict], n_buckets: int
) -> tuple[list[datetime.date], np.ndarray]:
    """``(days, Y)`` where ``Y[j, b]`` is a class index or -1 for unobserved."""
    by_day: dict[datetime.date, dict[int, int]] = {}
    for row in rows:
        idx = CLASS_INDEX.get(str(row.get("token_id") or ""))
        if idx is None:
            continue
        bucket = int(row["bucket_idx"])
        if bucket < 0 or bucket >= n_buckets:
            continue
        by_day.setdefault(_as_date(row["date"]), {})[bucket] = idx

    days = sorted(by_day)
    y = np.full((len(days), n_buckets), -1, dtype=np.int64)
    for j, day in enumerate(days):
        for bucket, idx in by_day[day].items():
            y[j, bucket] = idx
    return days, y


def _cyclical(n_buckets: int) -> np.ndarray:
    """``(n_buckets, 2 * N_HARMONICS)`` sin/cos of bucket-of-day."""
    frac = np.arange(n_buckets, dtype=np.float64) / n_buckets
    cols = []
    for h in range(1, N_HARMONICS + 1):
        cols.append(np.sin(2.0 * np.pi * h * frac))
        cols.append(np.cos(2.0 * np.pi * h * frac))
    return np.stack(cols, axis=1)


def _onehot_with_missing(values: np.ndarray) -> np.ndarray:
    """``(n, N_CLASSES + 1)``; -1 sets the trailing missing flag instead."""
    out = np.zeros((values.shape[0], N_CLASSES + 1), dtype=np.float64)
    known = values >= 0
    out[known, values[known]] = 1.0
    out[~known, N_CLASSES] = 1.0
    return out


def _build(
    days: Sequence[datetime.date],
    y: np.ndarray,
    n_buckets: int,
    half_life_days: float,
    *,
    target_date: datetime.date | None = None,
) -> tuple[np.ndarray, np.ndarray]:
    """
    Features for every row of *y*, plus one extra block for *target_date*.

    Sweeps days ascending maintaining a decayed per-bucket class histogram, and
    snapshots it *before* folding each day in, so row ``j`` sees only days
    ``< j``. When *target_date* is given the final snapshot is returned as an
    extra ``n_buckets`` rows at the end, carrying label -1.
    """
    cyc = _cyclical(n_buckets)
    index_of = {day: j for j, day in enumerate(days)}
    decay_per_day = 0.5 ** (1.0 / max(half_life_days, 1e-6))

    hist = np.zeros((n_buckets, N_CLASSES), dtype=np.float64)
    blocks: list[np.ndarray] = []
    labels: list[np.ndarray] = []

    plan: list[tuple[datetime.date, int]] = [(day, j) for j, day in enumerate(days)]
    if target_date is not None:
        plan.append((target_date, -1))

    previous: datetime.date | None = None
    for day, j in plan:
        if previous is not None:
            gap = (day - previous).days
            if gap > 0:
                hist *= decay_per_day**gap
        previous = day

        snapshot = hist.copy()
        totals = snapshot.sum(axis=1, keepdims=True)
        hist_feat = np.divide(
            snapshot,
            totals,
            out=np.full_like(snapshot, 1.0 / N_CLASSES),
            where=totals > 0,
        )

        lag1 = np.full(n_buckets, -1, dtype=np.int64)
        prev_idx = index_of.get(day - datetime.timedelta(days=1))
        if prev_idx is not None:
            lag1 = y[prev_idx]
        lag7 = np.full(n_buckets, -1, dtype=np.int64)
        week_idx = index_of.get(day - datetime.timedelta(days=7))
        if week_idx is not None:
            lag7 = y[week_idx]

        dow = np.zeros((n_buckets, 7), dtype=np.float64)
        dow[:, day.weekday()] = 1.0
        weekend = np.full((n_buckets, 1), 1.0 if day.weekday() >= 5 else 0.0)

        blocks.append(
            np.hstack(
                [
                    cyc,
                    dow,
                    weekend,
                    _onehot_with_missing(lag1),
                    _onehot_with_missing(lag7),
                    hist_feat,
                ]
            )
        )
        labels.append(y[j] if j >= 0 else np.full(n_buckets, -1, dtype=np.int64))

        if j >= 0:
            observed = y[j] >= 0
            hist[observed, y[j][observed]] += 1.0

    return np.vstack(blocks), np.concatenate(labels)


class LogisticForecaster:
    """
    Multinomial logistic regression refit on each eval day's history.

    Falls back to *prior* (the forecaster whose output it would otherwise
    replace) when history is too thin to fit, so the row degrades to a known
    quantity instead of to noise.
    """

    name = "logit"

    def __init__(
        self,
        prior,
        *,
        half_life_days: float = DEFAULT_HALF_LIFE_DAYS,
        c: float = 1.0,
        max_iter: int = 300,
        class_weight: str | None = None,
        name: str | None = None,
    ) -> None:
        self.prior = prior
        self.half_life_days = half_life_days
        self.c = c
        self.max_iter = max_iter
        # ``"balanced"`` reweights each class by its inverse frequency. On the
        # densified corpus the filler is 97% of rows, and an unweighted fit
        # spends its capacity there: it posts a superb Brier by predicting
        # "nothing recorded" accurately and loses recall on the classes anyone
        # wants forecast. Weighting trades aggregate calibration for the rare
        # classes, which is the trade the product wants.
        self.class_weight = class_weight
        if name:
            self.name = name

    def forecast(
        self,
        history: Sequence[dict],
        target_date: datetime.date,
        fit: DayFit,
    ) -> np.ndarray:
        from sklearn.linear_model import LogisticRegression

        n_buckets = fit.b0.shape[0]
        days, y = _day_matrix(history, n_buckets)
        if not days:
            return self.prior.forecast(history, target_date, fit)

        x_all, y_all = _build(
            days,
            y,
            n_buckets,
            self.half_life_days,
            target_date=target_date,
        )
        x_target = x_all[-n_buckets:]
        x_train, y_train = x_all[:-n_buckets], y_all[:-n_buckets]

        keep = y_train >= 0
        x_train, y_train = x_train[keep], y_train[keep]
        if x_train.shape[0] < MIN_TRAIN_ROWS or len(np.unique(y_train)) < 2:
            return self.prior.forecast(history, target_date, fit)

        # No multi_class argument: scikit-learn 1.7 deprecated it and 1.9
        # removed it. lbfgs is multinomial by default, which is what this
        # wants — a single softmax over the eight classes, not eight
        # one-vs-rest fits whose probabilities need renormalising.
        model = LogisticRegression(
            C=self.c,
            max_iter=self.max_iter,
            solver="lbfgs",
            class_weight=self.class_weight,
        )
        with warnings.catch_warnings():
            # An unconverged fit is still a usable probability vector, and the
            # walk-forward loop would otherwise emit one warning per eval day.
            warnings.simplefilter("ignore")
            model.fit(x_train, y_train)
            partial = model.predict_proba(x_target)

        # predict_proba only spans the classes present in this day's training
        # slice; scatter back into the fixed 8-class order.
        out = np.zeros((n_buckets, N_CLASSES), dtype=np.float64)
        out[:, model.classes_] = partial
        return out / np.clip(out.sum(axis=1, keepdims=True), 1e-12, None)


class PriorCorrectedForecaster:
    """
    A calibrated forecaster's probabilities, reweighted for the *decision*.

    ``logit`` posts the best Brier and ECE in the table and mediocre per-class
    recall; ``logit-bal`` inverts that. They are not two models to choose
    between. Class weighting distorts the fit, so ``logit-bal``'s probabilities
    are deliberately wrong and its Brier says so — the gate benches it, which
    is the correct call on a proper scoring rule.

    The recall gap is a *decision-rule* problem, not a probability problem.
    ``argmax`` over a posterior on a 97%-background corpus answers the
    background almost everywhere even when the posterior is exactly right,
    because being right about a rare class still leaves it below the common
    one. Dividing by the class prior before taking the argmax moves the
    operating point without touching the fit:

        p'(c) ∝ p(c) / prior(c) ** power

    ``power=0`` is plain argmax, ``power=1`` full correction to a flat
    effective prior. The prior is counted from *history only*, so this stays
    walk-forward.

    Deployed, this is one model: store what ``logit`` emits, and apply this
    when choosing what to show. Here it has to be a separate row because
    ``score_predictions`` derives top-1, Brier and ECE from the same vector,
    so **read only this row's macro-R and per-class recall**. Its Brier and ECE
    describe reweighted numbers that nothing would ever store.
    """

    name = "logit@rule"

    def __init__(
        self,
        inner,
        *,
        power: float = 1.0,
        name: str | None = None,
    ) -> None:
        self.inner = inner
        self.power = power
        if name:
            self.name = name

    def forecast(
        self,
        history: Sequence[datetime.date] | Sequence[dict],
        target_date: datetime.date,
        fit: DayFit,
    ) -> np.ndarray:
        probs = np.asarray(
            self.inner.forecast(history, target_date, fit), dtype=np.float64
        )

        counts = np.zeros(N_CLASSES, dtype=np.float64)
        for row in history:
            idx = CLASS_INDEX.get(str(row.get("token_id") or ""))
            if idx is not None:
                counts[idx] += 1.0
        total = counts.sum()
        if total <= 0:
            return probs

        # Laplace the prior itself: a class absent from history would otherwise
        # divide by zero and take every bucket.
        prior = (counts + 1.0) / (total + N_CLASSES)
        adjusted = probs / np.power(prior, self.power)[None, :]
        return adjusted / np.clip(adjusted.sum(axis=1, keepdims=True), 1e-12, None)
