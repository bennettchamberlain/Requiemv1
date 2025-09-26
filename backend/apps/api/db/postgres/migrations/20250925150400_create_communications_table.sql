-- migrate:up
-- =================================================================
-- COMMUNICATIONS HYPERTABLE - SMS/EMAIL/CALL TRACKING
-- =================================================================
-- TimescaleDB hypertable for all forms of communication tracking

CREATE TABLE communications (
    time TIMESTAMPTZ NOT NULL,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, -- Note: references users(id)
    device_id UUID REFERENCES devices(device_id) ON DELETE SET NULL,
    
    -- Communication metadata
    communication_type communication_type NOT NULL,
    direction communication_direction NOT NULL,
    thread_id TEXT, -- For grouping related messages
    
    -- Participants (entity references)
    from_entity_id UUID, -- Sender's identity entity in graph
    to_entity_ids UUID[], -- Recipients' identity entities in graph
    participants_metadata JSONB DEFAULT '{}', -- Additional participant info
    
    -- Content (when available and permitted)
    subject TEXT,
    content TEXT NOT NULL,
    attachments JSONB DEFAULT '[]', -- File references
    
    -- Call-specific data
    duration_seconds INTEGER CHECK (duration_seconds >= 0),
    
    -- AI analysis
    sentiment_score DOUBLE PRECISION CHECK (sentiment_score >= -1 AND sentiment_score <= 1),
    importance_score DOUBLE PRECISION CHECK (importance_score >= 0 AND importance_score <= 1),
    urgency_score DOUBLE PRECISION CHECK (urgency_score >= 0 AND urgency_score <= 1),
    content_embedding embedding768,
    category TEXT, -- 'personal', 'work', 'spam', 'promotional', etc.
    summary TEXT,
    tags TEXT[],
    
    -- Source
    connection_id TEXT, -- Which app this came from
    
    -- Privacy
    is_encrypted BOOLEAN DEFAULT FALSE,
    is_archived BOOLEAN DEFAULT FALSE,
    
    PRIMARY KEY (time, user_id, communication_type)
);

-- Convert to TimescaleDB hypertable for time-series optimization
SELECT create_hypertable('communications', 'time', 'user_id', 4);

-- Enable compression for older data
ALTER TABLE communications SET (timescaledb.compress = true);
SELECT add_compression_policy('communications', INTERVAL '30 days');

-- Indexes for common queries
CREATE INDEX communications_thread_idx ON communications(thread_id) WHERE thread_id IS NOT NULL;
CREATE INDEX communications_from_idx ON communications(from_entity_id) WHERE from_entity_id IS NOT NULL;
CREATE INDEX communications_to_idx ON communications USING GIN (to_entity_ids) WHERE to_entity_ids IS NOT NULL;
CREATE INDEX communications_category_idx ON communications(category) WHERE category IS NOT NULL;
CREATE INDEX communications_direction_type_idx ON communications(direction, communication_type);
CREATE INDEX communications_device_idx ON communications(device_id) WHERE device_id IS NOT NULL;

-- migrate:down
-- Drop the hypertable and all related policies
DROP TABLE IF EXISTS communications;
