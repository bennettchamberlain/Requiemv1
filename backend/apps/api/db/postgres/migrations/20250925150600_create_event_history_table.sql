-- migrate:up
-- =================================================================
-- SYSTEM EVENT HISTORY HYPERTABLE
-- =================================================================
-- TimescaleDB hypertable for system observability and event tracking

CREATE TABLE event_history (
    time TIMESTAMPTZ NOT NULL,
    source TEXT NOT NULL,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE, -- Note: references users(id), optional user context
    
    -- Event data
    event_type TEXT NOT NULL,
    payload JSONB NOT NULL,
    resolution TEXT CHECK (resolution IN ('success', 'error', 'timeout', 'cancelled', 'retry')),
    
    -- Tracking
    event_id UUID DEFAULT gen_uuid_v7(),
    correlation_id UUID, -- For tracing related events
    causation_id UUID, -- What caused this event
    
    -- Logging
    log_level log_level DEFAULT 'info',
    error_message TEXT,
    stack_trace TEXT,
    
    PRIMARY KEY (time, source, event_id)
);

-- Convert to TimescaleDB hypertable for time-series optimization
SELECT create_hypertable('event_history', 'time', 'source', 4);

-- Enable compression for older data
ALTER TABLE event_history SET (timescaledb.compress = true);
SELECT add_compression_policy('event_history', INTERVAL '7 days');

-- Indexes for common queries
CREATE INDEX event_history_user_idx ON event_history(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX event_history_type_idx ON event_history(event_type);
CREATE INDEX event_history_level_idx ON event_history(log_level);
CREATE INDEX event_history_resolution_idx ON event_history(resolution) WHERE resolution != 'success';
CREATE INDEX event_history_correlation_idx ON event_history(correlation_id) WHERE correlation_id IS NOT NULL;
CREATE INDEX event_history_causation_idx ON event_history(causation_id) WHERE causation_id IS NOT NULL;

-- migrate:down
-- Drop the hypertable and all related policies
DROP TABLE IF EXISTS event_history;
