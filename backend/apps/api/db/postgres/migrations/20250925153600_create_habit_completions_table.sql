-- migrate:up
-- =================================================================
-- HABIT COMPLETIONS (TIME-SERIES) TABLE
-- =================================================================
-- Habit completion tracking using TimescaleDB

CREATE TABLE habit_completions (
    completion_id UUID NOT NULL DEFAULT gen_uuid_v7(),
    habit_id UUID NOT NULL REFERENCES habits(habit_id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, -- Note: references users(id)
    
    -- Completion details
    completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    value DOUBLE PRECISION, -- How much of the habit was completed
    
    -- Data quality
    confidence_score DOUBLE PRECISION DEFAULT 1.0 CHECK (confidence_score >= 0 AND confidence_score <= 1),
    source_type TEXT NOT NULL CHECK (source_type IN ('manual', 'auto_detected', 'imported', 'inferred')),
    detection_method TEXT, -- How it was auto-detected
    
    -- Context
    context JSONB DEFAULT '{}', -- Environmental/situational context
    location_coordinates GEOGRAPHY(POINT, 4326),
    activity_id UUID, -- Related activity (no FK due to TimescaleDB constraints)
    
    -- Notes and reflection
    notes TEXT,
    mood_before DOUBLE PRECISION CHECK (mood_before >= -1 AND mood_before <= 1),
    mood_after DOUBLE PRECISION CHECK (mood_after >= -1 AND mood_after <= 1),
    difficulty_rating INTEGER CHECK (difficulty_rating >= 1 AND difficulty_rating <= 5),
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Primary key for TimescaleDB hypertable
    PRIMARY KEY (user_id, completed_at, completion_id)
);

-- Convert to hypertable for time-series analysis
SELECT create_hypertable('habit_completions', 'completed_at', 'user_id', 4);
ALTER TABLE habit_completions SET (timescaledb.compress = true);

-- Indexes for habit tracking and analysis
CREATE INDEX habit_completions_id_idx ON habit_completions(completion_id);
CREATE INDEX habit_completions_habit_idx ON habit_completions(habit_id, completed_at DESC);
CREATE INDEX habit_completions_user_time_idx ON habit_completions(user_id, completed_at DESC);
CREATE INDEX habit_completions_source_idx ON habit_completions(source_type, completed_at DESC);
CREATE INDEX habit_completions_mood_idx ON habit_completions(mood_after) WHERE mood_after IS NOT NULL;
CREATE INDEX habit_completions_location_gist_idx ON habit_completions USING GIST (location_coordinates) WHERE location_coordinates IS NOT NULL;

-- Compression policy for older completions (compress after 30 days)
SELECT add_compression_policy('habit_completions', INTERVAL '30 days');

-- migrate:down
-- Drop indexes and hypertable
DROP INDEX IF EXISTS habit_completions_location_gist_idx;
DROP INDEX IF EXISTS habit_completions_mood_idx;
DROP INDEX IF EXISTS habit_completions_source_idx;
DROP INDEX IF EXISTS habit_completions_user_time_idx;
DROP INDEX IF EXISTS habit_completions_habit_idx;
DROP INDEX IF EXISTS habit_completions_id_idx;

DROP TABLE IF EXISTS habit_completions;
