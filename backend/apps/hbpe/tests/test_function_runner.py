"""
Unit tests for the HBPE function runner (ci.hbpe.runner).

The HBPE runner shares the summary runner's pool/registry semantics but
delivers callbacks through requests (in a thread) instead of httpx. These
tests pin the registry gate and the callback retry path on that transport.
"""

from __future__ import annotations

import asyncio
from typing import Any

import pytest
from fastapi import HTTPException

from ci.hbpe import runner as runner_module
from ci.hbpe.runner import FunctionRunner, RunRequest


class _FakeResponse:
    def __init__(self, status_code: int, text: str = "") -> None:
        self.status_code = status_code
        self.text = text


async def _wait_for(predicate) -> None:
    # Deliberate poll: the condition is a side effect of the worker task, not
    # something that can signal an asyncio.Event without changing the runner.
    async with asyncio.timeout(5.0):
        while not predicate():  # noqa: ASYNC110
            await asyncio.sleep(0.01)


def _stop_workers(runner: FunctionRunner) -> None:
    for worker in runner._workers:
        worker.cancel()


def test_submit_rejects_unknown_functions():
    runner = FunctionRunner({}, concurrency=1)

    with pytest.raises(HTTPException) as exc_info:
        runner.submit(RunRequest(function="nope"))

    assert exc_info.value.status_code == 400


def test_registry_names_match_the_nest_allowlist():
    from ci.hbpe.functions import FUNCTIONS

    # Must stay in sync with PYTHON_FUNCTIONS.hbpe in the NestJS
    # python-functions domain.
    assert sorted(FUNCTIONS) == ["bootstrap", "ensure_bootstrap", "nightly"]


@pytest.mark.asyncio
async def test_callback_retries_then_delivers(monkeypatch):
    calls: list[dict[str, Any]] = []
    responses: list[Any] = [_FakeResponse(503, "starting"), _FakeResponse(204)]

    def fake_post(url: str, json: Any = None, headers: Any = None, timeout: Any = None):
        calls.append({"url": url, "json": json})
        response = responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return response

    monkeypatch.setattr(runner_module.requests, "post", fake_post)
    monkeypatch.setattr(runner_module, "CALLBACK_RETRY_DELAYS", (0,))
    monkeypatch.setattr(runner_module.settings, "api_url", "http://api:3030")
    monkeypatch.setattr(runner_module.settings, "api_jwt_secret", "test-secret")

    async def noop(**_: Any) -> dict:
        return {"ok": True}

    runner = FunctionRunner({"noop": noop}, concurrency=1)

    try:
        runner.submit(
            RunRequest(
                function="noop",
                args={"user_id": "user-1"},
                job_id="job-1",
                queue="py-fn-hbpe",
            )
        )

        await _wait_for(lambda: len(calls) == 2)

        assert calls[-1]["url"] == "http://api:3030/function-runs/callback"
        assert calls[-1]["json"]["status"] == "completed"
        assert calls[-1]["json"]["job_id"] == "job-1"
    finally:
        _stop_workers(runner)
