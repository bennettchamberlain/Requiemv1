-- migrate:up
-- Location identity moves from properties.lat/lng (+ reverse_geocode name cell)
-- onto a snapped location_point unique index (~110 m / 0.001°).

-- (a) Backfill location_point from properties.lat/lng where still null.
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

-- Also seed from legacy geolocation = [lng, lat] arrays when lat/lng absent.
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

-- Resolve collisions before the unique index: keep the earliest row per
-- (owner, snapped cell); clear location_point on the rest so they stay
-- referenceable but leave the dedup namespace.
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

-- (b) Unique per owner + ~110 m cell.
CREATE UNIQUE INDEX IF NOT EXISTS entities_location_snap_dedup_uniq
  ON ci.entities (
    owner_user_id,
    ST_SnapToGrid(location_point::geometry, 0.001)
  )
  WHERE entity_type = 'Location'
    AND location_point IS NOT NULL
    AND owner_user_id IS NOT NULL;

-- (c) Drop the lat/lng expression index superseded by the snap index.
DROP INDEX IF EXISTS ci.entities_reverse_geocode_dedup_idx;

-- migrate:down
DROP INDEX IF EXISTS ci.entities_location_snap_dedup_uniq;

-- Recreate the prior reverse-geocode lat/lng cell index (best-effort restore).
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
