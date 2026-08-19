-- migrate:up
-- Separate the QUARANTINE BUDGET from transient failures, and release the rows
-- an outage already spent it on.
--
-- ## The defect
--
-- `ci.pipeline_state.attempts` counted every failure the same way, and
-- `MAX_ATTEMPTS_BEFORE_QUARANTINE = 5` at a 60 s doubling backoff means the
-- budget is spent 60 + 120 + 240 + 480 = 900 seconds after the first failure.
-- FIFTEEN MINUTES of an unreachable provider therefore produced the same
-- terminal state as a row that can never succeed — and quarantine is terminal:
-- the staleness sweep reclaims only `failed` rows whose gate is due, so nothing
-- ever looks at a quarantined row again short of a stage-version bump (which on
-- a metered stage re-bills the entire corpus).
--
-- Measured on a real appliance after a brief reverse-geocode outage: 12,237
-- `ci.position` rows — 19 % of that corpus — sat `quarantined` with
-- `reason = 'provider_unavailable'`. Those fixes could not get an address, so
-- they could not become Location entities, so they never appeared on the map.
-- The provider was down for minutes; the loss was permanent.
--
-- ## What changes
--
-- `transient_attempts` splits one counter into two budgets:
--
--   * `attempts`           — attempts that COST the row something. Charged by
--                            `claim()`, refunded by the ledger when the outcome
--                            names a transient reason. This is the counter
--                            quarantine is measured against, and it is now spent
--                            only by failures that are the ROW's fault.
--   * `transient_attempts` — consecutive failures blamed on the world
--                            (`TRANSIENT_FAILURE_REASONS`). Drives a separate
--                            15 m → 6 h doubling backoff, has no ceiling, and is
--                            reset by any outcome that is not another transient
--                            failure. "The provider is still down" is not a
--                            verdict about the row, so it can never become one.
--
-- INTEGER NOT NULL DEFAULT 0 is a metadata-only rewriteless ADD COLUMN on
-- PostgreSQL 11+, so this is cheap even though `ci.pipeline_state` carries one
-- row per (entity, stage) across the whole corpus.
ALTER TABLE ci.pipeline_state
    ADD COLUMN IF NOT EXISTS transient_attempts INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN ci.pipeline_state.transient_attempts IS
  'Consecutive failures attributed to the world rather than the row (TRANSIENT_FAILURE_REASONS). Drives its own long backoff and is never counted toward quarantine; reset by any other outcome.';

COMMENT ON COLUMN ci.pipeline_state.attempts IS
  'Attempts that cost the row something: charged by claim(), refunded on a transient failure. Quarantine is measured against THIS counter, so an outage cannot spend the budget meant for poison records.';

-- ## Releasing what the old policy parked
--
-- One-shot, and one-shot is the right shape: after this migration no row can
-- reach `quarantined` for a transient reason, so a repeatable job would have
-- nothing to find. The equivalent operator lever for reasons NOT in the declared
-- set (`stage_threw: ECONNREFUSED …`, an unrecognised provider status) is
-- `POST /api/pipeline/quarantine/release`, which is deliberately explicit about
-- naming the reasons it releases.
--
-- Safe to re-attempt, and cheap to be wrong about:
--
--   * The reasons matched are written ONLY when a provider was unreachable or
--     rate-limiting. A row that fails for a reason of its own gets a different
--     reason — the enrich stages SKIP (never fail) a missing or malformed
--     coordinate, so nothing permanent can be hiding under these two tokens.
--   * `attempts = 0` restores the budget the outage spent, so the retry starts
--     from a clean five and a genuine permanent failure discovered afterwards
--     still quarantines exactly as designed.
--   * `next_attempt_at = now()` makes them due, not urgent. What they cost is
--     bounded by the schedule, not by this statement: the affected stages are
--     `cost: 'metered'`, which `schedule.ts` refuses to let run outside the
--     nightly enrichment window and refuses to declare without a `perRunCap`.
--   * If the provider is STILL down, the first re-attempt fails transiently,
--     refunds its attempt and backs off 15 minutes — it cannot re-quarantine.
--
-- Scoped by `reason`, never by `stage`: the same two tokens mean the same thing
-- in every stage that writes them, and a stage filter here would silently strand
-- whichever leg was added last.
UPDATE ci.pipeline_state
   SET status             = 'failed',
       attempts           = 0,
       transient_attempts = 0,
       next_attempt_at    = now(),
       updated_at         = now()
 WHERE status = 'quarantined'
   AND reason IN ('provider_unavailable', 'ollama_unreachable');

-- migrate:down
-- The released rows are NOT re-quarantined. Rolling the schema back must not
-- re-impose a verdict this migration proved wrong; they are left `failed` with a
-- due gate, which is a state every build understands.
ALTER TABLE ci.pipeline_state
    DROP COLUMN IF EXISTS transient_attempts;
