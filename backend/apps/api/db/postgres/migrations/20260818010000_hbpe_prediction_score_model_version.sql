-- migrate:up
-- D3 serve gate: one prediction_score row per model_version (hmt / b0 / b1 / b2).
-- Per-class recall lives in reliability_json (sibling of the ECE bins), not a
-- new column — prediction_score has no generic properties JSONB.

ALTER TABLE hbpe.prediction_score
    ADD COLUMN IF NOT EXISTS model_version TEXT NOT NULL DEFAULT 'hmt';

CREATE INDEX IF NOT EXISTS prediction_score_user_model_scored_idx
    ON hbpe.prediction_score (user_id, model_version, scored_at DESC);

-- migrate:down

DROP INDEX IF EXISTS hbpe.prediction_score_user_model_scored_idx;
ALTER TABLE hbpe.prediction_score DROP COLUMN IF EXISTS model_version;
