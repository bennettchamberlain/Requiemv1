"""Tests for bounded historical hourly-summary labeling."""

from __future__ import annotations

import asyncio
import datetime as dt
import sys
from pathlib import Path

SRC = Path(__file__).resolve().parents[1] / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from ci.hbpe import data_client as dc  # noqa: E402
from ci.hbpe import functions  # noqa: E402
from ci.hbpe.pipeline import bootstrap as bs  # noqa: E402
from ci.hbpe.pipeline import nightly_runner as nr  # noqa: E402
from ci.hbpe.tokenizer import summary_tokenizer as st  # noqa: E402

USER = "01a0517c-0851-768e-b8ba-6754b7a9b7e3"


class _Cursor:
    def __init__(self, rows: list[dict], calls: list[tuple]) -> None:
        self.rows = rows
        self.calls = calls

    def execute(self, sql, params=None):
        self.calls.append((" ".join(str(sql).split()), tuple(params or ())))

    def fetchall(self):
        return self.rows

    def __enter__(self):
        return self

    def __exit__(self, *_exc):
        return False


class _Conn:
    def __init__(self, rows: list[dict], calls: list[tuple]) -> None:
        self.rows = rows
        self.calls = calls

    def cursor(self, **_kwargs):
        return _Cursor(self.rows, self.calls)

    def __enter__(self):
        return self

    def __exit__(self, *_exc):
        return False


def test_range_reader_selects_only_unlabeled_hourly_summaries(monkeypatch):
    calls: list[tuple] = []
    rows = [
        {
            "summary_id": "summary-1",
            "period_start": dt.datetime(2026, 8, 1, tzinfo=dt.UTC),
            "content": {"summary_text": "grounded hour"},
        }
    ]
    monkeypatch.setattr(dc, "get_conn", lambda: _Conn(rows, calls))

    result = dc.get_unlabeled_summaries_in_range(USER, "2026-08-01", "2026-08-03")

    assert result == rows
    sql, params = calls[0]
    assert "s.period_type = 'hourly'" in sql
    assert "LEFT JOIN hbpe.summary_l1_label" in sql
    assert "label.summary_id IS NULL" in sql
    assert "s.period_start >= %s::date" in sql
    assert "s.period_start < (%s::date + INTERVAL '1 day')" in sql
    assert params == (USER, "2026-08-01", "2026-08-03")


def test_tokenizer_range_uses_one_range_read_and_shared_labeler(monkeypatch):
    rows = [{"summary_id": "summary-1", "content": {"summary_text": "work"}}]
    fetched: list[tuple] = []
    labeled: list[tuple] = []

    def fetch(user_id: str, start_date: str, end_date: str):
        fetched.append((user_id, start_date, end_date))
        return rows

    def label(self, user_id: str, supplied: list[dict], scope: str):
        labeled.append((self, user_id, supplied, scope))
        return 1

    monkeypatch.setattr(dc, "get_unlabeled_summaries_in_range", fetch)
    monkeypatch.setattr(st.SummaryTokenizer, "_label_rows", label)

    tokenizer = st.SummaryTokenizer()
    result = tokenizer.label_range(USER, "2026-08-01", "2026-08-03")

    assert result == 1
    assert fetched == [(USER, "2026-08-01", "2026-08-03")]
    assert labeled == [(tokenizer, USER, rows, "start=2026-08-01 end=2026-08-03")]


async def _immediate_inference(fn):
    return fn(None)


def test_nightly_step_defaults_to_the_serialization_window(monkeypatch):
    calls: list[tuple] = []

    class _Tokenizer:
        def label_range(self, user_id: str, start_date: str, end_date: str):
            calls.append((user_id, start_date, end_date))
            return 7

    monkeypatch.setattr(nr, "_run_inference", _immediate_inference)
    monkeypatch.setattr(
        bs,
        "event_date_bounds",
        lambda _user_id: (dt.date(2026, 5, 1), dt.date(2026, 8, 30)),
    )
    monkeypatch.setattr(
        bs,
        "serialize_window",
        lambda _bounds: (dt.date(2026, 6, 1), dt.date(2026, 8, 30)),
    )
    monkeypatch.setattr(st, "SummaryTokenizer", _Tokenizer)

    result = asyncio.run(nr.label_summary_tokens(USER))

    assert calls == [(USER, "2026-06-01", "2026-08-30")]
    assert result == {
        "labeled": 7,
        "start_date": "2026-06-01",
        "end_date": "2026-08-30",
    }


def test_nightly_step_accepts_an_explicit_recovery_range(monkeypatch):
    calls: list[tuple] = []

    class _Tokenizer:
        def label_range(self, user_id: str, start_date: str, end_date: str):
            calls.append((user_id, start_date, end_date))
            return 2

    monkeypatch.setattr(nr, "_run_inference", _immediate_inference)
    monkeypatch.setattr(st, "SummaryTokenizer", _Tokenizer)

    result = asyncio.run(
        nr.label_summary_tokens(USER, start_date="2026-08-28", end_date="2026-08-30")
    )

    assert calls == [(USER, "2026-08-28", "2026-08-30")]
    assert result["labeled"] == 2


def test_nightly_step_rejects_recovery_outside_the_serialization_window(
    monkeypatch,
):
    monkeypatch.setattr(nr, "_run_inference", _immediate_inference)

    try:
        asyncio.run(
            nr.label_summary_tokens(
                USER, start_date="2026-05-01", end_date="2026-08-30"
            )
        )
    except ValueError as exc:
        assert "cannot exceed the serialization window" in str(exc)
    else:
        raise AssertionError("expected an oversized recovery range to fail")


def test_nightly_function_forwards_explicit_summary_recovery_dates(monkeypatch):
    forwarded: list[tuple] = []

    async def no_op(*_args, **_kwargs):
        return {}

    async def label_summaries(user_id: str, **kwargs):
        forwarded.append((user_id, kwargs))
        return {"labeled": 0}

    async def no_bootstrap(*_args, **_kwargs):
        return {"needs": False}

    for name in (
        "serialize_token_stream",
        "train_hmt_model",
        "calibrate_and_export_onnx",
    ):
        monkeypatch.setattr(bs, name, no_op)
    for name in (
        "label_unlabeled",
        "l1_stale_sweep",
        "l2_stale_sweep",
        "lora_fine_tune",
        "backfill_actuals",
        "recurrence_profile",
        "drift_detection",
        "cache_invalidation",
    ):
        monkeypatch.setattr(nr, name, no_op)
    monkeypatch.setattr(nr, "label_summary_tokens", label_summaries)
    monkeypatch.setattr(nr, "needs_bootstrap", no_bootstrap)

    asyncio.run(
        functions.nightly(
            USER,
            summary_start_date="2026-08-01",
            summary_end_date="2026-08-30",
        )
    )

    assert forwarded == [
        (
            USER,
            {"start_date": "2026-08-01", "end_date": "2026-08-30"},
        )
    ]
