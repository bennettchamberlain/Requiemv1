-- migrate:up
-- #1811 Better representation of Places. Location entities get a real spatial
-- representation and a geographic hierarchy:
--
-- 1. Typed PostGIS columns on ci.entities (used by Location rows): until now a
--    place's coordinates lived only in properties JSONB — 3dp-rounded (~110 m)
--    for geocode-created places, a LifeScope-legacy geolocation array for
--    user-created ones — so "places near X" could not be answered at all.
--    location_point stores FULL precision; the 3dp rounding stays only inside
--    the dedup index expression. location_boundary upgrades a place from a
--    point to a polygon (venues, neighbourhoods) for GIS containment queries.
--
-- 2. Hierarchy: place_kind classifies the level (room .. planet, LifeScope's
--    missing "Place" abstraction generalized), parent_place_id chains a venue
--    into its city/region/country. Admin-level places dedupe per parent so
--    Springfield/IL and Springfield/MA stay distinct.
--
-- 3. place_id dedupe: the geocode provider's stable place_id (already cached
--    in ci.geocode_cache but never used) becomes the primary place identity, so
--    venue renames and name variants converge on one row.
--
-- 4. ci.events.location_entity_id finally gets an FK + index — it was an
--    unindexed, orphanable bare uuid, making every events-at-place join a
--    seq scan.

ALTER TABLE ci.entities
  ADD COLUMN IF NOT EXISTS location_point geography(Point, 4326),
  ADD COLUMN IF NOT EXISTS location_boundary geography(Polygon, 4326),
  ADD COLUMN IF NOT EXISTS place_kind TEXT
    CONSTRAINT valid_place_kind CHECK (
      place_kind IS NULL OR place_kind IN (
        'room', 'building', 'venue', 'address', 'neighborhood',
        'city', 'region', 'country', 'continent', 'planet', 'other'
      )
    ),
  ADD COLUMN IF NOT EXISTS parent_place_id UUID
    REFERENCES ci.entities(entity_id) ON DELETE SET NULL;

COMMENT ON COLUMN ci.entities.location_point IS
  'Full-precision coordinates for Location entities (places). NULL for non-place entities and unresolved places.';
COMMENT ON COLUMN ci.entities.location_boundary IS
  'Optional polygon footprint for Location entities (venue/neighbourhood boundaries) for GIS containment queries.';
COMMENT ON COLUMN ci.entities.place_kind IS
  'Geographic level of a Location entity: room|building|venue|address|neighborhood|city|region|country|continent|planet|other.';
COMMENT ON COLUMN ci.entities.parent_place_id IS
  'Containing Location entity (venue -> city -> region -> country chain).';

-- Spatial index for placesNear / bbox queries over places. Plain geography
-- GIST (ST_DWithin on geography uses it directly), partial to Location rows.
CREATE INDEX IF NOT EXISTS entities_location_point_gix
  ON ci.entities USING GIST (location_point)
  WHERE entity_type = 'Location' AND location_point IS NOT NULL;

CREATE INDEX IF NOT EXISTS entities_parent_place_idx
  ON ci.entities (parent_place_id)
  WHERE parent_place_id IS NOT NULL;

-- Provider place_id is the strongest place identity: unique per owner when
-- present. No pre-existing rows carry properties.place_id (nothing wrote it
-- before this change), so the index creates clean.
CREATE UNIQUE INDEX IF NOT EXISTS entities_place_provider_id_uniq
  ON ci.entities (owner_user_id, (properties->>'place_id'))
  WHERE entity_type = 'Location' AND properties->>'place_id' IS NOT NULL;

-- Admin-area places (city and above) dedupe on (owner, kind, name, parent):
-- one "Los Angeles" city node per region per user. uuid zero stands in for a
-- missing parent so top-level nodes still dedupe.
CREATE UNIQUE INDEX IF NOT EXISTS entities_admin_place_uniq
  ON ci.entities (
    owner_user_id,
    place_kind,
    lower(btrim(name)),
    COALESCE(parent_place_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  WHERE entity_type = 'Location'
    AND place_kind IN ('city', 'region', 'country', 'continent', 'planet')
    AND name IS NOT NULL;

-- Backfill location_point from the two legacy coordinate vocabularies:
-- geocode-created places ({lat, lng} numbers, 3dp) and LifeScope-style rows
-- (geolocation = [lng, lat] array). Full precision was never stored for the
-- former, so the rounded value is the best available seed; the service
-- refreshes it to full precision on the next geocode hit.
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
      ST_MakePoint((properties->'geolocation'->>0)::double precision, (properties->'geolocation'->>1)::double precision),
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
  AND NOT ((properties->'geolocation'->>0)::double precision = 0
       AND (properties->'geolocation'->>1)::double precision = 0);

-- 4. events.location_entity_id: clean orphans (PlaceService.remove hard-deletes
-- without unlinking events), then enforce + index the link.
UPDATE ci.events e
SET location_entity_id = NULL
WHERE location_entity_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM ci.entities ent WHERE ent.entity_id = e.location_entity_id
  );

ALTER TABLE ci.events
  ADD CONSTRAINT events_location_entity_fk
    FOREIGN KEY (location_entity_id) REFERENCES ci.entities(entity_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS events_location_entity_idx
  ON ci.events (location_entity_id)
  WHERE location_entity_id IS NOT NULL;

-- migrate:down
DROP INDEX IF EXISTS ci.events_location_entity_idx;
ALTER TABLE ci.events
  DROP CONSTRAINT IF EXISTS events_location_entity_fk;

DROP INDEX IF EXISTS ci.entities_admin_place_uniq;
DROP INDEX IF EXISTS ci.entities_place_provider_id_uniq;
DROP INDEX IF EXISTS ci.entities_parent_place_idx;
DROP INDEX IF EXISTS ci.entities_location_point_gix;

ALTER TABLE ci.entities
  DROP COLUMN IF EXISTS parent_place_id,
  DROP COLUMN IF EXISTS place_kind,
  DROP COLUMN IF EXISTS location_boundary,
  DROP COLUMN IF EXISTS location_point;
