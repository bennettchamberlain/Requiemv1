-- migrate:up
-- =================================================================
-- SENSOR MEASUREMENTS HYPERTABLE
-- =================================================================
-- TimescaleDB hypertable for unified sensor data from all devices and sensors

CREATE TABLE measurements (
    time TIMESTAMPTZ NOT NULL,
    sensor_id UUID NOT NULL REFERENCES sensors(sensor_id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, -- Note: references users(id)
    
    -- Measurement details
    measurement_type TEXT NOT NULL, -- 'heart_rate', 'steps', 'temperature', 'humidity', etc.
    value DOUBLE PRECISION NOT NULL,
    units TEXT NOT NULL,
    calculated BOOLEAN DEFAULT FALSE,
    
    -- Data quality and context
    confidence_score DOUBLE PRECISION DEFAULT 1.0 CHECK (confidence_score >= 0 AND confidence_score <= 1),
    raw_data JSONB DEFAULT '{}', -- Raw sensor reading for debugging
    context JSONB DEFAULT '{}', -- Activity context, environmental conditions, etc.
    
    PRIMARY KEY (user_id, time, sensor_id, measurement_type)
);

-- Convert to TimescaleDB hypertable with user-based partitioning for optimal query performance
SELECT create_hypertable('measurements', 'time', 'user_id', 4);

-- Enable compression for older data
ALTER TABLE measurements SET (timescaledb.compress = true);
SELECT add_compression_policy('measurements', INTERVAL '7 days');

-- Indexes for common query patterns
CREATE INDEX measurements_user_time_idx ON measurements (user_id, time DESC);
CREATE INDEX measurements_sensor_type_idx ON measurements (sensor_id, measurement_type, time DESC);
CREATE INDEX measurements_type_time_idx ON measurements (measurement_type, time DESC);
CREATE INDEX measurements_sensor_idx ON measurements (sensor_id, time DESC);
CREATE INDEX measurements_calculated_idx ON measurements (calculated, measurement_type) WHERE calculated = TRUE;

-- migrate:down
-- Drop the hypertable and all related policies
DROP TABLE IF EXISTS measurements;
