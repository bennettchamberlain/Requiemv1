"""
Sentry error reporting for the HBPE service.

Opt-in and off by default: with no ``SENTRY_DSN`` nothing initialises and the
process makes no outbound connection. Two kill switches disable reporting even
when a DSN has been baked into the image, so an operator can always turn it off
without a rebuild:

  * ``CI_TELEMETRY=off``   — explicit opt-out
  * ``CI_LOCAL_ONLY=true`` — local-only mode means zero phone-home, see
    CI-Engineering/proposals/local-only-mode.md

No PII is ever sent (``send_default_pii=False``) and every payload passes
through :func:`scrub_event` first. Mirrors the contract implemented in
TypeScript at ``backend/apps/api/src/common/telemetry/``.
"""
from __future__ import annotations

import os
import re
from typing import Any, Mapping, Optional

COMPONENT = "ci-server-hbpe"

_FALSEY = {"off", "false", "0", "no", "disabled"}
_TRUTHY = {"on", "true", "1", "yes", "enabled"}

_SECRET_PATTERNS = [
    re.compile(r"Bearer\s+[A-Za-z0-9\-._~+/]+=*", re.IGNORECASE),
    re.compile(r"(?:api[_-]?key|token|password|secret|jwt|auth)[\s=:\"']+[^\s\"',}\]]+", re.IGNORECASE),
    re.compile(r"tskey-[A-Za-z0-9-]+", re.IGNORECASE),
    # Connection URLs carry credentials in the authority section.
    re.compile(r"\b[a-z][a-z0-9+.\-]*://[^\s:@/]+:[^\s@/]+@", re.IGNORECASE),
]

_HOME_PATTERNS = [
    re.compile(r"/Users/[^/\s]+"),
    re.compile(r"/home/[^/\s]+"),
]

_SENSITIVE_KEY = re.compile(
    r"password|secret|token|authorization|cookie|jwt|apikey|api_key|dsn|pepper|private[_-]?key",
    re.IGNORECASE,
)

_MAX_STRING_LENGTH = 8000

_initialized = False


def _read(env: Mapping[str, str], key: str) -> Optional[str]:
    value = env.get(key, "").strip()
    return value or None


def is_enabled(env: Optional[Mapping[str, str]] = None) -> bool:
    """Whether reporting should initialise for this process."""
    env = os.environ if env is None else env

    if (_read(env, "CI_LOCAL_ONLY") or "").lower() in _TRUTHY:
        return False

    if (_read(env, "CI_TELEMETRY") or "").lower() in _FALSEY:
        return False

    return _read(env, "SENTRY_DSN") is not None


def scrub_string(value: str) -> str:
    for pattern in _HOME_PATTERNS:
        value = pattern.sub("~", value)

    for pattern in _SECRET_PATTERNS:
        value = pattern.sub("[Filtered]", value)

    if len(value) > _MAX_STRING_LENGTH:
        return value[:_MAX_STRING_LENGTH] + "… [truncated]"

    return value


def _scrub_value(value: Any, depth: int = 0) -> Any:
    # Guard against cyclic/deep structures — a runaway walk in before_send would
    # stall the reporting path on every captured error.
    if depth > 8:
        return "[Truncated]"

    if isinstance(value, str):
        return scrub_string(value)

    if isinstance(value, dict):
        return {
            key: "[Filtered]" if _SENSITIVE_KEY.search(str(key)) else _scrub_value(nested, depth + 1)
            for key, nested in value.items()
        }

    if isinstance(value, (list, tuple)):
        return [_scrub_value(entry, depth + 1) for entry in value]

    return value


def scrub_event(event: dict, _hint: Optional[dict] = None) -> Optional[dict]:
    """``before_send`` hook — redact credentials and home paths."""
    if not isinstance(event, dict):
        return event

    if isinstance(event.get("logentry"), dict):
        message = event["logentry"].get("message")
        if isinstance(message, str):
            event["logentry"]["message"] = scrub_string(message)

    if isinstance(event.get("message"), str):
        event["message"] = scrub_string(event["message"])

    for exception in (event.get("exception") or {}).get("values") or []:
        if isinstance(exception.get("value"), str):
            exception["value"] = scrub_string(exception["value"])

    if isinstance(event.get("extra"), dict):
        event["extra"] = _scrub_value(event["extra"])

    request = event.get("request")
    if isinstance(request, dict):
        request.pop("cookies", None)
        request.pop("data", None)
        if request.get("query_string"):
            request["query_string"] = "[Filtered]"
        if isinstance(request.get("headers"), dict):
            request["headers"] = _scrub_value(request["headers"])

    return event


def init_telemetry(component: str = COMPONENT) -> bool:
    """
    Initialise Sentry when configured. Returns True when reporting is active.

    Safe to call repeatedly and safe to call when ``sentry-sdk`` is not
    installed — a missing optional dependency must never stop the service from
    starting.
    """
    global _initialized

    if _initialized or not is_enabled():
        return _initialized

    try:
        import sentry_sdk
    except ImportError:  # pragma: no cover - depends on the install extra
        return False

    version = _read(os.environ, "CI_SERVER_VERSION")
    release = _read(os.environ, "SENTRY_RELEASE") or (f"{component}@{version}" if version else None)

    sentry_sdk.init(
        dsn=_read(os.environ, "SENTRY_DSN"),
        environment=(
            _read(os.environ, "SENTRY_ENV")
            or _read(os.environ, "CI_SERVER_ENVIRONMENT")
            or "development"
        ),
        release=release,
        # Errors only — no tracing, no profiling, no PII.
        traces_sample_rate=0.0,
        profiles_sample_rate=0.0,
        send_default_pii=False,
        before_send=scrub_event,
    )
    sentry_sdk.set_tag("component", component)

    if version:
        sentry_sdk.set_tag("deployment_version", version)

    _initialized = True

    return True
