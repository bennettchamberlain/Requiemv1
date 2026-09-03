# Summary activities

## Intent

`activities.py` is the I/O boundary for summary functions: database reads and
writes, model calls, dossier persistence, insight context, and action storage.

## Summary storage contract

Hourly generation checks for an existing `(user, period_type, period_start,
period_end)` row before doing expensive aggregation or model work. This gives
scheduled retries and manual backfills the same idempotent behavior without a
schema migration. The existing row is returned; no duplicate is inserted.

Database and model errors propagate to the function runner unless an activity's
documented product semantics explicitly make it non-fatal.
