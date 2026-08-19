-- migrate:up
--
-- Live forecast scoring results. Written by the HBPE nightly drift_detection
-- step (ci.hbpe.pipeline.scoring.score_and_store) from backfilled
-- hbpe.prediction_log rows. Read by Forecast's trust panel and forecast.calibration.
--
-- Basis is self-consistency vs Qwen-derived behavior labels, not ground truth.

CREATE SCHEMA IF NOT EXISTS hbpe;

CREATE TABLE IF NOT EXISTS hbpe.prediction_score (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          UUID NOT NULL,
    scored_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    window_start     TIMESTAMPTZ NOT NULL,
    window_end       TIMESTAMPTZ NOT NULL,
    brier            DOUBLE PRECISION,
    l0_top1_acc      DOUBLE PRECISION,
    l1_top3_acc      DOUBLE PRECISION,
    ece              DOUBLE PRECISION,
    coverage         DOUBLE PRECISION,
    reliability_json JSONB,
    drift_flag       BOOLEAN NOT NULL DEFAULT FALSE,
    n_buckets        INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS prediction_score_user_scored_idx
    ON hbpe.prediction_score (user_id, scored_at DESC);

-- migrate:down

DROP INDEX IF EXISTS hbpe.prediction_score_user_scored_idx;
DROP TABLE IF EXISTS hbpe.prediction_score;
