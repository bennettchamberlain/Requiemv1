-- migrate:up

-- Saved "how you'd do it" compose output for a Possibilities card. Generated once,
-- shown on reload instead of re-running the LLM.
ALTER TABLE ci.event_candidates
    ADD COLUMN IF NOT EXISTS personalization JSONB;

-- migrate:down

ALTER TABLE ci.event_candidates
    DROP COLUMN IF EXISTS personalization;
