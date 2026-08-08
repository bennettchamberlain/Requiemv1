-- migrate:up
-- Latent hazard: nullable owner_user_id could collide under UNIQUE without
-- NULLS NOT DISTINCT. Rebuild the four owner-scoped provenance indexes.
DROP INDEX IF EXISTS ci.inventory_source_triple_uniq;
CREATE UNIQUE INDEX inventory_source_triple_uniq
  ON ci.inventory (owner_user_id, source_type, source_system, source_id)
  NULLS NOT DISTINCT
  WHERE source_id IS NOT NULL;

DROP INDEX IF EXISTS ci.product_models_source_triple_uniq;
CREATE UNIQUE INDEX product_models_source_triple_uniq
  ON ci.product_models (owner_user_id, source_type, source_system, source_id)
  NULLS NOT DISTINCT
  WHERE source_id IS NOT NULL;

DROP INDEX IF EXISTS ci.receipts_source_triple_uniq;
CREATE UNIQUE INDEX receipts_source_triple_uniq
  ON ci.receipts (owner_user_id, source_type, source_system, source_id)
  NULLS NOT DISTINCT
  WHERE source_id IS NOT NULL;

DROP INDEX IF EXISTS ci.object_observations_source_triple_uniq;
CREATE UNIQUE INDEX object_observations_source_triple_uniq
  ON ci.object_observations (owner_user_id, source_type, source_system, source_id)
  NULLS NOT DISTINCT
  WHERE source_id IS NOT NULL;

-- migrate:down
DROP INDEX IF EXISTS ci.inventory_source_triple_uniq;
CREATE UNIQUE INDEX inventory_source_triple_uniq
  ON ci.inventory (owner_user_id, source_type, source_system, source_id)
  WHERE source_id IS NOT NULL;

DROP INDEX IF EXISTS ci.product_models_source_triple_uniq;
CREATE UNIQUE INDEX product_models_source_triple_uniq
  ON ci.product_models (owner_user_id, source_type, source_system, source_id)
  WHERE source_id IS NOT NULL;

DROP INDEX IF EXISTS ci.receipts_source_triple_uniq;
CREATE UNIQUE INDEX receipts_source_triple_uniq
  ON ci.receipts (owner_user_id, source_type, source_system, source_id)
  WHERE source_id IS NOT NULL;

DROP INDEX IF EXISTS ci.object_observations_source_triple_uniq;
CREATE UNIQUE INDEX object_observations_source_triple_uniq
  ON ci.object_observations (owner_user_id, source_type, source_system, source_id)
  WHERE source_id IS NOT NULL;
