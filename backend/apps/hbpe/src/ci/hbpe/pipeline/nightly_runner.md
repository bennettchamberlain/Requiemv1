# HBPE nightly step functions

## Intent

`nightly_runner.py` implements the independently observable steps orchestrated
by `ci.hbpe.functions`.

## Summary-label window

The summary-label step defaults to the same trailing date window the next token
serialization will publish, rather than yesterday alone. It only processes
unlabeled hourly summaries, so repeated nightly runs are cheap and idempotent.
Optional inclusive start/end dates exist for an explicit recovery run.
Explicit ranges cannot span more than `SERIALIZE_WINDOW_DAYS` (90 days), the
largest label window that the token serializer can publish.
If no event-backed serialization window exists yet, the step falls back to the
previous UTC day so a just-created hourly summary can still receive a label.
