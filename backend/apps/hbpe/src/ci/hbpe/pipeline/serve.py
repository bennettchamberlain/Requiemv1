"""
D3 serve gate: HMT must beat B1 on top-1 (margin) or (Brier vs B1 and ECE vs B2).

If it misses, serve B2 emissions + HMM. Missing scores degrade to HMT when a
checkpoint exists, else B1.
"""

from __future__ import annotations

from typing import Any

TOP1_MARGIN = 0.05
MODEL_HMT = "hmt"
MODEL_B0 = "b0"
MODEL_B1 = "b1"
MODEL_B2 = "b2"


def _f(row: dict[str, Any] | None, key: str) -> float | None:
    if not row:
        return None
    val = row.get(key)
    if val is None:
        return None
    try:
        return float(val)
    except (TypeError, ValueError):
        return None


def pick_served_model(
    hmt: dict[str, Any] | None,
    b1: dict[str, Any] | None,
    b2: dict[str, Any] | None,
    *,
    has_checkpoint: bool,
) -> str:
    hmt_top1 = _f(hmt, "l0_top1_acc")
    b1_top1 = _f(b1, "l0_top1_acc")
    if hmt_top1 is None or b1_top1 is None:
        return MODEL_HMT if has_checkpoint else MODEL_B1

    beat_top1 = hmt_top1 >= b1_top1 + TOP1_MARGIN
    hmt_brier, b1_brier = _f(hmt, "brier"), _f(b1, "brier")
    beat_brier = hmt_brier is not None and b1_brier is not None and hmt_brier < b1_brier
    hmt_ece, b2_ece = _f(hmt, "ece"), _f(b2, "ece") if b2 else None
    beat_ece = True if b2_ece is None or hmt_ece is None else hmt_ece < b2_ece

    if beat_top1 or (beat_brier and beat_ece):
        return MODEL_HMT
    return MODEL_B2


def normalize_logged_version(version: str | None) -> str:
    """Map ``hmt_int8.onnx@mtime`` (and friends) to the D3 short name."""
    if not version:
        return MODEL_HMT
    v = version.lower()
    for name in (MODEL_B0, MODEL_B1, MODEL_B2, MODEL_HMT):
        if v == name or v.startswith(f"{name}@") or v.startswith(f"{name}_"):
            return name
    if "hmt" in v or v.endswith(".onnx") or v.endswith(".pt"):
        return MODEL_HMT
    return v
