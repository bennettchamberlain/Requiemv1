-- migrate:up
-- =================================================================
-- ADD POSITION FIELDS FOR BULK IMPORT
-- =================================================================
-- Add fields from iOS position format to support unified position type

ALTER TABLE position
    ADD COLUMN IF NOT EXISTS speed_meters_per_second DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS address TEXT,
    ADD COLUMN IF NOT EXISTS city TEXT,
    ADD COLUMN IF NOT EXISTS region TEXT,
    ADD COLUMN IF NOT EXISTS country TEXT,
    ADD COLUMN IF NOT EXISTS postal_code TEXT,
    ADD COLUMN IF NOT EXISTS name TEXT,
    ADD COLUMN IF NOT EXISTS description TEXT,
    ADD COLUMN IF NOT EXISTS provider TEXT;

-- migrate:down
ALTER TABLE position
    DROP COLUMN IF EXISTS speed_meters_per_second,
    DROP COLUMN IF EXISTS address,
    DROP COLUMN IF EXISTS city,
    DROP COLUMN IF EXISTS region,
    DROP COLUMN IF EXISTS country,
    DROP COLUMN IF EXISTS postal_code,
    DROP COLUMN IF EXISTS name,
    DROP COLUMN IF EXISTS description,
    DROP COLUMN IF EXISTS provider;

