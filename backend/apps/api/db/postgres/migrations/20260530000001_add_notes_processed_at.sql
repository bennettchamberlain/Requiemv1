-- migrate:up

-- Add processed_at to ci.notes so the memory compaction cron can
-- stamp each fragment after LLM extraction without deleting it.
ALTER TABLE ci.notes
  ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ NULL;

-- Efficient lookup of all unprocessed notes ordered by age, per user.
CREATE INDEX IF NOT EXISTS idx_notes_user_processed_at
  ON ci.notes (user_id, processed_at)
  WHERE processed_at IS NULL;

-- migrate:down

DROP INDEX IF EXISTS ci.idx_notes_user_processed_at;

ALTER TABLE ci.notes
  DROP COLUMN IF EXISTS processed_at;
