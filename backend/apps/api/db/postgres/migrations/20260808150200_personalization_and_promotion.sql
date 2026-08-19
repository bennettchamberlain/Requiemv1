-- migrate:up
-- Consolidated from feat/schedules: trust-dial promotion review pipeline.

CREATE TABLE ci.promotion_candidates (
    promotion_candidate_id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES ci.users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}',
    confidence DOUBLE PRECISION NOT NULL DEFAULT 0,
    evidence JSONB NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'pending',
    source_job TEXT,
    requires_user_input BOOLEAN NOT NULL DEFAULT TRUE,
    review_prompt TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT promotion_candidates_status_check CHECK (status IN ('pending', 'accepted', 'rejected')),
    CONSTRAINT promotion_candidates_kind_check CHECK (kind IN ('relationship', 'entity', 'schedule_accept', 'inferred_fact'))
);

CREATE INDEX idx_promotion_candidates_user_status
    ON ci.promotion_candidates (user_id, status, created_at DESC);

ALTER TABLE ci.feed_queue
    ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}';

ALTER TABLE ci.feed_queue
    DROP CONSTRAINT IF EXISTS feed_queue_item_type_check;

ALTER TABLE ci.feed_queue
    DROP CONSTRAINT IF EXISTS feed_queue_item_reference_check;

ALTER TABLE ci.feed_queue
    ADD CONSTRAINT feed_queue_item_reference_check
        CHECK (
            (item_type = 'action' AND action_id IS NOT NULL AND summary_id IS NULL AND question_id IS NULL)
            OR (item_type = 'summary' AND summary_id IS NOT NULL AND action_id IS NULL AND question_id IS NULL)
            OR (item_type = 'question' AND question_id IS NOT NULL AND action_id IS NULL AND summary_id IS NULL)
            OR (item_type = 'promotion_review' AND action_id IS NULL AND summary_id IS NULL AND question_id IS NULL)
        );

ALTER TABLE ci.feed_queue
    ADD CONSTRAINT feed_queue_item_type_check
        CHECK (item_type IN ('action', 'summary', 'question', 'promotion_review'));

-- migrate:down

ALTER TABLE ci.feed_queue
    DROP CONSTRAINT IF EXISTS feed_queue_item_type_check;

ALTER TABLE ci.feed_queue
    DROP CONSTRAINT IF EXISTS feed_queue_item_reference_check;

ALTER TABLE ci.feed_queue
    ADD CONSTRAINT feed_queue_item_reference_check
        CHECK (num_nonnulls(action_id, summary_id, question_id) = 1);

ALTER TABLE ci.feed_queue
    ADD CONSTRAINT feed_queue_item_type_check
        CHECK (
            (item_type = 'action' AND action_id IS NOT NULL AND summary_id IS NULL AND question_id IS NULL)
            OR (item_type = 'summary' AND summary_id IS NOT NULL AND action_id IS NULL AND question_id IS NULL)
            OR (item_type = 'question' AND question_id IS NOT NULL AND action_id IS NULL AND summary_id IS NULL)
        );

ALTER TABLE ci.feed_queue
    DROP COLUMN IF EXISTS metadata;

DROP TABLE IF EXISTS ci.promotion_candidates;
