-- migrate:up
-- =================================================================
-- VOICE RECORDINGS TABLE
-- =================================================================
-- Comprehensive voice data capture for AR glasses and other audio devices

CREATE TABLE voice_recordings (
    recording_id UUID DEFAULT gen_uuid_v7(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, -- Note: references users(id)
    device_id UUID REFERENCES devices(device_id), -- AR glasses, phone, etc.
    
    -- Temporal context
    recorded_at TIMESTAMPTZ NOT NULL,
    duration_seconds DOUBLE PRECISION NOT NULL,
    
    -- Audio file storage
    audio_file_path TEXT, -- Local file system path
    audio_format TEXT NOT NULL, -- 'wav', 'mp3', 'opus', etc.
    compression_settings JSONB, -- codec params, bitrate, etc.
    file_size_bytes BIGINT,
    audio_hash TEXT, -- For deduplication/integrity
    
    -- Speech-to-text results
    transcript TEXT,
    transcript_confidence DOUBLE PRECISION,
    stt_model TEXT, -- 'whisper-large', 'google-stt', etc.
    stt_model_version TEXT,
    stt_processed_at TIMESTAMPTZ,
    
    -- Voice characteristics (for future voice analysis)
    qualities JSONB, -- pitch, tone, speed, etc.
    
    -- Context and classification
    recording_type TEXT CHECK (recording_type IN ('thread', 'monologue', 'phone_call', 'meeting', 'note_to_self')),
    environment_noise_level TEXT, -- 'quiet', 'moderate', 'noisy'
    other_speakers_detected INTEGER DEFAULT 0,
    
    -- Privacy and processing flags
    contains_sensitive BOOLEAN DEFAULT FALSE,
    is_transcribed BOOLEAN DEFAULT FALSE,
    is_processed BOOLEAN DEFAULT FALSE, -- voice analysis complete
    
    -- Embeddings for semantic search
    transcript_embedding embedding768,
    voice_embedding embedding768, -- acoustic features for voice similarity
    
    -- Audit fields
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Primary key for TimescaleDB hypertable
    PRIMARY KEY (user_id, recorded_at, recording_id)
);

-- Convert to hypertable for time-series optimization
SELECT create_hypertable('voice_recordings', 'recorded_at', 'user_id', 4);
ALTER TABLE voice_recordings SET (timescaledb.compress = true);

-- Indexes for voice recording management and search
CREATE INDEX voice_recordings_id_idx ON voice_recordings(recording_id);
CREATE INDEX voice_recordings_user_time_idx ON voice_recordings(user_id, recorded_at DESC);
CREATE INDEX voice_recordings_device_idx ON voice_recordings(device_id) WHERE device_id IS NOT NULL;
CREATE INDEX voice_recordings_type_idx ON voice_recordings(recording_type);
CREATE INDEX voice_recordings_sensitive_idx ON voice_recordings(contains_sensitive) WHERE contains_sensitive = TRUE;
CREATE INDEX voice_recordings_transcript_fts_idx ON voice_recordings USING GIN (to_tsvector('english', transcript))
    WHERE transcript IS NOT NULL;
CREATE INDEX voice_recordings_hash_idx ON voice_recordings(audio_hash) WHERE audio_hash IS NOT NULL;
CREATE INDEX voice_recordings_duration_idx ON voice_recordings(duration_seconds) WHERE duration_seconds > 60;

-- Compression policy for older recordings (compress after 30 days)
SELECT add_compression_policy('voice_recordings', INTERVAL '30 days');

-- migrate:down
-- Drop indexes and hypertable
DROP INDEX IF EXISTS voice_recordings_duration_idx;
DROP INDEX IF EXISTS voice_recordings_hash_idx;
DROP INDEX IF EXISTS voice_recordings_transcript_fts_idx;
DROP INDEX IF EXISTS voice_recordings_sensitive_idx;
DROP INDEX IF EXISTS voice_recordings_type_idx;
DROP INDEX IF EXISTS voice_recordings_device_idx;
DROP INDEX IF EXISTS voice_recordings_user_time_idx;
DROP INDEX IF EXISTS voice_recordings_id_idx;

DROP TABLE IF EXISTS voice_recordings;
