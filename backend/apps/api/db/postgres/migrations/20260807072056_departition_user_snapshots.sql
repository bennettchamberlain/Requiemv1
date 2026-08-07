-- migrate:up
-- Hypertable-audit workstream step 1 (docs/architecture/hypertable-audit.md):
-- rebuild ci.user_snapshots as a time-only hypertable, dropping the 4-way
-- user_id space partition (4 hash
-- buckets over a 1-5 user appliance — permanently near-empty buckets, 4x the
-- chunks). Workstream step 3 for this table: the chunk_time_interval stays at
-- 7 days, now stated explicitly — device telemetry accumulates forward from
-- the install date, so the forward-accumulation default is actually right
-- here, unlike the backfilled tables. Same rename/copy/swap shape as
-- 20260807071631_departition_position.

-- 1. Rename the existing table aside; only the PK needs a rename (its backing
--    index name is schema-wide), secondary-index names die with the DROP.
ALTER TABLE ci.user_snapshots RENAME TO user_snapshots_partitioned_backup;
ALTER TABLE ci.user_snapshots_partitioned_backup RENAME CONSTRAINT user_snapshots_pkey TO user_snapshots_backup_pkey;

-- 2. The replacement: identical schema and PK, minus the space dimension.
CREATE TABLE ci.user_snapshots (
    snapshot_id UUID NOT NULL,
    observed_at TIMESTAMPTZ NOT NULL,
    user_id UUID NOT NULL REFERENCES ci.users(id) ON DELETE CASCADE,
    device_id UUID NOT NULL REFERENCES ci.devices(device_id) ON DELETE CASCADE,
    session_id UUID NOT NULL,
    producer TEXT NOT NULL,
    snapshot_kind TEXT NOT NULL CHECK (snapshot_kind IN ('snapshot', 'patch')),
    monotonic_ms BIGINT NOT NULL,
    payload JSONB NOT NULL,
    focus_app TEXT,
    focus_title TEXT,
    cwd TEXT,
    fs_event_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (snapshot_id, observed_at, user_id)
);

SELECT create_hypertable('ci.user_snapshots', 'observed_at', chunk_time_interval => INTERVAL '7 days');

-- Same compression posture as 20260423150000 (segment by the capture stream,
-- compress after 14 days).
ALTER TABLE ci.user_snapshots
    SET (
        timescaledb.compress,
        timescaledb.compress_segmentby = 'user_id, device_id, producer, snapshot_kind',
        timescaledb.compress_orderby = 'observed_at DESC'
    );

SELECT add_compression_policy('ci.user_snapshots', INTERVAL '14 days');

-- 3. Copy. Compressed chunks decompress transparently on read.
INSERT INTO ci.user_snapshots (
    snapshot_id, observed_at, user_id, device_id, session_id, producer,
    snapshot_kind, monotonic_ms, payload, focus_app, focus_title, cwd,
    fs_event_count, created_at
)
SELECT
    snapshot_id, observed_at, user_id, device_id, session_id, producer,
    snapshot_kind, monotonic_ms, payload, focus_app, focus_title, cwd,
    fs_event_count, created_at
FROM ci.user_snapshots_partitioned_backup;

-- 4. Drop the old table (and its chunks, indexes, and compression job).
DROP TABLE ci.user_snapshots_partitioned_backup;

-- The new table's auto-named constraints (FKs, checks, NOT NULLs) landed with
-- a "1" suffix because the namer avoided the backup table's names. Reclaim
-- the canonical names now that the backup is gone.
DO $$
DECLARE c record;
BEGIN
    FOR c IN
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'ci.user_snapshots'::regclass
          AND conname ~ '(_check|_fkey|_not_null)1$'
    LOOP
        EXECUTE format('ALTER TABLE ci.user_snapshots RENAME CONSTRAINT %I TO %I', c.conname, left(c.conname, -1));
    END LOOP;
END $$;

-- 5. Secondary indexes, built once after the copy — the old table's set, plus
--    an explicit (user_id, observed_at DESC) to replace the one the space
--    dimension auto-created (user_snapshots_user_kind_time_idx leads with
--    user_id but interposes snapshot_kind, so it does not cover a plain
--    per-user time-range scan).
CREATE INDEX user_snapshots_device_time_idx
    ON ci.user_snapshots (device_id, observed_at DESC);

CREATE INDEX user_snapshots_session_time_idx
    ON ci.user_snapshots (session_id, observed_at DESC);

CREATE INDEX user_snapshots_user_kind_time_idx
    ON ci.user_snapshots (user_id, snapshot_kind, observed_at DESC);

CREATE INDEX user_snapshots_payload_gin_idx
    ON ci.user_snapshots USING GIN (payload);

CREATE INDEX user_snapshots_user_id_observed_at_idx
    ON ci.user_snapshots (user_id, observed_at DESC);

-- create_hypertable ran while the backup still owned
-- user_snapshots_observed_at_idx, so the auto time index landed with a "1"
-- suffix. Reclaim the canonical name now that the backup is gone.
ALTER INDEX ci.user_snapshots_observed_at_idx1 RENAME TO user_snapshots_observed_at_idx;

-- migrate:down
-- One-way, like 20260104075933_departition_browser_activity: recreating the
-- space partition would re-introduce the misconfiguration on purpose.
