-- migrate:up
-- =================================================================
-- POSITION/GPS TRACKING HYPERTABLE
-- =================================================================
-- TimescaleDB hypertable for location and GPS tracking with PostGIS spatial support

CREATE TABLE position (
    time TIMESTAMPTZ NOT NULL,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, -- Note: references users(id)
    device_id UUID REFERENCES devices(device_id) ON DELETE SET NULL,
    
    -- Spatial data (PostGIS) - now nullable to support relative positioning
    location GEOGRAPHY(POINT, 4326),
    altitude_meters DOUBLE PRECISION,
    
    -- Accuracy and quality
    accuracy_meters DOUBLE PRECISION CHECK (accuracy_meters > 0),
    hdop DOUBLE PRECISION, -- Horizontal dilution of precision
    vdop DOUBLE PRECISION, -- Vertical dilution of precision
    
    -- Movement data
    heading_degrees DOUBLE PRECISION CHECK (heading_degrees >= 0 AND heading_degrees <= 360),
    
    -- Source and context
    source location_source NOT NULL,
    activity_type TEXT, -- 'walking', 'driving', 'stationary', 'running', 'cycling'
    
    -- Semantic location (linked to entity)
    location_entity_id UUID, -- Reference to Location entity in our graph
    
    -- Relative positioning support
    reference_entity_id UUID, -- Link to a location entity that serves as the reference point
    relative_coordinates JSONB DEFAULT '{}', -- Store relative position (x, y, z) offsets
    relative_orientation JSONB DEFAULT '{}', -- Store orientation (phi, theta, etc.)
    
    -- Vector embedding for semantic location context
    location_embedding vector(768),
    
    -- Privacy
    is_private BOOLEAN DEFAULT FALSE, -- Should this location be hidden from certain analyses
    
    PRIMARY KEY (time, user_id),
    
    -- Ensure either absolute location or relative positioning is provided
    CONSTRAINT valid_positioning CHECK (
        (location IS NOT NULL) OR 
        (reference_entity_id IS NOT NULL AND relative_coordinates IS NOT NULL AND relative_coordinates != '{}' AND relative_coordinates ? 'x')
    )
);

-- Convert to TimescaleDB hypertable
SELECT create_hypertable('position', 'time', 'user_id', 4);

-- Enable compression for older data
ALTER TABLE position SET (timescaledb.compress = true);
SELECT add_compression_policy('position', INTERVAL '7 days');

-- Spatial and performance indexes
CREATE INDEX position_location_idx ON position USING GIST (location) WHERE location IS NOT NULL;
CREATE INDEX position_entity_idx ON position(location_entity_id) WHERE location_entity_id IS NOT NULL;
CREATE INDEX position_device_idx ON position(device_id) WHERE device_id IS NOT NULL;
CREATE INDEX position_source_idx ON position(source);
CREATE INDEX position_activity_idx ON position(activity_type) WHERE activity_type IS NOT NULL;
CREATE INDEX position_reference_idx ON position(reference_entity_id) WHERE reference_entity_id IS NOT NULL;

-- Add foreign key constraints (entities table exists from earlier migration)
ALTER TABLE position 
    ADD CONSTRAINT position_location_entity_fk 
    FOREIGN KEY (location_entity_id) REFERENCES entities(entity_id) ON DELETE SET NULL;

ALTER TABLE position 
    ADD CONSTRAINT position_reference_entity_fk 
    FOREIGN KEY (reference_entity_id) REFERENCES entities(entity_id) ON DELETE SET NULL;

-- migrate:down
-- Drop the hypertable and all related policies
DROP TABLE IF EXISTS position;
