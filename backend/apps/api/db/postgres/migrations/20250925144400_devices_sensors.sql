-- migrate:up
-- =================================================================
-- DEVICE AND SENSOR TABLES
-- =================================================================

-- Physical and virtual devices owned by users
CREATE TABLE devices (
    device_id UUID PRIMARY KEY DEFAULT gen_uuid_v7(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_entity_id UUID, -- Reference to Device entity in graph
    
    -- Device identification
    device_name TEXT NOT NULL,
    device_type TEXT NOT NULL, -- CHECK (device_type IN ('smartphone', 'laptop', 'desktop', 'tablet', 'smartwatch', 'smart_speaker', 'iot_sensor', 'browser')),
    
    -- Device details
    platform TEXT, -- 'ios', 'android', 'windows', 'macos', 'linux', 'web'
    model TEXT,
    manufacturer TEXT,
    os_version TEXT,
    app_version TEXT,
    
    -- Connection and status
    last_seen TIMESTAMPTZ DEFAULT NOW(),
    is_active BOOLEAN DEFAULT TRUE,
    is_primary BOOLEAN DEFAULT FALSE,
    push_token TEXT, -- For notifications
    
    -- Capabilities and permissions
    capabilities JSONB DEFAULT '{}', -- What this device can do
    privacy_settings JSONB DEFAULT '{}', -- What data can be collected
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Ensure only one primary device per user (using partial unique index)
CREATE UNIQUE INDEX devices_one_primary_per_user_idx ON devices (user_id) 
    WHERE is_primary = TRUE;

-- Smart home and environmental sensors
CREATE TABLE sensors (
    sensor_id UUID PRIMARY KEY DEFAULT gen_uuid_v7(),
    device_id UUID NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE, -- Required link to parent device
    sensor_entity_id UUID, -- Reference to Sensor entity in graph
    
    -- Sensor identification
    sensor_name TEXT NOT NULL,
    sensor_type TEXT NOT NULL, -- 'temperature', 'humidity', 'motion', 'light', 'air_quality', etc.
    
    -- Location
    semantic_location TEXT, -- 'Living Room', 'Kitchen', 'Bedroom'
    physical_location GEOGRAPHY(POINT, 4326), -- PostGIS point, nullable
    location_description TEXT,
    
    -- Capabilities
    measurement_types JSONB NOT NULL, -- What this sensor measures
    measurement_units JSONB, -- Units for each measurement type
    sampling_rate_hz DOUBLE PRECISION, -- How often it samples
    
    -- Device information
    device_info JSONB DEFAULT '{}', -- Model, firmware, etc.
    calibration_data JSONB DEFAULT '{}',
    
    -- Status
    is_active BOOLEAN DEFAULT TRUE,
    last_reading_at TIMESTAMPTZ,
    battery_level DOUBLE PRECISION CHECK (battery_level >= 0 AND battery_level <= 100),
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX devices_user_idx ON devices(user_id);
CREATE INDEX devices_entity_idx ON devices(device_entity_id) WHERE device_entity_id IS NOT NULL;
CREATE INDEX sensors_device_idx ON sensors(device_id);
CREATE INDEX sensors_entity_idx ON sensors(sensor_entity_id) WHERE sensor_entity_id IS NOT NULL;
CREATE INDEX sensors_location_idx ON sensors USING GIST (physical_location) WHERE physical_location IS NOT NULL;

-- migrate:down
-- Drop indexes first  
DROP INDEX IF EXISTS sensors_location_idx;
DROP INDEX IF EXISTS sensors_entity_idx;
DROP INDEX IF EXISTS sensors_device_idx;
DROP INDEX IF EXISTS devices_entity_idx;
DROP INDEX IF EXISTS devices_user_idx;
DROP INDEX IF EXISTS devices_one_primary_per_user_idx;

-- Drop tables (sensors first due to FK dependency)
DROP TABLE IF EXISTS sensors;
DROP TABLE IF EXISTS devices;
