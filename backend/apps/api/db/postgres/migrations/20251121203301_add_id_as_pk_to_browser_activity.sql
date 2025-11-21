-- migrate:up
ALTER TABLE browser_activity DROP CONSTRAINT IF EXISTS browser_activity_pkey;
DROP INDEX IF EXISTS browser_activity_time_idx;
DROP INDEX IF EXISTS browser_activity_user_id_time_idx;
DO $$
DECLARE
    hyperid INT;
    chunkids INT[];
    chunkid INT;
BEGIN
    hyperid := (SELECT id FROM _timescaledb_catalog.hypertable WHERE table_name = 'browser_activity');
    chunkids := ARRAY(SELECT id FROM _timescaledb_catalog.chunk WHERE hypertable_id = hyperid);
    FOREACH chunkid IN ARRAY chunkids LOOP
        EXECUTE 'DELETE FROM _timescaledb_catalog.chunk_constraint WHERE chunk_id = ' || chunkid;
    END LOOP;
    EXECUTE 'DELETE FROM _timescaledb_catalog.chunk where hypertable_id = ' || hyperid;
    EXECUTE 'DELETE FROM _timescaledb_catalog.hypertable WHERE id = ' || hyperid;
    EXECUTE 'ALTER TABLE browser_activity ADD COLUMN id UUID PRIMARY KEY DEFAULT gen_uuid_v7()';
END $$;

-- migrate:down
ALTER TABLE browser_activity DROP CONSTRAINT IF EXISTS browser_activity_pkey;
DROP INDEX IF EXISTS browser_activity_pkey;
ALTER TABLE browser_activity DROP COLUMN id;
ALTER TABLE browser_activity ADD CONSTRAINT browser_activity_pkey UNIQUE(time, user_id, device_id);
SELECT create_hypertable('browser_activity', 'time', 'user_id', 4);
