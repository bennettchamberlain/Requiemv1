"""
Within-day HMM smoother (redesign §9.4a).

``predict()`` used to normalize each 30-min bucket independently, so the
histogram could flicker WORK → LEISURE → WORK. Forward-backward with a
daypart transition prior and the kernel's per-bucket emissions as likelihoods.
Inference-only — no retrain.
"""

from __future__ import annotations

import numpy as np

N_CLASSES = 8
N_DAYPARTS = 4
LAPLACE = 1.0


def daypart_of(bucket_index: int, n_buckets: int) -> int:
    part = max(n_buckets // N_DAYPARTS, 1)
    return min(bucket_index // part, N_DAYPARTS - 1)


def laplace_transitions(counts: np.ndarray) -> np.ndarray:
    """``counts`` is (n_dayparts, C, C) from→to. Rows normalized with Laplace."""
    c = np.asarray(counts, dtype=np.float64)
    if c.ndim != 3:
        raise ValueError(f"expected (P, C, C), got {c.shape}")
    c = c + LAPLACE
    row = c.sum(axis=2, keepdims=True)
    return c / np.clip(row, 1e-12, None)


def forward_backward(
    emissions: np.ndarray,
    transitions: np.ndarray,
    n_buckets: int | None = None,
) -> np.ndarray:
    """
    Smooth a day's class distributions.

    Parameters
    ----------
    emissions:
        ``(T, C)`` per-bucket likelihoods (already a probability simplex).
    transitions:
        Either ``(C, C)`` (from→to, used for every step) or ``(P, C, C)``
        daypart-specific matrices. Step ``t`` uses the daypart of bucket ``t``.
    """
    em = np.asarray(emissions, dtype=np.float64)
    t_len, n_c = em.shape
    tr = np.asarray(transitions, dtype=np.float64)
    if tr.ndim == 2:
        tr = np.broadcast_to(tr, (N_DAYPARTS, n_c, n_c)).copy()
    if tr.shape[-2:] != (n_c, n_c):
        raise ValueError(f"transitions trailing shape {tr.shape[-2:]} != {(n_c, n_c)}")

    buckets = n_buckets or t_len
    log_em = np.log(np.clip(em, 1e-12, None))
    log_tr = np.log(np.clip(tr, 1e-12, None))

    fwd = np.full((t_len, n_c), -np.inf)
    fwd[0] = log_em[0]
    for t in range(1, t_len):
        p = daypart_of(t, buckets)
        # fwd[t, j] = log_em[t, j] + logsumexp_i fwd[t-1, i] + log_tr[p, i, j]
        fwd[t] = log_em[t] + np.logaddexp.reduce(
            fwd[t - 1][:, None] + log_tr[p], axis=0
        )

    bwd = np.zeros((t_len, n_c))
    for t in range(t_len - 2, -1, -1):
        p = daypart_of(t + 1, buckets)
        # bwd[t, i] = logsumexp_j log_tr[p, i, j] + log_em[t+1, j] + bwd[t+1, j]
        bwd[t] = np.logaddexp.reduce(
            log_tr[p] + (log_em[t + 1] + bwd[t + 1])[None, :], axis=1
        )

    log_gamma = fwd + bwd
    log_gamma -= np.logaddexp.reduce(log_gamma, axis=1, keepdims=True)
    return np.exp(log_gamma)


def apply_class_priors(emissions: np.ndarray, priors: np.ndarray) -> np.ndarray:
    """Multiply ``(T, C)`` emissions by ``(T, C)`` or ``(C,)`` lifts and renormalize."""
    em = np.asarray(emissions, dtype=np.float64)
    pr = np.asarray(priors, dtype=np.float64)
    scaled = em * pr
    tot = scaled.sum(axis=1, keepdims=True)
    tot = np.where(tot > 0, tot, 1.0)
    return scaled / tot
