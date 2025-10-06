-- =================================================================
-- PGBOSS SCHEMA SETUP
-- =================================================================
-- This migration creates the pgboss schema for job queue functionality
-- PGBoss will auto-create its tables when the EventService starts

-- migrate:up
-- Create the pgboss schema
CREATE SCHEMA IF NOT EXISTS pgboss;

-- Grant necessary permissions to the current user
-- The schema will be owned by the user running the migration

-- migrate:down
-- Drop the pgboss schema and all its contents
DROP SCHEMA IF EXISTS pgboss CASCADE;
