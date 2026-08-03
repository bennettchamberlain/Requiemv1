-- migrate:up

-- Recurrence profiles: per-(user, L1 cluster) statistical recurrence model,
-- rebuilt nightly from hbpe.token_stream. Backs week-horizon occurrence
-- forecasts ("gym likely Tuesday") and month-horizon due predictions
-- ("haircut due in 6±4 days") — the prediction object changes with horizon:
-- occupancy histogram (24h) → occurrence Bernoulli (week) → renewal/due (month).
CREATE TABLE hbpe.recurrence_profiles (
    user_id                 UUID NOT NULL REFERENCES ci.users(id),
    l1_cluster_id           UUID NOT NULL REFERENCES hbpe.l1_clusters(cluster_id) ON DELETE CASCADE,
    computed_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    history_days            INTEGER NOT NULL,        -- lookback window used to build the profile
    n_occurrence_days       INTEGER NOT NULL,        -- distinct days the cluster occurred
    first_seen              DATE,
    last_seen               DATE,
    dow_counts              INTEGER[] NOT NULL,      -- 7 elems, Mon..Sun occurrence-day counts
    daypart_counts          INTEGER[] NOT NULL,      -- 4 elems: night/morning/afternoon/evening token counts
    intervals_days          INTEGER[] NOT NULL,      -- gaps between consecutive occurrence days (most recent last)
    interval_median         REAL,
    interval_p25            REAL,
    interval_p75            REAL,
    interval_p90            REAL,
    interval_mean           REAL,
    interval_std            REAL,
    periodicity_confidence  REAL NOT NULL DEFAULT 0, -- [0,1]; 0 until >=4 intervals observed
    PRIMARY KEY (user_id, l1_cluster_id)
);

-- Issued occurrence forecasts (week horizon), for retrospective scoring.
-- One row per (forecast issue, target day, cluster). actual is NULL until the
-- nightly backfill fills it from observed token_stream L1 presence — mirrors
-- hbpe.prediction_log / actuals_backfill for the 24h histogram.
CREATE TABLE hbpe.occurrence_log (
    id              UUID NOT NULL DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES ci.users(id),
    predicted_at    TIMESTAMPTZ NOT NULL,
    target_date     DATE NOT NULL,
    l1_cluster_id   UUID NOT NULL,
    p_occur         REAL NOT NULL CHECK (p_occur >= 0 AND p_occur <= 1),
    actual          BOOLEAN,                 -- filled retrospectively; NULL = window not elapsed
    model_version   TEXT NOT NULL,
    PRIMARY KEY (id, predicted_at)
);

CREATE INDEX ON hbpe.occurrence_log (user_id, target_date) WHERE actual IS NULL;
CREATE INDEX ON hbpe.occurrence_log (user_id, l1_cluster_id, target_date);

-- migrate:down

DROP TABLE IF EXISTS hbpe.occurrence_log;
DROP TABLE IF EXISTS hbpe.recurrence_profiles;
