-- migrate:up
-- =====================================================================
-- ci_derived.daily_metrics — the Daily Feature Store
-- =====================================================================
-- A wide, per-(user_id, date) table of derived SCALAR metrics computed from
-- the raw capture tables (ci.communications, ci.position, ci.browser_activity,
-- ci.inventory). Questions are answered by aggregating these pre-computed
-- daily scalars over a timeframe, never by re-scanning the raw tables.
--
-- COVERAGE, not zero-fill. Every metric column is NULLABLE: a NULL means "no
-- underlying data for this metric on this day", which is semantically distinct
-- from 0. The companion `coverage` JSONB records a 0..1 confidence per metric.
CREATE SCHEMA IF NOT EXISTS ci_derived;

CREATE TABLE IF NOT EXISTS ci_derived.daily_metrics (
    user_id           UUID        NOT NULL REFERENCES ci.users(id) ON DELETE CASCADE,
    date              DATE        NOT NULL,
    timezone          TEXT        NOT NULL DEFAULT 'UTC',

    n_messages        INTEGER,
    n_conversations   INTEGER,
    n_unique_contacts INTEGER,
    outbound_ratio    DOUBLE PRECISION,
    avg_sentiment     DOUBLE PRECISION,

    n_places          INTEGER,
    km_traveled       DOUBLE PRECISION,

    screen_minutes    DOUBLE PRECISION,
    n_domains         INTEGER,

    spend_total       NUMERIC(14, 2),

    coverage          JSONB       NOT NULL DEFAULT '{}',
    computed_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (user_id, date)
);

CREATE INDEX IF NOT EXISTS daily_metrics_date_idx
    ON ci_derived.daily_metrics (date);

-- migrate:down
DROP INDEX IF EXISTS ci_derived.daily_metrics_date_idx;
DROP TABLE IF EXISTS ci_derived.daily_metrics;
DROP SCHEMA IF EXISTS ci_derived;
