-- migrate:up
-- =====================================================================
-- ci_derived.daily_metrics — the Daily Feature Store
-- =====================================================================
-- A wide, per-(user_id, date) table of derived SCALAR metrics computed from
-- the raw capture tables (ci.communications, ci.position, ci.browser_activity,
-- ci.inventory). It is the keystone the descriptive "insight engine" reads
-- from: questions are answered by aggregating these pre-computed daily scalars
-- over a timeframe, never by re-scanning the raw tables at query time.
--
-- `ci_derived` is a NEW schema dedicated to materialized/derived features so the
-- source-of-truth `ci` schema stays clean. Rows are (re)computed idempotently by
-- DailyMetricsService.computeAndStore via INSERT ... ON CONFLICT (user_id, date).
--
-- COVERAGE, not zero-fill. Every metric column is NULLABLE: a NULL means "no
-- underlying data for this metric on this day", which is semantically distinct
-- from 0 (e.g. "sent 0 messages" vs "we have no messages ingested"). The
-- companion `coverage` JSONB records a 0..1 confidence per metric (typically the
-- fraction of underlying rows that carried the field the metric needs) so a
-- consumer never misreads absent data as a real zero.
CREATE SCHEMA IF NOT EXISTS ci_derived;

CREATE TABLE IF NOT EXISTS ci_derived.daily_metrics (
    user_id           UUID        NOT NULL REFERENCES ci.users(id) ON DELETE CASCADE,
    -- Local calendar date the metrics are bucketed into. Bucketing uses the
    -- `timezone` below so "a day" matches the user's wall clock, not UTC.
    date              DATE        NOT NULL,
    timezone          TEXT        NOT NULL DEFAULT 'UTC',

    -- Communications (ci.communications)
    n_messages        INTEGER,            -- messages that day
    n_conversations   INTEGER,            -- distinct threads (+ un-threaded msgs)
    n_unique_contacts INTEGER,            -- distinct from/to entities
    outbound_ratio    DOUBLE PRECISION,   -- outbound / total, 0..1
    avg_sentiment     DOUBLE PRECISION,   -- mean sentiment_score of scored msgs

    -- Position (ci.position)
    n_places          INTEGER,            -- distinct ~110m location clusters
    km_traveled       DOUBLE PRECISION,   -- summed great-circle path length

    -- Browser activity (ci.browser_activity)
    screen_minutes    DOUBLE PRECISION,   -- summed duration_seconds / 60
    n_domains         INTEGER,            -- distinct hosts visited

    -- Money (ci.inventory)
    spend_total       NUMERIC(14, 2),     -- purchase_price of items acquired

    -- Per-metric confidence 0..1, keyed by metric column name. Missing or
    -- under-sampled metrics carry a low confidence so a NULL is never read as
    -- a real 0.
    coverage          JSONB       NOT NULL DEFAULT '{}',

    computed_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (user_id, date)
);

-- Cross-user date-range scans (e.g. "compute yesterday for everyone", backfills).
-- The PK already serves the per-user (user_id, date) range reads the engine does.
CREATE INDEX IF NOT EXISTS daily_metrics_date_idx
    ON ci_derived.daily_metrics (date);

-- migrate:down
DROP INDEX IF EXISTS ci_derived.daily_metrics_date_idx;
DROP TABLE IF EXISTS ci_derived.daily_metrics;
-- RESTRICT (the default): only drops the schema if nothing else was added to it.
DROP SCHEMA IF EXISTS ci_derived;
