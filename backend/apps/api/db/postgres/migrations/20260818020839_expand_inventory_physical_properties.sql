-- migrate:up
-- =================================================================
-- PHYSICAL PROPERTIES OF A THING
-- =================================================================
-- ci.inventory has described an owned unit commercially since 2025-09 (brand,
-- model, price, warranty) and structurally since 20260803223025 (product,
-- receipt, lifecycle, merge). What it has never described is the OBJECT: how
-- big it is, what it weighs, what colour it is, what it is made of, or how it
-- came to be owned. Those are the questions a physical-memory system is
-- actually asked — "will the desk fit through the door", "what do I own made of
-- leather", "how much does the camera bag weigh", "what did I buy in March" —
-- and today every one of them is unanswerable.
--
-- Three rules this migration enforces rather than documents:
--
--   1. CANONICAL SI, ALWAYS. Every measurement is stored in one unit —
--      millimetres, grams, millilitres — and never as a unit-bearing string.
--      Units are a presentation concern; `unit_system` records the preference
--      the value was entered in so it can be rendered back the way it was
--      typed, but it NEVER changes what the number means.
--   2. NULL MEANS UNKNOWN, AND ONLY UNKNOWN. Every measurement is CHECKed
--      strictly positive, so a 0 that really means "nobody measured it" cannot
--      enter and then read as a weightless object downstream.
--   3. A DIGITAL ITEM HAS NO BODY. `is_digital` has existed since 2025-09 with
--      nothing stopping a licence key from having a mass; now something does.
--
-- Upper bounds are deliberate too. They are far above any real possession
-- (10 km, 1000 t, 100 kL) and exist to catch the one bug this design can
-- actually produce: a caller writing the wrong unit into a canonical column,
-- which is always off by a factor of 10^3 or more.

-- ---------------------------------------------------------------------------
-- Geometry, mass, capacity — canonical SI, strictly positive, sanity-bounded.
-- ---------------------------------------------------------------------------
ALTER TABLE ci.inventory
    ADD COLUMN IF NOT EXISTS length_mm NUMERIC(14, 3),
    ADD COLUMN IF NOT EXISTS width_mm  NUMERIC(14, 3),
    ADD COLUMN IF NOT EXISTS height_mm NUMERIC(14, 3),
    ADD COLUMN IF NOT EXISTS mass_g    NUMERIC(16, 3),
    ADD COLUMN IF NOT EXISTS volume_ml NUMERIC(16, 3);

ALTER TABLE ci.inventory DROP CONSTRAINT IF EXISTS inventory_dimensions_positive_check;
ALTER TABLE ci.inventory
    ADD CONSTRAINT inventory_dimensions_positive_check CHECK (
        (length_mm IS NULL OR (length_mm > 0 AND length_mm <= 10000000))
        AND (width_mm IS NULL OR (width_mm > 0 AND width_mm <= 10000000))
        AND (height_mm IS NULL OR (height_mm > 0 AND height_mm <= 10000000))
    );

ALTER TABLE ci.inventory DROP CONSTRAINT IF EXISTS inventory_mass_positive_check;
ALTER TABLE ci.inventory
    ADD CONSTRAINT inventory_mass_positive_check
    CHECK (mass_g IS NULL OR (mass_g > 0 AND mass_g <= 1000000000));

ALTER TABLE ci.inventory DROP CONSTRAINT IF EXISTS inventory_volume_positive_check;
ALTER TABLE ci.inventory
    ADD CONSTRAINT inventory_volume_positive_check
    CHECK (volume_ml IS NULL OR (volume_ml > 0 AND volume_ml <= 100000000));

-- Display preference only. The stored numbers are SI whatever this says.
ALTER TABLE ci.inventory
    ADD COLUMN IF NOT EXISTS unit_system TEXT;
ALTER TABLE ci.inventory DROP CONSTRAINT IF EXISTS inventory_unit_system_check;
ALTER TABLE ci.inventory
    ADD CONSTRAINT inventory_unit_system_check
    CHECK (unit_system IS NULL OR unit_system IN ('metric', 'imperial'));

-- ---------------------------------------------------------------------------
-- Appearance and composition.
-- ---------------------------------------------------------------------------
-- Colour NAMES, dominant first, lowercased. Names not hexes are the searchable
-- half ("my blue mug"); `color_hex` carries the one swatch a UI can paint.
ALTER TABLE ci.inventory
    ADD COLUMN IF NOT EXISTS colors TEXT[],
    ADD COLUMN IF NOT EXISTS color_hex TEXT,
    ADD COLUMN IF NOT EXISTS materials TEXT[],
    ADD COLUMN IF NOT EXISTS composition JSONB NOT NULL DEFAULT '{}';

-- Array hygiene, enforced rather than hoped for: no NULL elements, no empty
-- strings, bounded cardinality, and lowercase throughout. The lowercase test
-- works on the array's text rendering, which is the only way to reach every
-- element from inside a CHECK — the braces and quotes it also lowercases are
-- already case-free, so the comparison is exact.
ALTER TABLE ci.inventory DROP CONSTRAINT IF EXISTS inventory_colors_check;
ALTER TABLE ci.inventory
    ADD CONSTRAINT inventory_colors_check CHECK (
        colors IS NULL
        OR (
            cardinality(colors) BETWEEN 1 AND 12
            AND array_position(colors, NULL) IS NULL
            AND array_position(colors, '') IS NULL
            AND colors::text = lower(colors::text)
        )
    );

ALTER TABLE ci.inventory DROP CONSTRAINT IF EXISTS inventory_materials_check;
ALTER TABLE ci.inventory
    ADD CONSTRAINT inventory_materials_check CHECK (
        materials IS NULL
        OR (
            cardinality(materials) BETWEEN 1 AND 12
            AND array_position(materials, NULL) IS NULL
            AND array_position(materials, '') IS NULL
            AND materials::text = lower(materials::text)
        )
    );

ALTER TABLE ci.inventory DROP CONSTRAINT IF EXISTS inventory_color_hex_check;
ALTER TABLE ci.inventory
    ADD CONSTRAINT inventory_color_hex_check
    CHECK (color_hex IS NULL OR color_hex ~ '^#[0-9a-f]{6}$');

-- `composition` is {material: fraction} — {"cotton": 0.8, "elastane": 0.2}. It
-- is a strict refinement of `materials`, not a replacement: an item can list
-- its materials without knowing the proportions, but it cannot claim
-- proportions that do not add up. A plain CHECK cannot reach inside a jsonb
-- object, so the predicate lives in an IMMUTABLE function.
CREATE OR REPLACE FUNCTION ci.is_normalized_composition(composition JSONB)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
PARALLEL SAFE
AS $$
    SELECT composition IS NULL
        OR (
            jsonb_typeof(composition) = 'object'
            AND NOT EXISTS (
                SELECT 1
                FROM jsonb_each(composition) AS entry(key, value)
                WHERE jsonb_typeof(entry.value) <> 'number'
                   OR entry.value::numeric <= 0
                   OR entry.value::numeric > 1
                   OR btrim(entry.key) = ''
                   OR entry.key <> lower(entry.key)
            )
            -- Tolerance, not slack: fractions are usually authored as rounded
            -- percentages, so 0.33/0.33/0.34 must pass while 0.8/0.8 must not.
            AND COALESCE(
                (SELECT sum(entry.value::numeric) FROM jsonb_each(composition) AS entry(key, value)),
                0
            ) <= 1.001
        );
$$;

COMMENT ON FUNCTION ci.is_normalized_composition(JSONB) IS
  'CHECK predicate for ci.inventory.composition: a {material: fraction} object with lowercase keys, fractions in (0,1], summing to at most 1. Mirrored by normalizeComposition in physicalProperties.ts.';

ALTER TABLE ci.inventory DROP CONSTRAINT IF EXISTS inventory_composition_check;
ALTER TABLE ci.inventory
    ADD CONSTRAINT inventory_composition_check
    CHECK (ci.is_normalized_composition(composition));

-- ---------------------------------------------------------------------------
-- Acquisition and physical lifetime.
-- ---------------------------------------------------------------------------
-- `acquired_at` (2025-09) is the bought time and keeps that meaning. What it
-- lacked was HOW and FROM WHOM, and the two other dates every physical thing
-- has: when it was made, and when it stops being usable.
ALTER TABLE ci.inventory
    ADD COLUMN IF NOT EXISTS acquisition_method TEXT,
    ADD COLUMN IF NOT EXISTS acquired_from TEXT,
    ADD COLUMN IF NOT EXISTS acquired_from_entity_id UUID REFERENCES ci.entities(entity_id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS manufactured_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

ALTER TABLE ci.inventory DROP CONSTRAINT IF EXISTS inventory_acquisition_method_check;
ALTER TABLE ci.inventory
    ADD CONSTRAINT inventory_acquisition_method_check
    CHECK (
        acquisition_method IS NULL
        OR acquisition_method IN (
            'purchased', 'gift', 'inherited', 'found', 'made', 'borrowed', 'traded', 'sample', 'unknown'
        )
    );

-- ---------------------------------------------------------------------------
-- A digital item has no body.
-- ---------------------------------------------------------------------------
-- Deliberately scoped to the measurements, which are unambiguous. Colour and
-- material are left out: a digital item can honestly have a cover colour, and a
-- constraint that argues about edge cases gets dropped rather than obeyed.
ALTER TABLE ci.inventory DROP CONSTRAINT IF EXISTS inventory_digital_is_incorporeal_check;
ALTER TABLE ci.inventory
    ADD CONSTRAINT inventory_digital_is_incorporeal_check CHECK (
        is_digital IS NOT TRUE
        OR (length_mm IS NULL AND width_mm IS NULL AND height_mm IS NULL
            AND mass_g IS NULL AND volume_ml IS NULL)
    );

-- ---------------------------------------------------------------------------
-- Comments.
-- ---------------------------------------------------------------------------
COMMENT ON COLUMN ci.inventory.length_mm IS
  'Longest dimension, MILLIMETRES. Canonical: never store inches here. NULL = unmeasured, never zero.';
COMMENT ON COLUMN ci.inventory.width_mm IS 'Width, MILLIMETRES. See length_mm.';
COMMENT ON COLUMN ci.inventory.height_mm IS 'Height, MILLIMETRES. See length_mm.';
COMMENT ON COLUMN ci.inventory.mass_g IS
  'Mass, GRAMS — the as-owned mass including whatever is inside it, not a shipping weight. NULL = unweighed.';
COMMENT ON COLUMN ci.inventory.volume_ml IS
  'Capacity (what it HOLDS), MILLILITRES. Not the bounding volume of length*width*height, which is derivable.';
COMMENT ON COLUMN ci.inventory.unit_system IS
  'Display preference the measurements were entered in (metric|imperial). Presentation only — the stored values are always SI.';
COMMENT ON COLUMN ci.inventory.colors IS
  'Lowercase colour names, dominant first. The searchable half of appearance ("my blue mug").';
COMMENT ON COLUMN ci.inventory.color_hex IS
  'Dominant colour as lowercase #rrggbb, for UI swatches. colors[1] is the name of this same colour.';
COMMENT ON COLUMN ci.inventory.materials IS
  'Lowercase material names ({leather, brass}). What the object IS MADE OF; composition adds the proportions when known.';
COMMENT ON COLUMN ci.inventory.composition IS
  '{material: fraction} with fractions in (0,1] summing to at most 1. Refines materials; {} means proportions unknown.';
COMMENT ON COLUMN ci.inventory.acquisition_method IS
  'How it came to be owned. Distinguishes a purchase from a gift — acquired_at and purchase_price mean different things for each.';
COMMENT ON COLUMN ci.inventory.acquired_from IS
  'Seller, giver or source as free text, for units whose counterparty is not (yet) a graph entity.';
COMMENT ON COLUMN ci.inventory.acquired_from_entity_id IS
  'The Person/Organization/Place it came from, once resolved. acquired_from keeps the raw string either way.';
COMMENT ON COLUMN ci.inventory.manufactured_at IS
  'When the object was made — the start of its physical life, not of ownership.';
COMMENT ON COLUMN ci.inventory.expires_at IS
  'When the object stops being usable (perishables, medication, batteries). Distinct from warranty_expires_at, which is a contract.';

-- ---------------------------------------------------------------------------
-- Indexes.
-- ---------------------------------------------------------------------------
-- Containment lookups: "what do I own that is made of leather", "show me the
-- black things". GIN over the arrays is what makes `@>` a lookup and not a scan.
CREATE INDEX IF NOT EXISTS inventory_colors_gin_idx
    ON ci.inventory USING GIN (colors) WHERE colors IS NOT NULL;
CREATE INDEX IF NOT EXISTS inventory_materials_gin_idx
    ON ci.inventory USING GIN (materials) WHERE materials IS NOT NULL;

-- "What did I buy in March" has been unindexed since acquired_at was created.
CREATE INDEX IF NOT EXISTS inventory_acquired_at_idx
    ON ci.inventory (user_id, acquired_at DESC) WHERE acquired_at IS NOT NULL;

-- Ascending: the only useful question about expiry is what expires SOONEST.
CREATE INDEX IF NOT EXISTS inventory_expires_at_idx
    ON ci.inventory (user_id, expires_at) WHERE expires_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS inventory_acquired_from_idx
    ON ci.inventory (acquired_from_entity_id) WHERE acquired_from_entity_id IS NOT NULL;

-- migrate:down
DROP INDEX IF EXISTS ci.inventory_acquired_from_idx;
DROP INDEX IF EXISTS ci.inventory_expires_at_idx;
DROP INDEX IF EXISTS ci.inventory_acquired_at_idx;
DROP INDEX IF EXISTS ci.inventory_materials_gin_idx;
DROP INDEX IF EXISTS ci.inventory_colors_gin_idx;

ALTER TABLE ci.inventory DROP CONSTRAINT IF EXISTS inventory_digital_is_incorporeal_check;
ALTER TABLE ci.inventory DROP CONSTRAINT IF EXISTS inventory_acquisition_method_check;
ALTER TABLE ci.inventory DROP CONSTRAINT IF EXISTS inventory_composition_check;
ALTER TABLE ci.inventory DROP CONSTRAINT IF EXISTS inventory_color_hex_check;
ALTER TABLE ci.inventory DROP CONSTRAINT IF EXISTS inventory_materials_check;
ALTER TABLE ci.inventory DROP CONSTRAINT IF EXISTS inventory_colors_check;
ALTER TABLE ci.inventory DROP CONSTRAINT IF EXISTS inventory_unit_system_check;
ALTER TABLE ci.inventory DROP CONSTRAINT IF EXISTS inventory_volume_positive_check;
ALTER TABLE ci.inventory DROP CONSTRAINT IF EXISTS inventory_mass_positive_check;
ALTER TABLE ci.inventory DROP CONSTRAINT IF EXISTS inventory_dimensions_positive_check;

ALTER TABLE ci.inventory
    DROP COLUMN IF EXISTS expires_at,
    DROP COLUMN IF EXISTS manufactured_at,
    DROP COLUMN IF EXISTS acquired_from_entity_id,
    DROP COLUMN IF EXISTS acquired_from,
    DROP COLUMN IF EXISTS acquisition_method,
    DROP COLUMN IF EXISTS composition,
    DROP COLUMN IF EXISTS materials,
    DROP COLUMN IF EXISTS color_hex,
    DROP COLUMN IF EXISTS colors,
    DROP COLUMN IF EXISTS unit_system,
    DROP COLUMN IF EXISTS volume_ml,
    DROP COLUMN IF EXISTS mass_g,
    DROP COLUMN IF EXISTS height_mm,
    DROP COLUMN IF EXISTS width_mm,
    DROP COLUMN IF EXISTS length_mm;

DROP FUNCTION IF EXISTS ci.is_normalized_composition(JSONB);
