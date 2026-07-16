-- migrate:up
--
-- CI-HBPE-SPEC-001 §T5 — live forecast scoring results (Phase 5b).
--
-- One row per scoring run of hbpe.prediction_log (Brier / accuracy / ECE /
-- coverage / drift over a window of backfilled forecasts).  Written by the
-- HBPE sidecar's nightly drift_detection step
-- (backend/apps/hbpe/src/ci/pipeline/scoring.py — score_and_store).
--
-- This migration is the canonical DDL.  scoring.py keeps an idempotent
-- CREATE IF NOT EXISTS copy (ensure_score_table) as belt-and-braces for
-- installs that run the sidecar before this migration; the two must stay in
-- sync (_ENSURE_TABLE_SQL mirrors this file exactly).
--
-- NOTE: user_id intentionally has no REFERENCES ci.users(id) FK this cycle to
-- keep parity with the sidecar's self-bootstrap DDL (which cannot assume the
-- ci schema exists).  Follow-up: add the FK once the self-bootstrap is retired.

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
