-- migrate:up
ALTER TABLE api_logs ADD COLUMN last_processed TIMESTAMPTZ;

-- Create index on the new column for efficient queries
CREATE INDEX IF NOT EXISTS idx_api_logs_last_processed ON api_logs(last_processed);

-- migrate:down
ALTER TABLE api_logs DROP COLUMN IF EXISTS last_processed;
