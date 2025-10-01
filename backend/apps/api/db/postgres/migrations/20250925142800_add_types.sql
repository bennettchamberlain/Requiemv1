-- migrate:up
-- =================================================================
-- ENUM TYPES AND DOMAINS
-- =================================================================

-- Ensure vector extension is available in this context
CREATE EXTENSION IF NOT EXISTS vector;

-- User privacy levels
CREATE TYPE privacy_level AS ENUM (
    'minimal',
    'standard',
    'full'
);

-- Communication types
CREATE TYPE communication_type AS ENUM (
    'email',
    'sms',
    'call',
    'chat',
    'video_call',
    'voice_note',
    'post'
);

-- Communication direction
CREATE TYPE communication_direction AS ENUM (
    'inbound',
    'outbound',
    'internal',
    'async',
    'ongoing'
);

-- Agent types
CREATE TYPE agent_type AS ENUM (
    'n8n_workflow',
    'python_script',
    'llm_agent',
    'external_api',
    'scheduled_task',
    'browser_use',
    'other'
);

-- Agent status
CREATE TYPE agent_status AS ENUM (
    'queued',
    'running',
    'paused',
    'completed',
    'failed',
    'expired',
    'cancelled',
    'anomalous_completion'
);

-- Activity types
CREATE TYPE activity_type AS ENUM (
    'work',
    'personal',
    'health',
    'social',
    'travel',
    'entertainment',
    'education',
    'maintenance',
    'exploration',
    'other'
);

-- Location source types
CREATE TYPE location_source AS ENUM (
    'gps',
    'wifi',
    'cell_tower',
    'manual',
    'inferred',
    'other'
);

-- Document content types
CREATE TYPE document_content_type AS ENUM (
    'pdf',
    'text',
    'email',
    'webpage',
    'note',
    'image',
    'spreadsheet',
    'presentation',
    'audio',
    'video',
    'code',
    'database',
    'other'
);

-- Access levels
CREATE TYPE access_level AS ENUM (
    'private',
    'family',
    'trusted',
    'shared',
    'public'
);

-- Log levels
CREATE TYPE log_level AS ENUM (
    'trace',
    'debug',
    'info',
    'warn',
    'error',
    'fatal'
);

-- thread status
CREATE TYPE thread_status AS ENUM (
    'active',
    'paused',
    'completed',
    'archived'
);

-- Message role types
CREATE TYPE message_role AS ENUM (
    'user',
    'assistant',
    'system',
    'tool',
    'thinking'
);


-- UUID v7 Generation Function
CREATE OR REPLACE FUNCTION gen_uuid_v7()
RETURNS UUID AS $$
BEGIN
    RETURN uuid_generate_v7();
EXCEPTION
    WHEN undefined_function THEN
        RETURN gen_random_uuid();
END;
$$ LANGUAGE plpgsql;


-- migrate:down
-- =================================================================
-- REVERT: ENUM TYPES, DOMAINS, AND FUNCTIONS
-- =================================================================

-- Drop the function first
DROP FUNCTION IF EXISTS gen_uuid_v7();

-- Drop the custom domain
DROP DOMAIN IF EXISTS embedding768;

-- Drop all the ENUM types
DROP TYPE IF EXISTS message_role;
DROP TYPE IF EXISTS thread_status;
DROP TYPE IF EXISTS log_level;
DROP TYPE IF EXISTS access_level;
DROP TYPE IF EXISTS document_content_type;
DROP TYPE IF EXISTS location_source;
DROP TYPE IF EXISTS activity_type;
DROP TYPE IF EXISTS agent_status;
DROP TYPE IF EXISTS agent_type;
DROP TYPE IF EXISTS communication_direction;
DROP TYPE IF EXISTS communication_type;
DROP TYPE IF EXISTS privacy_level;