-- migrate:up

-- Dedup for handle-less staged entities, moved out of process memory.
--
-- An entity WITH a handle dedups on `staged_entities_run_identity_uniq`. One
-- without — a thread, a place, a dish — deliberately has no such constraint,
-- because they would all collapse into each other on a NULL key. Their dedup
-- was therefore a `Map` on the StagedWriter instance, and a StagedWriter is
-- constructed per parse ATTEMPT. So a crash mid-parse and the resume that
-- follows saw an empty map and re-inserted everything the dead attempt had
-- already written.
--
-- Measured on a 20k-vCard run killed with SIGKILL and resumed by the staleness
-- sweep: items collapsed correctly (20,001 rows / 20,001 distinct hashes), as
-- did identity-keyed entities (10,000 / 10,000) — but handle-less entities came
-- back 12,000 rows for 10,000 distinct (type, name), with 2,000 spurious edges
-- to match, and the run's reported counts were wrong. It is not a marginal
-- population: 969 of 4,200 entities in a real Google Takeout run are
-- handle-less.
--
-- The key is a hash of `entityKey(entity)` rather than the value itself, which
-- embeds the attribute JSON and has no bound — a btree index entry does.
--
-- NULLable with a partial unique index, mirroring `identity_key` right above
-- it: rows written before this migration have no key and are simply exempt,
-- which is the honest treatment for history we cannot recompute, and avoids a
-- rewrite of every staged row on an appliance mid-import.
ALTER TABLE ci_import.staged_entities
    ADD COLUMN dedupe_key TEXT;

COMMENT ON COLUMN ci_import.staged_entities.dedupe_key IS
    'sha256 of entityKey() for entities with no identity_key; NULL otherwise and for pre-migration rows.';

CREATE UNIQUE INDEX staged_entities_run_dedupe_uniq
    ON ci_import.staged_entities (run_id, dedupe_key)
 WHERE dedupe_key IS NOT NULL;

-- migrate:down

DROP INDEX IF EXISTS ci_import.staged_entities_run_dedupe_uniq;

ALTER TABLE ci_import.staged_entities
    DROP COLUMN IF EXISTS dedupe_key;
