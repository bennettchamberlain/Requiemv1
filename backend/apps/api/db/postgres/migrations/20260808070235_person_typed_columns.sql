-- migrate:up
-- Promote frequently-read Person identity fields out of properties JSONB onto
-- typed columns. Nullable so non-Person entity rows (same physical table) stay
-- untouched; backfill only Person/Contact rows that already carry the keys.

ALTER TABLE ci.entities
  ADD COLUMN IF NOT EXISTS first_name TEXT,
  ADD COLUMN IF NOT EXISTS middle_name TEXT,
  ADD COLUMN IF NOT EXISTS last_name TEXT,
  ADD COLUMN IF NOT EXISTS birth_date DATE,
  ADD COLUMN IF NOT EXISTS is_self BOOLEAN;

COMMENT ON COLUMN ci.entities.first_name IS
  'Typed Person/Contact given name (canonical); properties.first_name kept in sync during dual-write.';
COMMENT ON COLUMN ci.entities.middle_name IS
  'Typed Person/Contact middle name (canonical); properties.middle_name kept in sync during dual-write.';
COMMENT ON COLUMN ci.entities.last_name IS
  'Typed Person/Contact family name (canonical); properties.last_name kept in sync during dual-write.';
COMMENT ON COLUMN ci.entities.birth_date IS
  'Typed Person/Contact birth date (canonical); properties.birth_date kept in sync during dual-write.';
COMMENT ON COLUMN ci.entities.is_self IS
  'True when this Person row is the owner''s self node; properties.is_self kept in sync during dual-write.';

UPDATE ci.entities
SET
  first_name = NULLIF(btrim(properties->>'first_name'), ''),
  middle_name = NULLIF(btrim(properties->>'middle_name'), ''),
  last_name = NULLIF(btrim(properties->>'last_name'), ''),
  birth_date = CASE
    WHEN (properties->>'birth_date') ~ '^\d{4}-\d{2}-\d{2}'
      THEN (properties->>'birth_date')::date
    ELSE NULL
  END,
  is_self = CASE
    WHEN properties->>'is_self' IN ('true', 't', '1') THEN TRUE
    WHEN properties->>'is_self' IN ('false', 'f', '0') THEN FALSE
    ELSE NULL
  END
WHERE entity_type IN ('Person', 'Contact');

-- migrate:down
ALTER TABLE ci.entities
  DROP COLUMN IF EXISTS is_self,
  DROP COLUMN IF EXISTS birth_date,
  DROP COLUMN IF EXISTS last_name,
  DROP COLUMN IF EXISTS middle_name,
  DROP COLUMN IF EXISTS first_name;
