"""
The two Python telemetry modules must not drift.

`backend/apps/summary/src/ci/summary/telemetry.py` is a copy of
`backend/apps/hbpe/src/ci/telemetry.py` with only the component name and the
docstring's service name changed. Nothing enforces that by construction, and a
scrub rule added to one but not the other silently widens what the other service
sends — which is precisely how the browser copy ended up with none of the shared
redactions. Fail CI instead.
"""
from __future__ import annotations

import pathlib

_APPS = pathlib.Path(__file__).resolve().parents[2]
_HBPE = _APPS / "hbpe" / "src" / "ci" / "telemetry.py"
_SUMMARY = _APPS / "summary" / "src" / "ci" / "summary" / "telemetry.py"

# The only sanctioned differences between the twins.
_SUBSTITUTIONS = [
    ('COMPONENT = "ci-server-summary"', 'COMPONENT = "ci-server-hbpe"'),
    ("Sentry error reporting for the Summary service.", "Sentry error reporting for the HBPE service."),
]


def test_summary_telemetry_is_the_hbpe_twin():
    assert _HBPE.exists() and _SUMMARY.exists()

    normalized = _SUMMARY.read_text()
    for old, new in _SUBSTITUTIONS:
        normalized = normalized.replace(old, new)

    assert normalized == _HBPE.read_text(), (
        "backend/apps/summary/src/ci/summary/telemetry.py has drifted from the "
        "hbpe twin. Regenerate it with:\n"
        "  cd backend/apps && sed 's/COMPONENT = \"ci-server-hbpe\"/COMPONENT = \"ci-server-summary\"/; "
        "s/Sentry error reporting for the HBPE service./Sentry error reporting for the Summary service./' "
        "hbpe/src/ci/telemetry.py > summary/src/ci/summary/telemetry.py"
    )


def test_component_names_are_actually_distinct():
    # Guard against the substitution above silently masking a bad copy.
    assert 'COMPONENT = "ci-server-hbpe"' in _HBPE.read_text()
    assert 'COMPONENT = "ci-server-summary"' in _SUMMARY.read_text()
