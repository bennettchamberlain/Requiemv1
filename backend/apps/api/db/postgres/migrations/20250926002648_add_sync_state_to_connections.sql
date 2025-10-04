-- migrate:up
ALTER TABLE connections ADD COLUMN sync_state JSONB;

-- Add index for efficient querying of sync_state
CREATE INDEX IF NOT EXISTS idx_connections_sync_state ON connections USING GIN (sync_state);

-- migrate:down
DROP INDEX IF EXISTS idx_connections_sync_state;
ALTER TABLE connections DROP COLUMN IF EXISTS sync_state;