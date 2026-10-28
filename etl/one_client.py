"""Talk to One: CLI when available, else HTTP passthrough."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
from typing import Any


def _run(*args: str) -> Any:
    one = shutil.which("one")
    if not one:
        raise RuntimeError("one CLI is not on PATH")
    proc = subprocess.run(
        [one, "--agent", *args],
        check=False,
        capture_output=True,
        text=True,
        env=os.environ.copy(),
    )
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr or proc.stdout or f"one exit {proc.returncode}")
    text = proc.stdout.strip()
    return json.loads(text) if text else {}


def list_connections(search: str | None = None) -> list[dict[str, Any]]:
    args = ["list"]
    if search:
        args.extend(["--search", search])
    data = _run(*args)
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        for key in ("connections", "integrations", "items"):
            if isinstance(data.get(key), list):
                return data[key]
    return []


def find_action(platform: str, intent: str, task: str, model: str) -> dict[str, Any]:
    data = _run(
        "actions",
        "find",
        platform,
        intent,
        "--task",
        task,
        "--ai-model",
        model,
    )
    answers = data.get("answers") if isinstance(data, dict) else None
    if not answers:
        return data if isinstance(data, dict) else {}
    first = answers[0]
    selected = first.get("selected") or first.get("alsoSelected") or []
    if isinstance(selected, list) and selected:
        return selected[0]
    return first


def execute(
    platform: str,
    action_id: str,
    connection_key: str,
    *,
    query: dict[str, Any] | None = None,
    data: dict[str, Any] | None = None,
    path_vars: dict[str, Any] | None = None,
) -> Any:
    args = ["actions", "execute", platform, action_id, connection_key]
    if data is not None:
        args.extend(["-d", json.dumps(data)])
    if query:
        args.extend(["--query-params", json.dumps(query)])
    if path_vars:
        args.extend(["--path-vars", json.dumps(path_vars)])
    return _run(*args)
