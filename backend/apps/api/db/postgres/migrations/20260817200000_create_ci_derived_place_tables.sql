-- migrate:up
-- =====================================================================
-- ci_derived place tables — ported from 1729 / archive/insight-engine-place-math
-- Tables live in ci_derived.
-- =====================================================================
-- Three derived tables backing the next-place prediction engine:
--
--   place_clusters     — stable stay-point clusters mined from ci.position by
--                        PlaceClusterService (sessionized stays >= ~15 min within
--                        ~150 m, greedily merged). `label` is filled read-only
--                        from ci.geocode_cache reverse-geocode rows when one is
--                        near the centroid; NULL otherwise (no external calls).
--   place_transitions  — recency-decayed counts of consecutive-stay transitions,
--                        bucketed by (hour, day-of-week) so predictNext can
--                        condition on time of day. decayed_count is a float: each
--                        observed transition contributes 0.5^(age_days / 30)
--                        (~30-day half-life), summed per bucket.
--   place_forecast_log — every predictNext output, persisted for later scoring
--                        (scoreLog fills actual_cluster once the horizon elapses
--                        and computes hit-rate@k). Mirrors the HBPE
--                        forecast-vs-actual scoring-loop pattern.
--
-- All rows are derived and rebuildable from ci.position, so they live in the
-- ci_derived schema (created by 20260817180000_create_ci_derived_daily_metrics)
-- and cascade away with the user.

CREATE TABLE IF NOT EXISTS ci_derived.place_clusters (
    id          UUID                   PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID                   NOT NULL REFERENCES ci.users(id) ON DELETE CASCADE,
    centroid    GEOGRAPHY(POINT, 4326) NOT NULL,
    -- Effective radius of the cluster in meters (max stay-to-centroid distance,
    -- floored at the merge radius so a single-stay cluster still has extent).
    radius_m    DOUBLE PRECISION       NOT NULL DEFAULT 150,
    -- Human-readable place name from ci.geocode_cache (reverse:* rows); NULL
    -- when no cached reverse-geocode lies within the cluster.
    label       TEXT,
    visit_count INTEGER                NOT NULL DEFAULT 0,
    first_seen  TIMESTAMPTZ,
    last_seen   TIMESTAMPTZ
);

-- Per-user scans (rebuilds, forecast reads).
CREATE INDEX IF NOT EXISTS place_clusters_user_idx
    ON ci_derived.place_clusters (user_id);

-- Proximity matching (idempotent re-cluster runs, actual-cluster scoring).
CREATE INDEX IF NOT EXISTS place_clusters_centroid_idx
    ON ci_derived.place_clusters USING GIST (centroid);

CREATE TABLE IF NOT EXISTS ci_derived.place_transitions (
    user_id       UUID             NOT NULL REFERENCES ci.users(id) ON DELETE CASCADE,
    from_cluster  UUID             NOT NULL REFERENCES ci_derived.place_clusters(id) ON DELETE CASCADE,
    to_cluster    UUID             NOT NULL REFERENCES ci_derived.place_clusters(id) ON DELETE CASCADE,
    -- Hour (0-23) and day-of-week (0-6, Sunday=0) of the *arrival* at
    -- to_cluster, so predictions condition on when the move happens.
    hour_bucket   INTEGER          NOT NULL CHECK (hour_bucket BETWEEN 0 AND 23),
    dow           INTEGER          NOT NULL CHECK (dow BETWEEN 0 AND 6),
    decayed_count DOUBLE PRECISION NOT NULL DEFAULT 0,
    updated_at    TIMESTAMPTZ      NOT NULL DEFAULT now(),

    PRIMARY KEY (user_id, from_cluster, to_cluster, hour_bucket, dow)
);

CREATE TABLE IF NOT EXISTS ci_derived.place_forecast_log (
    id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        UUID        NOT NULL REFERENCES ci.users(id) ON DELETE CASCADE,
    predicted_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    horizon_hours  INTEGER     NOT NULL,
    -- Top-k predictions as [{"cluster_id": uuid, "prob": float}], highest first.
    predictions    JSONB       NOT NULL,
    -- Filled by scoreLog once the horizon has elapsed: the first cluster the
    -- user was observed staying at inside the window. NULL when the horizon
    -- elapsed with no observed stay (still marked scored so we don't rescan).
    actual_cluster UUID        REFERENCES ci_derived.place_clusters(id) ON DELETE SET NULL,
    scored         BOOLEAN     NOT NULL DEFAULT false
);

-- scoreLog scans "my unscored predictions whose horizon has elapsed".
CREATE INDEX IF NOT EXISTS place_forecast_log_user_scored_idx
    ON ci_derived.place_forecast_log (user_id, scored, predicted_at);

-- migrate:down
DROP TABLE IF EXISTS ci_derived.place_forecast_log;
DROP TABLE IF EXISTS ci_derived.place_transitions;
DROP INDEX IF EXISTS ci_derived.place_clusters_centroid_idx;
DROP INDEX IF EXISTS ci_derived.place_clusters_user_idx;
DROP TABLE IF EXISTS ci_derived.place_clusters;
