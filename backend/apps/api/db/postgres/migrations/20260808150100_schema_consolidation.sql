-- migrate:up
-- Consolidated from feat/schedules schema waves A–E.

DROP TABLE IF EXISTS ci.agent_messages;
DROP TABLE IF EXISTS ci.agents;

DROP INDEX IF EXISTS ci.events_source_triple_uniq;
CREATE UNIQUE INDEX events_source_triple_uniq
  ON ci.events (user_id, source_type, source_system, source_id)
  WHERE source_id IS NOT NULL;

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

UPDATE ci.content
SET event_id = NULL
WHERE event_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM ci.events e WHERE e.event_id = content.event_id
  );

ALTER TABLE ci.content
  ADD CONSTRAINT content_event_id_fkey
  FOREIGN KEY (event_id) REFERENCES ci.events(event_id)
  ON DELETE SET NULL;

CREATE TABLE ci.event_analytics (
  event_id UUID PRIMARY KEY REFERENCES ci.events(event_id) ON DELETE CASCADE,
  salience DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  access_count INTEGER NOT NULL DEFAULT 0,
  prediction_model TEXT,
  productivity_impact DOUBLE PRECISION,
  related_event_ids UUID[],
  supersedes_event_id UUID,
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO ci.event_analytics (
  event_id, salience, access_count, prediction_model, productivity_impact,
  related_event_ids, supersedes_event_id, last_synced_at
)
SELECT
  event_id, salience, access_count, prediction_model, productivity_impact,
  related_event_ids, supersedes_event_id, last_synced_at
FROM ci.events;

ALTER TABLE ci.events
  DROP COLUMN IF EXISTS salience,
  DROP COLUMN IF EXISTS access_count,
  DROP COLUMN IF EXISTS prediction_model,
  DROP COLUMN IF EXISTS productivity_impact,
  DROP COLUMN IF EXISTS related_event_ids,
  DROP COLUMN IF EXISTS supersedes_event_id,
  DROP COLUMN IF EXISTS last_synced_at;

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

UPDATE ci.entities
SET location_point = ST_SetSRID(
      ST_MakePoint((properties->>'lng')::double precision, (properties->>'lat')::double precision),
      4326
    )::geography
WHERE entity_type = 'Location'
  AND location_point IS NULL
  AND jsonb_typeof(properties->'lat') = 'number'
  AND jsonb_typeof(properties->'lng') = 'number'
  AND abs((properties->>'lat')::double precision) <= 90
  AND abs((properties->>'lng')::double precision) <= 180
  AND NOT ((properties->>'lat')::double precision = 0 AND (properties->>'lng')::double precision = 0);

UPDATE ci.entities
SET location_point = ST_SetSRID(
      ST_MakePoint(
        (properties->'geolocation'->>0)::double precision,
        (properties->'geolocation'->>1)::double precision
      ),
      4326
    )::geography
WHERE entity_type = 'Location'
  AND location_point IS NULL
  AND jsonb_typeof(properties->'geolocation') = 'array'
  AND jsonb_array_length(properties->'geolocation') >= 2
  AND jsonb_typeof(properties->'geolocation'->0) = 'number'
  AND jsonb_typeof(properties->'geolocation'->1) = 'number'
  AND abs((properties->'geolocation'->>1)::double precision) <= 90
  AND abs((properties->'geolocation'->>0)::double precision) <= 180
  AND NOT (
    (properties->'geolocation'->>0)::double precision = 0
    AND (properties->'geolocation'->>1)::double precision = 0
  );

WITH ranked AS (
  SELECT
    entity_id,
    ROW_NUMBER() OVER (
      PARTITION BY
        owner_user_id,
        ST_SnapToGrid(location_point::geometry, 0.001)
      ORDER BY created_at ASC NULLS LAST, entity_id ASC
    ) AS rn
  FROM ci.entities
  WHERE entity_type = 'Location'
    AND location_point IS NOT NULL
    AND owner_user_id IS NOT NULL
)
UPDATE ci.entities e
SET location_point = NULL
FROM ranked r
WHERE e.entity_id = r.entity_id
  AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS entities_location_snap_dedup_uniq
  ON ci.entities (
    owner_user_id,
    ST_SnapToGrid(location_point::geometry, 0.001)
  )
  WHERE entity_type = 'Location'
    AND location_point IS NOT NULL
    AND owner_user_id IS NOT NULL;

DROP INDEX IF EXISTS ci.entities_reverse_geocode_dedup_idx;

COMMENT ON TABLE ci.browser_activity IS
  'deprecated: folded into ci.events+ci.content; dual-read until drop';

INSERT INTO ci.events (
  event_id,
  user_id,
  title,
  description,
  event_type,
  category,
  start_time,
  end_time,
  source_type,
  source_system,
  source_id,
  metadata
)
SELECT
  ci.gen_uuid_v7(),
  ba.user_id,
  COALESCE(NULLIF(btrim(ba.title), ''), ba.url, 'Browser activity'),
  ba.page_summary,
  'view',
  ba.category,
  ba.time,
  CASE
    WHEN ba.duration_seconds IS NOT NULL AND ba.duration_seconds > 0
      THEN ba.time + make_interval(secs => ba.duration_seconds)
    ELSE NULL
  END,
  COALESCE(ba.source_type, 'browser_activity'),
  COALESCE(ba.source_system, 'fold'),
  COALESCE(ba.source_id, ba.id::text),
  jsonb_strip_nulls(
    jsonb_build_object(
      'browser_activity_id', ba.id,
      'url', ba.url,
      'action_type', ba.action_type,
      'duration_seconds', ba.duration_seconds,
      'scroll_depth_percent', ba.scroll_depth_percent,
      'category', ba.category,
      'productivity_score', ba.productivity_score,
      'is_incognito', ba.is_incognito,
      'contains_sensitive', ba.contains_sensitive,
      'device_id', ba.device_id,
      'properties', COALESCE(ba.properties, '{}'::jsonb)
    )
  )
FROM ci.browser_activity ba
ON CONFLICT (user_id, source_type, source_system, source_id)
  WHERE source_id IS NOT NULL
  DO NOTHING;

INSERT INTO ci.content (
  id,
  type,
  title,
  text,
  url,
  source_url,
  source_data,
  user_id,
  event_id,
  source_type,
  source_system,
  source_id
)
SELECT
  ci.gen_uuid_v7(),
  'web-page',
  COALESCE(NULLIF(btrim(ba.title), ''), ba.url),
  ba.page_summary,
  ba.url,
  ba.url,
  jsonb_build_object('browser_activity_id', ba.id),
  ba.user_id,
  e.event_id,
  COALESCE(ba.source_type, 'browser_activity'),
  COALESCE(ba.source_system, 'fold'),
  COALESCE(ba.source_id, ba.id::text)
FROM ci.browser_activity ba
JOIN ci.events e
  ON e.user_id = ba.user_id
 AND e.source_type = COALESCE(ba.source_type, 'browser_activity')
 AND e.source_system = COALESCE(ba.source_system, 'fold')
 AND e.source_id = COALESCE(ba.source_id, ba.id::text)
ON CONFLICT (user_id, source_type, source_system, source_id)
  WHERE source_id IS NOT NULL
  DO NOTHING;

COMMENT ON TABLE ci.product_models IS
  'pre-implementation: product catalog identity; schema ready, product surface not shipped';
COMMENT ON TABLE ci.receipts IS
  'pre-implementation: purchase receipts; schema ready, product surface not shipped';
COMMENT ON TABLE ci.receipt_line_items IS
  'pre-implementation: receipt line items; schema ready, product surface not shipped';
COMMENT ON TABLE ci.object_observations IS
  'pre-implementation: observed physical objects; schema ready, product surface not shipped';

-- migrate:down

COMMENT ON TABLE ci.product_models IS NULL;
COMMENT ON TABLE ci.receipts IS NULL;
COMMENT ON TABLE ci.receipt_line_items IS NULL;
COMMENT ON TABLE ci.object_observations IS NULL;

DELETE FROM ci.content
WHERE type = 'web-page'
  AND source_data ? 'browser_activity_id';

DELETE FROM ci.events
WHERE event_type = 'view'
  AND metadata ? 'browser_activity_id';

COMMENT ON TABLE ci.browser_activity IS NULL;

DROP INDEX IF EXISTS ci.entities_location_snap_dedup_uniq;

CREATE UNIQUE INDEX IF NOT EXISTS entities_reverse_geocode_dedup_idx
  ON ci.entities (
    owner_user_id,
    lower(btrim(name)),
    round(((properties->>'lat')::numeric), 3),
    round(((properties->>'lng')::numeric), 3)
  )
  WHERE entity_type = 'Location'
    AND properties->>'source' = 'reverse_geocode'
    AND name IS NOT NULL
    AND btrim(name) <> '';

ALTER TABLE ci.entities
  DROP COLUMN IF EXISTS is_self,
  DROP COLUMN IF EXISTS birth_date,
  DROP COLUMN IF EXISTS last_name,
  DROP COLUMN IF EXISTS middle_name,
  DROP COLUMN IF EXISTS first_name;

ALTER TABLE ci.events
  ADD COLUMN IF NOT EXISTS salience DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS access_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS prediction_model TEXT,
  ADD COLUMN IF NOT EXISTS productivity_impact DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS related_event_ids UUID[],
  ADD COLUMN IF NOT EXISTS supersedes_event_id UUID,
  ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ;

UPDATE ci.events e SET
  salience = a.salience,
  access_count = a.access_count,
  prediction_model = a.prediction_model,
  productivity_impact = a.productivity_impact,
  related_event_ids = a.related_event_ids,
  supersedes_event_id = a.supersedes_event_id,
  last_synced_at = a.last_synced_at
FROM ci.event_analytics a
WHERE e.event_id = a.event_id;

DROP TABLE IF EXISTS ci.event_analytics;

ALTER TABLE ci.content DROP CONSTRAINT IF EXISTS content_event_id_fkey;

DROP INDEX IF EXISTS ci.object_observations_source_triple_uniq;
CREATE UNIQUE INDEX object_observations_source_triple_uniq
  ON ci.object_observations (owner_user_id, source_type, source_system, source_id)
  WHERE source_id IS NOT NULL;

DROP INDEX IF EXISTS ci.receipts_source_triple_uniq;
CREATE UNIQUE INDEX receipts_source_triple_uniq
  ON ci.receipts (owner_user_id, source_type, source_system, source_id)
  WHERE source_id IS NOT NULL;

DROP INDEX IF EXISTS ci.product_models_source_triple_uniq;
CREATE UNIQUE INDEX product_models_source_triple_uniq
  ON ci.product_models (owner_user_id, source_type, source_system, source_id)
  WHERE source_id IS NOT NULL;

DROP INDEX IF EXISTS ci.inventory_source_triple_uniq;
CREATE UNIQUE INDEX inventory_source_triple_uniq
  ON ci.inventory (owner_user_id, source_type, source_system, source_id)
  WHERE source_id IS NOT NULL;

DROP INDEX IF EXISTS ci.events_source_triple_uniq;
CREATE UNIQUE INDEX events_source_triple_uniq
  ON ci.events (source_type, source_system, source_id)
  WHERE source_id IS NOT NULL;

-- Irreversible: original CREATE lived in 20250925151600 / 20250925152800.
SELECT 1;
