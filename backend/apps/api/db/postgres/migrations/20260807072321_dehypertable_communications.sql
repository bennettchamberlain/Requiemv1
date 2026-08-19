-- migrate:up
-- Hypertable-audit workstream step 5 (docs/architecture/hypertable-audit.md):
-- convert ci.communications from a TimescaleDB hypertable to a plain table.
--
-- The full case is in docs/architecture/hypertable-audit.md; the short
-- version: the table's idempotency key is the provenance triple, and
-- TimescaleDB hard-rejects any
-- UNIQUE index that omits a partition column, which forced `time` into the
-- key. The importer's `time` is not stable across re-syncs, so two sweeps
-- minted 35,018 duplicate rows (see 20260702012519), and the fix had to move
-- the invariant onto a companion table (ci.communications_source_dedup) held
-- consistent by application code. A plain table enforces the real key
-- directly, so the companion table, its delete-trigger, and the bespoke
-- claim logic in CommunicationService.createMany all retire. On scale the
-- hypertable never earned its keep either: ~1.5 GB at 1M rows, no retention
-- policy (a personal archive never ages out), and 4 of its 6 hot indexes are
-- point lookups that cannot exclude chunks.
--
-- Same rename/copy/swap shape as 20260104075933_departition_browser_activity
-- (the structural twin of this table, fixed the same way in January), except
-- every secondary index is recreated — the template recreated none, which
-- the hypertable audit flags as a mistake not to repeat.

-- 1. Rename the existing table aside; only the PK must be renamed (its
--    backing index name is schema-wide), check-constraint names are
--    per-table, and secondary-index names die with the DROP.
ALTER TABLE ci.communications RENAME TO communications_hypertable_backup;
ALTER TABLE ci.communications_hypertable_backup RENAME CONSTRAINT communications_pkey TO communications_backup_pkey;

-- 2. The replacement: the current live schema (the original table, minus the
--    content_embedding dropped in 20260213113000, plus the 20251205 id, the
--    20251219 preview, and the 20260623 provenance triple), with the PK the
--    hypertable could never have: the surrogate id alone.
CREATE TABLE ci.communications (
    id UUID NOT NULL DEFAULT ci.gen_uuid_v7(),
    time TIMESTAMPTZ NOT NULL,
    user_id UUID NOT NULL REFERENCES ci.users(id) ON DELETE CASCADE,
    device_id UUID REFERENCES ci.devices(device_id) ON DELETE SET NULL,

    communication_type ci.communication_type NOT NULL,
    direction ci.communication_direction NOT NULL,
    thread_id TEXT,

    from_entity_id UUID,
    to_entity_ids UUID[],
    participants_metadata JSONB DEFAULT '{}',

    subject TEXT,
    content TEXT NOT NULL,
    preview TEXT,
    attachments JSONB DEFAULT '[]',

    duration_seconds INTEGER CHECK (duration_seconds >= 0),

    sentiment_score DOUBLE PRECISION CHECK (sentiment_score >= -1 AND sentiment_score <= 1),
    importance_score DOUBLE PRECISION CHECK (importance_score >= 0 AND importance_score <= 1),
    urgency_score DOUBLE PRECISION CHECK (urgency_score >= 0 AND urgency_score <= 1),
    category TEXT,
    summary TEXT,
    tags TEXT[],

    connection_id TEXT,

    is_encrypted BOOLEAN DEFAULT FALSE,
    is_archived BOOLEAN DEFAULT FALSE,

    source_type TEXT,
    source_system TEXT,
    source_id TEXT,

    CONSTRAINT communications_pkey PRIMARY KEY (id)
);

-- 3. The real idempotency key, restored to the database: the pure provenance
--    triple, no `time` smuggled in. Built before the copy so it arbitrates
--    the canonical-row selection below. Mirrors
--    browser_activity_source_triple_uniq exactly.
CREATE UNIQUE INDEX communications_source_triple_uniq
    ON ci.communications (user_id, source_type, source_system, source_id)
    WHERE source_id IS NOT NULL;

-- 4. Copy, collapsing any remaining time-drifted duplicates. The dedup table
--    knows the canonical row per triple (the oldest — downstream references
--    and search-index rows point at it), so order canonical-first and let the
--    unique index drop the replay artifacts. Triples the dedup table has
--    never seen fall back to oldest-first, the same preference its 20260702
--    backfill used. Rows without a full triple insert unconditionally (the
--    partial index does not cover them).
INSERT INTO ci.communications (
    id, time, user_id, device_id, communication_type, direction, thread_id,
    from_entity_id, to_entity_ids, participants_metadata, subject, content,
    preview, attachments, duration_seconds, sentiment_score,
    importance_score, urgency_score, category, summary, tags, connection_id,
    is_encrypted, is_archived, source_type, source_system, source_id
)
SELECT
    c.id, c.time, c.user_id, c.device_id, c.communication_type, c.direction,
    c.thread_id, c.from_entity_id, c.to_entity_ids, c.participants_metadata,
    c.subject, c.content, c.preview, c.attachments, c.duration_seconds,
    c.sentiment_score, c.importance_score, c.urgency_score, c.category,
    c.summary, c.tags, c.connection_id, c.is_encrypted, c.is_archived,
    c.source_type, c.source_system, c.source_id
FROM ci.communications_hypertable_backup c
LEFT JOIN ci.communications_source_dedup d
    ON d.user_id = c.user_id
   AND d.source_type = c.source_type
   AND d.source_system = c.source_system
   AND d.source_id = c.source_id
ORDER BY (d.communication_id IS NOT NULL AND d.communication_id = c.id) DESC,
         c.time ASC, c.id ASC
ON CONFLICT (user_id, source_type, source_system, source_id)
    WHERE source_id IS NOT NULL DO NOTHING;

-- 5. Drop the old table (and its chunks, indexes, compression job, and the
--    dedup delete-trigger riding on it).
DROP TABLE ci.communications_hypertable_backup;

-- The new table's auto-named constraints (FKs, checks, NOT NULLs) landed with
-- a "1" suffix because the namer avoided the backup table's names. Reclaim
-- the canonical names now that the backup is gone.
DO $$
DECLARE c record;
BEGIN
    FOR c IN
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'ci.communications'::regclass
          AND conname ~ '(_check|_fkey|_not_null)1$'
    LOOP
        EXECUTE format('ALTER TABLE ci.communications RENAME CONSTRAINT %I TO %I', c.conname, left(c.conname, -1));
    END LOOP;
END $$;

-- 6. Retire the dedup companion: the unique index above now owns the
--    invariant the hypertable rejected, database-enforced instead of
--    application-maintained.
DROP FUNCTION ci.communications_source_dedup_after_delete_fn();
DROP TABLE ci.communications_source_dedup;

-- 7. Secondary indexes, built once after the copy. The first six mirror the
--    old table's set; communications_user_id_time_idx replaces the
--    (user_id, time DESC) index the space dimension auto-created — it serves
--    the keyset-paginated connection reads and the summary sidecar's
--    (user_id, time) window queries (insight_aggregator.py).
CREATE INDEX communications_thread_idx ON ci.communications (thread_id) WHERE thread_id IS NOT NULL;
CREATE INDEX communications_from_idx ON ci.communications (from_entity_id) WHERE from_entity_id IS NOT NULL;
CREATE INDEX communications_to_idx ON ci.communications USING GIN (to_entity_ids) WHERE to_entity_ids IS NOT NULL;
CREATE INDEX communications_category_idx ON ci.communications (category) WHERE category IS NOT NULL;
CREATE INDEX communications_direction_type_idx ON ci.communications (direction, communication_type);
CREATE INDEX communications_device_idx ON ci.communications (device_id) WHERE device_id IS NOT NULL;
CREATE INDEX communications_user_id_time_idx ON ci.communications (user_id, time DESC);

-- migrate:down
-- One-way, like 20260104075933_departition_browser_activity: the hypertable
-- configuration this removes is the defect.
