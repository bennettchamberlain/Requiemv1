-- migrate:up
-- =================================================================
-- ENHANCE EXISTING USERS TABLE
-- =================================================================
-- Add CI-Database functionality to existing CI-Server users table
-- Preserves existing FK relationships and data

-- Add missing columns from CI-Database schema
ALTER TABLE users ADD COLUMN IF NOT EXISTS entity_id UUID REFERENCES entities(entity_id);
ALTER TABLE users ADD COLUMN IF NOT EXISTS username TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS settings JSONB DEFAULT '{}';
ALTER TABLE users ADD COLUMN IF NOT EXISTS api_keys JSONB DEFAULT '{}';
ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user';
ALTER TABLE users ADD COLUMN IF NOT EXISTS permissions JSONB DEFAULT '{}';
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS login_count INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_login_attempts INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS timezone TEXT DEFAULT 'UTC';
ALTER TABLE users ADD COLUMN IF NOT EXISTS language TEXT DEFAULT 'en';
ALTER TABLE users ADD COLUMN IF NOT EXISTS display_preferences JSONB DEFAULT '{}';
ALTER TABLE users ADD COLUMN IF NOT EXISTS person_entity_id UUID;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS verification_token TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS verification_expires_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id);

-- Add constraints that were in CI-Database
ALTER TABLE users ADD CONSTRAINT users_role_check 
    CHECK (role IN ('admin', 'user', 'readonly', 'api_only'));

-- Make username unique if provided
ALTER TABLE users ADD CONSTRAINT users_username_unique 
    UNIQUE (username) DEFERRABLE INITIALLY DEFERRED;

-- Update existing password column to be nullable (preserve existing data)
-- Note: keeping both 'password' and 'password_hash' for backward compatibility

-- Add new indexes for enhanced functionality
CREATE INDEX IF NOT EXISTS users_username_idx ON users(username) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS users_email_active_idx ON users(email) WHERE email IS NOT NULL AND is_active = TRUE;
CREATE INDEX IF NOT EXISTS users_api_keys_gin_idx ON users USING GIN (api_keys);
CREATE INDEX IF NOT EXISTS users_role_active_idx ON users(role, is_active);
CREATE INDEX IF NOT EXISTS users_person_entity_idx ON users(person_entity_id) WHERE person_entity_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS users_entity_idx ON users(entity_id) WHERE entity_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS users_last_login_idx ON users(last_login_at) WHERE last_login_at IS NOT NULL;

-- Update existing users to have default values for new required fields
UPDATE users SET 
    is_active = TRUE,
    role = 'user',
    login_count = 0,
    failed_login_attempts = 0,
    timezone = 'UTC',
    language = 'en',
    settings = '{}',
    api_keys = '{}',
    permissions = '{}',
    display_preferences = '{}'
WHERE is_active IS NULL OR role IS NULL;

-- migrate:down
-- Remove added indexes
DROP INDEX IF EXISTS users_last_login_idx;
DROP INDEX IF EXISTS users_entity_idx;
DROP INDEX IF EXISTS users_person_entity_idx;
DROP INDEX IF EXISTS users_role_active_idx;
DROP INDEX IF EXISTS users_api_keys_gin_idx;
DROP INDEX IF EXISTS users_email_active_idx;
DROP INDEX IF EXISTS users_username_idx;

-- Remove constraints
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_username_unique;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;

-- Remove added columns (in reverse order of dependencies)
ALTER TABLE users DROP COLUMN IF EXISTS created_by;
ALTER TABLE users DROP COLUMN IF EXISTS locked_until;
ALTER TABLE users DROP COLUMN IF EXISTS verification_expires_at;
ALTER TABLE users DROP COLUMN IF EXISTS verification_token;
ALTER TABLE users DROP COLUMN IF EXISTS is_verified;
ALTER TABLE users DROP COLUMN IF EXISTS is_active;
ALTER TABLE users DROP COLUMN IF EXISTS person_entity_id;
ALTER TABLE users DROP COLUMN IF EXISTS display_preferences;
ALTER TABLE users DROP COLUMN IF EXISTS language;
ALTER TABLE users DROP COLUMN IF EXISTS timezone;
ALTER TABLE users DROP COLUMN IF EXISTS failed_login_attempts;
ALTER TABLE users DROP COLUMN IF EXISTS login_count;
ALTER TABLE users DROP COLUMN IF EXISTS last_login_at;
ALTER TABLE users DROP COLUMN IF EXISTS permissions;
ALTER TABLE users DROP COLUMN IF EXISTS role;
ALTER TABLE users DROP COLUMN IF EXISTS api_keys;
ALTER TABLE users DROP COLUMN IF EXISTS settings;
ALTER TABLE users DROP COLUMN IF EXISTS password_hash;
ALTER TABLE users DROP COLUMN IF EXISTS username;
ALTER TABLE users DROP COLUMN IF EXISTS entity_id;
