-- migrate:up
-- The (time, user_id, communication_type) primary key forbids two DISTINCT
-- messages that share a timestamp + type — rampant in bulk chat history
-- (~7% of imessage, ~3% of google_voice rows in a real export share a
-- second-resolution timestamp with another message of the same type). Switch to
-- a surrogate-id primary key so genuinely-distinct messages coexist; idempotent
-- re-sync still dedupes on communications_source_triple_uniq (the provenance
-- triple). `id` is a uuid the service always populates (uuidv7, or a
-- stable-derived id for imports), added nullable in 20251205233346.
UPDATE ci.communications SET id = gen_uuid_v7() WHERE id IS NULL;
ALTER TABLE ci.communications ALTER COLUMN id SET NOT NULL;

-- `communications` is a TimescaleDB hypertable partitioned on (time, user_id), so
-- both partition columns must remain in the primary key.
ALTER TABLE ci.communications DROP CONSTRAINT IF EXISTS communications_pkey;
ALTER TABLE ci.communications ADD CONSTRAINT communications_pkey PRIMARY KEY (time, user_id, id);

-- migrate:down
ALTER TABLE ci.communications DROP CONSTRAINT IF EXISTS communications_pkey;
ALTER TABLE ci.communications ADD CONSTRAINT communications_pkey PRIMARY KEY (time, user_id, communication_type);
ALTER TABLE ci.communications ALTER COLUMN id DROP NOT NULL;
