-- migrate:up
DROP TABLE IF EXISTS api_logs;

CREATE TABLE api_logs (
    id UUID DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),
    connection_id UUID REFERENCES connections(id),
    scope TEXT,
    content JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id, created_at, user_id)
);

-- Convert to TimescaleDB hypertable
SELECT create_hypertable('api_logs', 'created_at', 'user_id', 4);

-- Basic indexes
CREATE INDEX IF NOT EXISTS idx_api_logs_user_id ON api_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_api_logs_connection_id ON api_logs(connection_id);
CREATE INDEX IF NOT EXISTS idx_api_logs_created_at ON api_logs(created_at DESC);

-- JSONB indexes
CREATE INDEX IF NOT EXISTS idx_api_logs_content ON api_logs USING GIN (content);

-- Composite indexes
CREATE INDEX IF NOT EXISTS idx_api_logs_user_created ON api_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_logs_connection_created ON api_logs(connection_id, created_at DESC);

-- migrate:down
DROP TABLE IF EXISTS api_logs;

