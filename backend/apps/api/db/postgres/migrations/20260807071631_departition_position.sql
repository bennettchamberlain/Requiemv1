-- migrate:up
-- Hypertable-audit workstream step 1 (docs/architecture/hypertable-audit.md):
-- rebuild ci.position as a time-only hypertable. The original
-- create_hypertable('position', 'time', 'user_id', 4) space-partitioned a
-- 1-5 user appliance across 4 hash buckets, multiplying
-- chunk count 4x for no possible upside. The rebuild also covers workstream
-- step 3 for this table: 25 years of backfilled GPS history on the default
-- 7-day chunk_time_interval means ~1,300 time chunks; a 1-month interval lands
-- near 300. Same rename/copy/swap shape as
-- 20260104075933_departition_browser_activity, except the replacement stays a
-- hypertable (GPS is a genuine machine-generated time-range stream) and every
-- secondary index IS re-created (the browser_activity template recreated none,
-- which the hypertable audit flags as a mistake not to repeat).

-- 1. Rename the existing table aside. Secondary-index names stay attached to
--    it and die with the DROP; only the PK must be renamed, because a PK is
--    backed by an index and index names are schema-wide.
ALTER TABLE ci.position RENAME TO position_partitioned_backup;
ALTER TABLE ci.position_partitioned_backup RENAME CONSTRAINT position_pkey TO position_backup_pkey;

-- 2. The replacement: the current live schema (the original table, minus the
--    location_embedding dropped in 20260213113000, plus the 20251111 bulk
--    import fields, the 20251205 id column, and the 20260707 provenance
--    triple), identical PK.
CREATE TABLE ci.position (
    time TIMESTAMPTZ NOT NULL,
    user_id UUID NOT NULL REFERENCES ci.users(id) ON DELETE CASCADE,
    device_id UUID REFERENCES ci.devices(device_id) ON DELETE SET NULL,

    location public.GEOGRAPHY(POINT, 4326),
    altitude_meters DOUBLE PRECISION,

    accuracy_meters DOUBLE PRECISION CHECK (accuracy_meters > 0),
    hdop DOUBLE PRECISION,
    vdop DOUBLE PRECISION,

    heading_degrees DOUBLE PRECISION CHECK (heading_degrees >= 0 AND heading_degrees <= 360),
    speed_meters_per_second DOUBLE PRECISION,

    source ci.location_source NOT NULL,
    activity_type TEXT,

    location_entity_id UUID REFERENCES ci.entities(entity_id) ON DELETE SET NULL,

    reference_entity_id UUID REFERENCES ci.entities(entity_id) ON DELETE SET NULL,
    relative_coordinates JSONB DEFAULT '{}',
    relative_orientation JSONB DEFAULT '{}',

    is_private BOOLEAN DEFAULT FALSE,

    address TEXT,
    city TEXT,
    region TEXT,
    country TEXT,
    postal_code TEXT,
    name TEXT,
    description TEXT,
    provider TEXT,

    id UUID,

    source_type TEXT,
    source_system TEXT,
    source_id TEXT,

    PRIMARY KEY (time, user_id),

    CONSTRAINT valid_positioning CHECK (
        (location IS NOT NULL) OR
        (reference_entity_id IS NOT NULL AND relative_coordinates IS NOT NULL AND relative_coordinates != '{}' AND relative_coordinates ? 'x')
    )
);

-- Time-only partitioning; see the header for the interval rationale.
SELECT create_hypertable('ci.position', 'time', chunk_time_interval => INTERVAL '1 month');

-- Same compression posture as before (compress after 7 days).
ALTER TABLE ci.position SET (timescaledb.compress = true);
SELECT add_compression_policy('ci.position', INTERVAL '7 days');

-- 3. Copy. Compressed chunks decompress transparently on read.
INSERT INTO ci.position (
    time, user_id, device_id, location, altitude_meters, accuracy_meters,
    hdop, vdop, heading_degrees, speed_meters_per_second, source,
    activity_type, location_entity_id, reference_entity_id,
    relative_coordinates, relative_orientation, is_private, address, city,
    region, country, postal_code, name, description, provider, id,
    source_type, source_system, source_id
)
SELECT
    time, user_id, device_id, location, altitude_meters, accuracy_meters,
    hdop, vdop, heading_degrees, speed_meters_per_second, source,
    activity_type, location_entity_id, reference_entity_id,
    relative_coordinates, relative_orientation, is_private, address, city,
    region, country, postal_code, name, description, provider, id,
    source_type, source_system, source_id
FROM ci.position_partitioned_backup;

-- 4. Drop the old table (and with it the old chunks, its indexes, and its
--    compression policy job).
DROP TABLE ci.position_partitioned_backup;

-- The new table's auto-named constraints (FKs, checks, NOT NULLs) landed with
-- a "1" suffix because the namer avoided the backup table's names. Reclaim
-- the canonical names now that the backup is gone.
DO $$
DECLARE c record;
BEGIN
    FOR c IN
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'ci.position'::regclass
          AND conname ~ '(_check|_fkey|_not_null)1$'
    LOOP
        EXECUTE format('ALTER TABLE ci.position RENAME CONSTRAINT %I TO %I', c.conname, left(c.conname, -1));
    END LOOP;
END $$;

-- 5. Secondary indexes, built once, after the bulk copy. The first seven
--    mirror the old table's set; position_user_id_time_idx replaces the
--    (user_id, time DESC) index the space dimension auto-created — without a
--    space dimension create_hypertable only auto-creates (time DESC), and the
--    per-user time-range scan is this table's hot read path.
CREATE INDEX position_location_idx ON ci.position USING GIST (location) WHERE location IS NOT NULL;
CREATE INDEX position_entity_idx ON ci.position (location_entity_id) WHERE location_entity_id IS NOT NULL;
CREATE INDEX position_device_idx ON ci.position (device_id) WHERE device_id IS NOT NULL;
CREATE INDEX position_source_idx ON ci.position (source);
CREATE INDEX position_activity_idx ON ci.position (activity_type) WHERE activity_type IS NOT NULL;
CREATE INDEX position_reference_idx ON ci.position (reference_entity_id) WHERE reference_entity_id IS NOT NULL;
CREATE INDEX position_source_triple_idx ON ci.position (user_id, source_type, source_system, source_id) WHERE source_id IS NOT NULL;
CREATE INDEX position_user_id_time_idx ON ci.position (user_id, time DESC);

-- create_hypertable ran while the backup still owned the name
-- position_time_idx, so its auto-created time index landed as
-- position_time_idx1. Reclaim the canonical name now that the backup is gone.
ALTER INDEX ci.position_time_idx1 RENAME TO position_time_idx;

-- migrate:down
-- One-way, like 20260104075933_departition_browser_activity: recreating the
-- space partition would re-introduce the misconfiguration on purpose.
