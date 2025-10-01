-- migrate:up
-- =================================================================
-- REPLACE EVENTS TABLE WITH COMPREHENSIVE VERSION  
-- =================================================================
-- Handle dependencies properly before dropping events table

-- First, drop dependent objects that reference events.id
DROP TABLE IF EXISTS event_person CASCADE;
DROP TABLE IF EXISTS event_tag CASCADE;

-- Drop the existing simple events table
DROP TABLE IF EXISTS events CASCADE;

-- Create comprehensive events table from CI-Database (adapted for existing FK structure)
CREATE TABLE events (
    event_id UUID PRIMARY KEY DEFAULT gen_uuid_v7(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, -- Note: references users(id)
    event_entity_id UUID, -- Reference to Event entity in knowledge graph
    
    -- Temporal bounds - core to all events
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ,
    duration_minutes INTEGER GENERATED ALWAYS AS (
        CASE 
            WHEN end_time IS NULL THEN NULL
            ELSE EXTRACT(epoch FROM (end_time - start_time)) / 60
        END
    ) STORED,
    
    -- Event identification and classification
    title TEXT NOT NULL,
    description TEXT,
    event_type TEXT, -- Broad type: 'meeting', 'appointment', 'workout', 'meal', 'travel', 'reminder'
    category TEXT, -- More specific than type: 'doctor_visit', 'team_standup', 'gym_workout'
    
    -- Location context
    location_name TEXT,
    location_coordinates GEOGRAPHY(POINT, 4326),
    location_entity_id UUID, -- Reference to Location entity
    
    -- Participants and relationships
    participant_entity_ids UUID[], -- References to Person entities
    organizer_entity_id UUID, -- Who organized/initiated this event
    
    -- Event source and confidence
    source_type TEXT, -- 'calendar_import', 'sensor_inference', 'manual_entry', 'predicted', 'ETL'
    source_system TEXT, -- 'google_calendar', 'proton_calendar', 'heart_rate_sensor', 'gps_tracker'
    source_id TEXT, -- External system's ID for this event
    confidence_score DOUBLE PRECISION DEFAULT 1.0 CHECK (confidence_score >= 0 AND confidence_score <= 1),
    
    -- Event properties and metadata
    is_recurring BOOLEAN DEFAULT FALSE,
    recurrence_pattern JSONB, -- RRULE-like data for recurring events
    is_all_day BOOLEAN DEFAULT FALSE,
    is_private BOOLEAN DEFAULT FALSE,
    priority INTEGER DEFAULT 0 CHECK (priority >= 0 AND priority <= 10),
    metadata JSONB DEFAULT '{}', -- Additional arbitrary metadata
    
    -- Prediction and inference metadata
    is_predicted BOOLEAN DEFAULT FALSE, -- Future event predicted by ML
    is_inferred BOOLEAN DEFAULT FALSE, -- Past event inferred from data
    prediction_model TEXT, -- Which model made the prediction
    inference_sources JSONB DEFAULT '{}', -- What data sources led to inference
    
    -- Semantic analysis
    tags TEXT[], -- User or system generated tags
    event_embedding vector(768), -- Semantic representation for similarity
    sentiment_score DOUBLE PRECISION CHECK (sentiment_score >= -1 AND sentiment_score <= 1),
    energy_level INTEGER CHECK (energy_level >= 1 AND energy_level <= 10),
    productivity_impact DOUBLE PRECISION, -- How this affects user productivity
    
    -- Status and lifecycle
    status TEXT DEFAULT 'confirmed' CHECK (status IN (
        'tentative', 'confirmed', 'cancelled', 'completed', 'no_show', 'rescheduled'
    )),
    is_deleted BOOLEAN DEFAULT FALSE,
    external_sync_status TEXT CHECK (external_sync_status IN ('synced', 'pending', 'failed', 'not_synced')),
    last_synced_at TIMESTAMPTZ,
    
    -- Relationships to other events
    parent_event_id UUID, -- For sub-events or follow-ups (circular ref handled in app logic)
    related_event_ids UUID[], -- Related events
    supersedes_event_id UUID, -- This event replaces another
    
    -- Audit and tracking
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by TEXT, -- System or user that created this event
    
    -- Constraints
    CONSTRAINT valid_time_range CHECK (end_time IS NULL OR start_time <= end_time),
    CONSTRAINT valid_prediction_inference CHECK (NOT (is_predicted = TRUE AND is_inferred = TRUE))
);

-- Add basic indexes for performance
CREATE INDEX events_user_time_idx ON events(user_id, start_time DESC);
CREATE INDEX events_type_category_idx ON events(event_type, category) WHERE is_deleted = FALSE;
CREATE INDEX events_status_idx ON events(status) WHERE status != 'completed';
CREATE INDEX events_source_idx ON events(source_type, source_system);

-- migrate:down
-- Revert back to simple events table structure  
DROP TABLE IF EXISTS events CASCADE;

CREATE TABLE events (
    id UUID PRIMARY KEY,
    type TEXT,
    name TEXT,
    description TEXT,
    start_time TIMESTAMPTZ,
    end_time TIMESTAMPTZ,
    external_id TEXT,
    source_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Recreate the linking tables that were dropped
CREATE TABLE event_person (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_id UUID REFERENCES events(id) NOT NULL,
    person_id UUID REFERENCES people(id) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE event_tag (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_id UUID REFERENCES events(id) NOT NULL,
    tag_id UUID REFERENCES tags(id) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
