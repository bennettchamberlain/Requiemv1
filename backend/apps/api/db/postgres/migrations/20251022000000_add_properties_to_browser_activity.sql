-- migrate:up
-- =================================================================
-- ADD PROPERTIES COLUMN TO BROWSER_ACTIVITY TABLE
-- =================================================================

-- Add properties column to store action-specific data (form fields, download info, search terms, etc.)
ALTER TABLE browser_activity 
ADD COLUMN properties JSONB DEFAULT '{}';

-- migrate:down
-- Remove the properties column
ALTER TABLE browser_activity 
DROP COLUMN IF EXISTS properties;
