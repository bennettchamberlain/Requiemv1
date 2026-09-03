# Summary source registry

## Intent

`summary_sources.py` is the schema contract between the current `ci` database
and hourly summaries. Each entry owns one explicit, bounded projection of a
source table. Semantic fields are selected before identifiers and bookkeeping
so prompt clipping cannot hide the material being summarized.

## Contract

- Every query accepts `user_id`, `start`, `end`, and `limit` parameters.
- The time predicate means "new or materially changed in this summary window"
  where the table exposes creation/update timestamps; event occurrence times
  remain present in the projected row.
- Raw capture logs and generated products are deliberately absent. In
  particular, `capture_events`, `summaries`, `insights`, `activity_rollup`, and
  `agent_memories` would duplicate material or create feedback loops.
- Sensitive browser rows, deleted records, inferred answers, and private
  answers are filtered before prompt construction.
- A broken projection must fail the job visibly. Callers do not silently turn
  schema errors into an empty hour.

## Extending the registry

Add a source only when it contributes grounded user activity. Project compact
human-readable fields, put text/name fields first, use the shared half-open
window, and add or update the registry contract tests.
