-- migrate:up
-- =================================================================
-- ACTIVITY TRACKING TABLE
-- =================================================================
-- Life event stream and activity tracking with TimescaleDB optimization

CREATE TABLE activities (
    activity_id UUID NOT NULL DEFAULT gen_uuid_v7(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, -- Note: references users(id)
    activity_entity_id UUID REFERENCES entities(entity_id), -- Activity entity in knowledge graph
    
    -- Temporal bounds
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ,
    duration_minutes INTEGER GENERATED ALWAYS AS (
        CASE 
            WHEN end_time IS NOT NULL THEN 
                EXTRACT(EPOCH FROM (end_time - start_time)) / 60
            ELSE NULL
        END
    ) STORED,
    
    -- Activity details
    activity_name TEXT NOT NULL,
    activity_type activity_type NOT NULL,
    description TEXT,
    
    -- Location context
    location_name TEXT,
    location_coordinates GEOGRAPHY(POINT, 4326),
    location_entity_id UUID REFERENCES entities(entity_id), -- Reference to Location entity
    
    -- Participants (entity references)
    participant_entity_ids UUID[],
    participants_metadata JSONB DEFAULT '{}',
    
    -- Source and confidence
    source_type TEXT NOT NULL CHECK (source_type IN ('calendar_import', 'location_inference', 'manual', 'ETL', 'device_sync')),
    confidence_score DOUBLE PRECISION DEFAULT 1.0 CHECK (confidence_score >= 0 AND confidence_score <= 1),
    data_sources TEXT[], -- Which sources contributed to this activity detection
    
    -- AI-generated metrics
    productivity_score DOUBLE PRECISION CHECK (productivity_score >= 0 AND productivity_score <= 1),
    focus_score DOUBLE PRECISION CHECK (focus_score >= 0 AND focus_score <= 1),
    energy_level DOUBLE PRECISION CHECK (energy_level >= 0 AND energy_level <= 1),
    mood_score DOUBLE PRECISION CHECK (mood_score >= -1 AND mood_score <= 1),
    stress_level DOUBLE PRECISION CHECK (stress_level >= 0 AND stress_level <= 1),
    
    -- Semantic representation
    activity_embedding vector(768),
    
    -- Links to related data
    related_goal_ids UUID[], -- Goals this activity contributes to
    related_document_ids UUID[], -- Documents accessed during activity
    related_communication_ids UUID[], -- Communications during activity
    
    -- Metadata
    tags TEXT[],
    notes TEXT,
    is_recurring BOOLEAN DEFAULT FALSE,
    recurrence_pattern JSONB, -- If recurring, define the pattern
    
    -- Privacy
    is_private BOOLEAN DEFAULT FALSE,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Primary key for TimescaleDB hypertable
    PRIMARY KEY (user_id, start_time, activity_id)
);

-- Convert to hypertable for time-series queries
SELECT create_hypertable('activities', 'start_time', 'user_id', 4);
ALTER TABLE activities SET (timescaledb.compress = true);

-- Indexes for performance
CREATE INDEX activities_id_idx ON activities(activity_id);
CREATE INDEX activities_entity_idx ON activities(activity_entity_id) WHERE activity_entity_id IS NOT NULL;
CREATE INDEX activities_user_time_idx ON activities(user_id, start_time DESC);
CREATE INDEX activities_type_idx ON activities(activity_type, start_time DESC);
CREATE INDEX activities_location_gist_idx ON activities USING GIST (location_coordinates) WHERE location_coordinates IS NOT NULL;
CREATE INDEX activities_participants_gin_idx ON activities USING GIN (participant_entity_ids) WHERE participant_entity_ids IS NOT NULL;
CREATE INDEX activities_tags_gin_idx ON activities USING GIN (tags) WHERE tags IS NOT NULL;
CREATE INDEX activities_productivity_idx ON activities(productivity_score DESC) WHERE productivity_score IS NOT NULL;

-- Compression policy for older activities (compress after 30 days)
SELECT add_compression_policy('activities', INTERVAL '30 days');

-- migrate:down
-- Drop indexes and hypertable
DROP INDEX IF EXISTS activities_productivity_idx;
DROP INDEX IF EXISTS activities_tags_gin_idx;
DROP INDEX IF EXISTS activities_participants_gin_idx;
DROP INDEX IF EXISTS activities_location_gist_idx;
DROP INDEX IF EXISTS activities_type_idx;
DROP INDEX IF EXISTS activities_user_time_idx;
DROP INDEX IF EXISTS activities_entity_idx;
DROP INDEX IF EXISTS activities_id_idx;

DROP TABLE IF EXISTS activities;
