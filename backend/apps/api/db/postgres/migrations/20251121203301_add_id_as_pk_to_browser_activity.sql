-- migrate:up
ALTER TABLE browser_activity DROP CONSTRAINT IF EXISTS browser_activity_pkey;
DROP INDEX IF EXISTS browser_activity_time_idx;
DROP INDEX IF EXISTS browser_activity_user_id_time_idx;
ALTER TABLE browser_activity ADD COLUMN id UUID DEFAULT gen_uuid_v7();

-- migrate:down
ALTER TABLE browser_activity DROP CONSTRAINT IF EXISTS browser_activity_pkey;
DROP INDEX IF EXISTS browser_activity_pkey;
ALTER TABLE browser_activity DROP COLUMN id;
ALTER TABLE browser_activity ADD CONSTRAINT browser_activity_pkey UNIQUE(time, user_id, device_id);
SELECT create_hypertable('browser_activity', 'time', 'user_id', 4);
