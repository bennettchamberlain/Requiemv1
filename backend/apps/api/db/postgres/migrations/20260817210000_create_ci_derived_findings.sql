-- migrate:up
-- =====================================================================
-- Derivation findings: correlations, anomalies, suggestions, arm priors.
-- Plus ci.actions.source so Brief/tools can tell computed rows from
-- onboarding stubs and free-LLM actions.
-- =====================================================================

CREATE TABLE IF NOT EXISTS ci_derived.metric_correlations (
    id              UUID PRIMARY KEY DEFAULT ci.gen_uuid_v7(),
    user_id         UUID NOT NULL REFERENCES ci.users(id) ON DELETE CASCADE,
    metric_a        TEXT NOT NULL,
    metric_b        TEXT NOT NULL,
    lag_days        INTEGER NOT NULL,
    window_days     INTEGER NOT NULL,
    n               INTEGER NOT NULL,
    pearson         DOUBLE PRECISION,
    spearman        DOUBLE PRECISION,
    mutual_info     DOUBLE PRECISION,
    p_value         DOUBLE PRECISION,
    q_value         DOUBLE PRECISION,
    effect          DOUBLE PRECISION,
    robust          BOOLEAN NOT NULL DEFAULT FALSE,
    novelty         DOUBLE PRECISION NOT NULL DEFAULT 1,
    coverage_mean   DOUBLE PRECISION,
    computed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, metric_a, metric_b, lag_days, window_days)
);

CREATE INDEX IF NOT EXISTS metric_correlations_user_q_idx
    ON ci_derived.metric_correlations (user_id, q_value);

CREATE INDEX IF NOT EXISTS metric_correlations_user_robust_idx
    ON ci_derived.metric_correlations (user_id, robust, computed_at DESC);

CREATE TABLE IF NOT EXISTS ci_derived.metric_anomalies (
    id              UUID PRIMARY KEY DEFAULT ci.gen_uuid_v7(),
    user_id         UUID NOT NULL REFERENCES ci.users(id) ON DELETE CASCADE,
    metric          TEXT NOT NULL,
    date            DATE NOT NULL,
    detector        TEXT NOT NULL CHECK (detector IN ('robust_z', 'cusum', 'hbpe_l0')),
    value           DOUBLE PRECISION,
    baseline        DOUBLE PRECISION,
    score           DOUBLE PRECISION NOT NULL,
    direction       TEXT NOT NULL CHECK (direction IN ('high', 'low', 'change', 'divergence')),
    coverage        DOUBLE PRECISION NOT NULL DEFAULT 0,
    metadata        JSONB NOT NULL DEFAULT '{}',
    action_id       UUID REFERENCES ci.actions(id) ON DELETE SET NULL,
    computed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, metric, date, detector)
);

CREATE INDEX IF NOT EXISTS metric_anomalies_user_date_idx
    ON ci_derived.metric_anomalies (user_id, date DESC);

CREATE TABLE IF NOT EXISTS ci_derived.metric_suggestions (
    id              UUID PRIMARY KEY DEFAULT ci.gen_uuid_v7(),
    user_id         UUID NOT NULL REFERENCES ci.users(id) ON DELETE CASCADE,
    key             TEXT NOT NULL,
    title           TEXT NOT NULL,
    text            TEXT NOT NULL,
    priority        INTEGER,
    correlation_id  UUID REFERENCES ci_derived.metric_correlations(id) ON DELETE SET NULL,
    anomaly_id      UUID REFERENCES ci_derived.metric_anomalies(id) ON DELETE SET NULL,
    evidence        JSONB NOT NULL,
    action_id       UUID REFERENCES ci.actions(id) ON DELETE SET NULL,
    accepted_at     TIMESTAMPTZ,
    dismissed_at    TIMESTAMPTZ,
    computed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT metric_suggestions_evidence_present
        CHECK (num_nonnulls(correlation_id, anomaly_id) >= 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS metric_suggestions_live_key
    ON ci_derived.metric_suggestions (user_id, key)
    WHERE accepted_at IS NULL AND dismissed_at IS NULL;

CREATE TABLE IF NOT EXISTS ci_derived.suggestion_arms (
    user_id     UUID NOT NULL REFERENCES ci.users(id) ON DELETE CASCADE,
    key         TEXT NOT NULL,
    alpha       DOUBLE PRECISION NOT NULL DEFAULT 1,
    beta        DOUBLE PRECISION NOT NULL DEFAULT 1,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, key)
);

ALTER TABLE ci.actions
    ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'legacy';

ALTER TABLE ci.actions
    DROP CONSTRAINT IF EXISTS actions_source_check;

ALTER TABLE ci.actions
    ADD CONSTRAINT actions_source_check
    CHECK (source IN ('legacy', 'correlation', 'anomaly', 'suggestion'));

-- migrate:down

ALTER TABLE ci.actions DROP CONSTRAINT IF EXISTS actions_source_check;
ALTER TABLE ci.actions DROP COLUMN IF EXISTS source;

DROP TABLE IF EXISTS ci_derived.suggestion_arms;
DROP INDEX IF EXISTS ci_derived.metric_suggestions_live_key;
DROP TABLE IF EXISTS ci_derived.metric_suggestions;
DROP INDEX IF EXISTS ci_derived.metric_anomalies_user_date_idx;
DROP TABLE IF EXISTS ci_derived.metric_anomalies;
DROP INDEX IF EXISTS ci_derived.metric_correlations_user_robust_idx;
DROP INDEX IF EXISTS ci_derived.metric_correlations_user_q_idx;
DROP TABLE IF EXISTS ci_derived.metric_correlations;
