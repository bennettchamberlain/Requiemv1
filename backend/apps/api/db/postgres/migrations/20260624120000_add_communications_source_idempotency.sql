-- migrate:up
-- Route imported communications (messages / email / calls from CI-Import-Tools)
-- into ci.communications with idempotent re-sync. Two changes:
--
--   1. Provenance triple (source_type, source_system, source_id), mirroring
--      ci.events, so a re-sync can dedupe imported rows.
--
--   2. Replace the (time, user_id, communication_type) primary key — which
--      forbids two DISTINCT messages that share a timestamp + type (rampant in
--      bulk chat history: group threads, minute-resolution exports) — with
--      (time, user_id, id). `id` is a surrogate uuid (stable-derived for imports
--      in CommunicationService.create), so genuinely-distinct messages coexist
--      while a re-sent source row collides on its derived id → find-or-return.
--      `time` stays in the key because TimescaleDB requires the partition column
--      in every unique constraint / primary key on a hypertable.
ALTER TABLE ci.communications
  ADD COLUMN IF NOT EXISTS source_type   text,
  ADD COLUMN IF NOT EXISTS source_system text,
  ADD COLUMN IF NOT EXISTS source_id     text;

-- `id` was added nullable (20251205233346); the new PK requires it populated.
UPDATE ci.communications SET id = gen_uuid_v7() WHERE id IS NULL;
ALTER TABLE ci.communications ALTER COLUMN id SET NOT NULL;

ALTER TABLE ci.communications DROP CONSTRAINT IF EXISTS communications_pkey;
ALTER TABLE ci.communications ADD CONSTRAINT communications_pkey PRIMARY KEY (time, user_id, id);

-- Idempotency key for imported rows; partial so agent-turn communications (no
-- provenance) are unaffected. Includes `time` (hypertable partition column).
CREATE UNIQUE INDEX IF NOT EXISTS communications_source_idem
  ON ci.communications (time, user_id, source_system, source_id)
  WHERE source_id IS NOT NULL;

-- migrate:down
DROP INDEX IF EXISTS ci.communications_source_idem;
ALTER TABLE ci.communications DROP CONSTRAINT IF EXISTS communications_pkey;
ALTER TABLE ci.communications ADD CONSTRAINT communications_pkey PRIMARY KEY (time, user_id, communication_type);
ALTER TABLE ci.communications ALTER COLUMN id DROP NOT NULL;
ALTER TABLE ci.communications
  DROP COLUMN IF EXISTS source_id,
  DROP COLUMN IF EXISTS source_system,
  DROP COLUMN IF EXISTS source_type;
