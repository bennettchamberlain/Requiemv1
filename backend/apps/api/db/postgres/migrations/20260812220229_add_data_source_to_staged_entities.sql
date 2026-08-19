-- migrate:up

-- Which parser produced a staged entity.
--
-- Staged ITEMS have carried `data_source` since the schema was created; entities
-- did not, because entity resolution originally keyed on a contact handle alone
-- and a handle is the same person whichever export it arrived in.
--
-- Entities now resolve through GraphIngestService, whose idempotency key is
-- (owner_user_id, entity_type, 'import:<sourceSystem>', uuidv5(natural key)) —
-- so the source system is part of the identity and has to be recorded at
-- staging time. One run spans several parsers (an Amazon archive stages
-- `audible`, `prime_video`, `kindle_reading` and `amazon_music` together), so it
-- cannot be recovered from the run.
--
-- Nullable, with no backfill: entities staged before this column existed belong
-- to runs whose staging rows are deleted with the run, and the push path treats
-- a null source as 'unknown' rather than failing on it.
ALTER TABLE ci_import.staged_entities
  ADD COLUMN data_source TEXT;

-- migrate:down

ALTER TABLE ci_import.staged_entities
  DROP COLUMN data_source;
