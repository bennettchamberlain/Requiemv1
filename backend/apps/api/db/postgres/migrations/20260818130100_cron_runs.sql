-- migrate:up

-- Nest's SchedulerRegistry only remembers lastDate() for the current process.
-- A restart (or two weeks offline) wiped every "Last run" on the Jobs page even
-- when the schedule had been healthy. Persist one row per registered cron name
-- so operators can see "this has not fired since …" across boots.

CREATE TABLE IF NOT EXISTS ci.cron_runs (
    name         text        PRIMARY KEY,
    last_run_at  timestamptz NOT NULL
);

COMMENT ON TABLE ci.cron_runs IS
  'Durable last-fire time for Nest @Cron schedules. The Jobs dashboard reads this; in-memory SchedulerRegistry lastDate() alone is cleared on every API restart.';

-- migrate:down

DROP TABLE IF EXISTS ci.cron_runs;
