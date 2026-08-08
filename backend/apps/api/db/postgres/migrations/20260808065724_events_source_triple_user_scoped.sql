-- migrate:up
-- Fix cross-tenant data-loss: events_source_triple_uniq was global while
-- bulkInsertIdempotent hydrated by user_id. Scope the arbiter to the user.
DROP INDEX IF EXISTS ci.events_source_triple_uniq;
CREATE UNIQUE INDEX events_source_triple_uniq
  ON ci.events (user_id, source_type, source_system, source_id)
  WHERE source_id IS NOT NULL;

-- migrate:down
DROP INDEX IF EXISTS ci.events_source_triple_uniq;
CREATE UNIQUE INDEX events_source_triple_uniq
  ON ci.events (source_type, source_system, source_id)
  WHERE source_id IS NOT NULL;
