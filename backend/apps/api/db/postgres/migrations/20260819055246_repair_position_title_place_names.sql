-- migrate:up
-- Repair: null out ci.position.name where it holds a TITLE — a message body, a
-- social post, a page headline, a ride narration — instead of a place name, and
-- remove the Location entities `promote.place_position` minted out of those
-- titles.
--
-- The fourth and last of the non-place-name repairs, after 20260818212254 (bare
-- coordinate pairs) and 20260818235752 (media filenames + labelled coordinate
-- pairs). `PositionPlacePromoteStage`'s own docblock has always described this
-- column's upstream as five-way — "a real waypoint name, a reverse-geocoded POI,
-- a street address, a media filename, and a message/post text snippet" — and
-- `isNotAPlaceName` covered four of the five. This is the fifth.
--
-- ## The bug
--
-- `titleFor` (import/push/canonical.ts) gives every record a DISPLAY label, and
-- a record reaches the position partition whenever it carries coordinates: a
-- geotagged tweet, a located message, a search with a fix on it, a trip leg. For
-- all of those the display label is body text or a sentence about what happened,
-- and `toPositionInput` wrote it into `name`. `promote.place_position` then
-- reads a non-blank `name` as "this fix is at a named venue" and calls
-- `PlaceService.findOrCreateForGeocode`, so each sentence became a Location
-- entity and the Places list rendered it as a venue.
--
-- A re-import does NOT repair these. `INGEST_REFRESH_COLUMNS` decides which
-- columns an idempotent re-push overwrites; `name` is written on INSERT, so the
-- row's second arrival leaves the bad value exactly where it is. Hence a
-- migration.
--
-- ## Fixed for future imports in the same commit
--
--   import/push/inputs.ts        `isTitleText`, the fourth arm of
--                                `isNotAPlaceName`; and `toPositionInput` now
--                                reads a record's TITLE as a place name only
--                                when the record's kind is `location.fix` — a
--                                message's title labels the message, not the
--                                ground under it.
--   import/datasources/gpx.ts    `<trk><name>` rides as `Track Name`, not
--                                `Name`. A track name describes the TRACK: one
--                                10 km run stamped its name onto ~1,000
--                                trackpoints, which resolve to ~90 distinct
--                                0.001-degree cells and would mint up to 90
--                                Locations all called "Morning Run".
--   import/datasources/uber.ts   a leg with no recorded address gets no
--                                Title/Name at all instead of falling back to
--                                the ride narration. The narration stays on
--                                `Trip`.
--   pipeline/…/PositionPlacePromoteStage.ts
--                                the same three arms mirrored into
--                                `NOT_A_PLACE_NAME_SQL`, so a row written before
--                                the guard existed is not promoted either.
--
-- ## Verified against the live appliance database before writing this migration
--
-- (Mid-import snapshot — the corpus was still loading, so these counts are a
-- floor, not a total.)
--
--   SELECT count(*) FROM ci.position;                                    -- 203
--   SELECT count(*) FROM ci.position WHERE name IS NOT NULL;             -- 203
--
--   -- Title-shaped names (the three arms below): 44 rows, 44 distinct.
--   --   36 x "Uber ride from <addr> to <addr> (request)"  (uber.ts)
--   --    8 x a geotagged tweet's clipped body, e.g.
--   --        "Check out a replay of BitScoop Labs' first live stream! #BitScoop…"
--   -- 159 named rows survive, and every one is a real place: street addresses
--   -- ("1050 32nd St S, Birmingham, AL 35205, US"), venues ("Irvine Spectrum
--   -- Center - Nordstrom Parking (South Garage)", "On Jane Stanford Way @
--   -- Gilbert Biological Sciences", "A.G. Bartlett Building") and airport
--   -- terminals ("Terminal A, Newark Liberty International Airport (EWR),
--   -- Elizabeth, NJ 07114, US").
--
--   -- Already promoted into the Places list:
--   SELECT count(*) FROM ci.entities WHERE entity_type = 'Location';     -- 118
--   -- of which 7 are a ride narration wearing a place's clothes.
--
-- ## Why the word bound is 14, and why it is in words
--
-- Measured over every distinct non-blank ci.position.name on the corpus, the
-- longest GENUINE name is 14 words — 'Red Roof PLUS+ Boston - Framingham, 650
-- Cochituate Rd, Framingham, MA 01701, United States' — and the shortest
-- narration surviving the ellipsis and punctuation arms is 16. A CHARACTER bound
-- cannot separate them: that hotel is 90 characters, and an 89-character 'Uber
-- ride from Red Rocks Amphitheatre to 717 E Colfax Ave, Denver, CO 80203, US
-- (request)' is shorter. The bound and its justification live with
-- `MAX_PLACE_NAME_WORDS` in import/push/inputs.ts; the two must not drift.
--
-- `.` and `@` are deliberately NOT treated as sentence punctuation: 'A.G.
-- Bartlett Building', 'Bongeunsa Temple. Lotte Duty Free Shop' and 'On Jane
-- Stanford Way @ Gilbert Biological Sciences' are all live values in this very
-- column.
--
-- ## Why NULL is the right value
--
-- Same as its three predecessors: a null name is what makes a row a
-- reverse-geocode candidate ("coordinates present, name missing"), so these
-- fixes end up better named than the sentence ever was. A fake name is strictly
-- worse than no name — it displays as though the place were already known, so
-- nothing ever offers it a real one. Narrow on purpose: only `name` is touched
-- here; geometry, address, source and provider are untouched.
--
-- ## STATEMENT ORDER MATTERS
--
-- The entity cleanup joins ci.entities to ci.position ON THE NAME, to prove a
-- Location was minted FROM a bad position title rather than merely having a
-- wordy name of its own. It must therefore run BEFORE the UPDATE that nulls
-- those names, or its CTE matches nothing.
--
-- ## Why the entity cleanup is scoped by that join and not by name alone
--
-- `promote.place` mints Locations from `ci.events.location_name`, whose upstream
-- is an ICS calendar `LOCATION` field, and those are legitimately long: 'Mintz,
-- Levin, Cohn, Ferris, Glovsky and Popeo, P.C., 3580 Carmel Mountain Road, Suite
-- 300, San Diego, CA, us, 92130' is a real place someone really went to, and it
-- is 19 words. A predicate over `ci.entities.name` alone matched 27 such rows on
-- a second appliance corpus and would have deleted every one. Requiring
-- `btrim(e.name) = btrim(p.name)` against a position whose OWN name is
-- title-shaped is what makes the deletion provably about this bug: on that
-- second corpus the join matches 0, and on the live one it matches exactly the 7
-- ride narrations.
--
-- ## Foreign-key / reference audit for those 7 entity_ids
--
--   ci.position.location_entity_id       36  <- the bug's own links; the FK is
--                                              ON DELETE SET NULL, so the DELETE
--                                              detaches them. A fix whose name
--                                              is nulled becomes a
--                                              reverse-geocode candidate again,
--                                              and `promote.place_position`
--                                              re-links it under a real name.
--   ci.events.location_entity_id          0
--   ci.entities.parent_place_id           0
--   ci.entities.merged_into_entity_id     0
--   ci.relationships (from/to)            0
--   ci.entity_identifiers                 0
--   ci.identifier_claims                  0
--   ci.merge_candidates / entity_merges /
--     entity_merge_blocks                 0
--   ci.inventory / receipts /
--     object_observations                 0
--   ci.users.entity_id                    0
--   ci.devices.device_entity_id           0
--   ci.pipeline_state.entity_id           7  <- handled below (entity_type
--                                              'entity', stage
--                                              clean.identifier_normalize)
--   ci.pipeline_dead_letters.entity_id    0
--   ci_search.vectors.entity_id           7  <- handled below (entity_type 'place')
--   ci_search.embeddings.entity_id        7  <- handled below (entity_type 'place')
--   ci_search.entity_tag / index_skips    0
--   ci.graph_deltas                       7  <- NOT touched, deliberately
--
-- ci.graph_deltas is an append-only change LOG with no foreign key to
-- ci.entities. Its rows record that these entities were once created; rewriting
-- history to hide a repair would be worse than a log entry pointing at a row
-- that no longer exists, which is already the state 20260818220731 and
-- 20260819002002 left behind. Same call as those two.
--
-- The NOT EXISTS guards below are not decoration even though every audited count
-- above is 0: this migration also runs on appliances whose corpus is not this
-- one, and a Location some OTHER table genuinely points at must survive even if
-- a bad position also named it. There it keeps its row and merely loses the
-- position link.
--
-- Idempotent: after the UPDATE no position carries a title-shaped name, so the
-- CTE's join yields zero rows on a second run and every statement affects
-- nothing. NULL fails `~` (NULL, not false), so a cleared name can never
-- re-match.

-- 1. The search bookkeeping for the Locations about to be deleted. The CTE is
--    repeated per statement rather than materialised, exactly as 20260818220731
--    does — it is 7 rows, and a temp table buys nothing inside dbmate's
--    per-file transaction.
WITH bad_locations AS (
  SELECT DISTINCT e.entity_id
    FROM ci.entities e
    JOIN ci.position p ON p.location_entity_id = e.entity_id
   WHERE e.entity_type = 'Location'
     AND btrim(e.name) = btrim(p.name)
     AND (
          btrim(p.name) ~ '…$'
       OR btrim(p.name) ~ '[!?]'
       OR array_length(regexp_split_to_array(btrim(p.name), '\s+'), 1) > 14
     )
     AND NOT EXISTS (SELECT 1 FROM ci.events x WHERE x.location_entity_id = e.entity_id)
     AND NOT EXISTS (SELECT 1 FROM ci.entities x WHERE x.parent_place_id = e.entity_id)
     AND NOT EXISTS (SELECT 1 FROM ci.entities x WHERE x.merged_into_entity_id = e.entity_id)
     AND NOT EXISTS (
       SELECT 1 FROM ci.relationships x
        WHERE x.from_entity_id = e.entity_id OR x.to_entity_id = e.entity_id
     )
     AND NOT EXISTS (SELECT 1 FROM ci.entity_identifiers x WHERE x.entity_id = e.entity_id)
     AND NOT EXISTS (SELECT 1 FROM ci.inventory x WHERE x.last_seen_place_entity_id = e.entity_id)
     AND NOT EXISTS (
       SELECT 1 FROM ci.receipts x
        WHERE x.place_entity_id = e.entity_id OR x.merchant_entity_id = e.entity_id
     )
     AND NOT EXISTS (SELECT 1 FROM ci.object_observations x WHERE x.place_entity_id = e.entity_id)
     AND NOT EXISTS (SELECT 1 FROM ci.users x WHERE x.entity_id = e.entity_id)
)
DELETE FROM ci_search.vectors v
 USING bad_locations bad
 WHERE v.entity_id = bad.entity_id;

WITH bad_locations AS (
  SELECT DISTINCT e.entity_id
    FROM ci.entities e
    JOIN ci.position p ON p.location_entity_id = e.entity_id
   WHERE e.entity_type = 'Location'
     AND btrim(e.name) = btrim(p.name)
     AND (
          btrim(p.name) ~ '…$'
       OR btrim(p.name) ~ '[!?]'
       OR array_length(regexp_split_to_array(btrim(p.name), '\s+'), 1) > 14
     )
     AND NOT EXISTS (SELECT 1 FROM ci.events x WHERE x.location_entity_id = e.entity_id)
     AND NOT EXISTS (SELECT 1 FROM ci.entities x WHERE x.parent_place_id = e.entity_id)
     AND NOT EXISTS (SELECT 1 FROM ci.entities x WHERE x.merged_into_entity_id = e.entity_id)
     AND NOT EXISTS (
       SELECT 1 FROM ci.relationships x
        WHERE x.from_entity_id = e.entity_id OR x.to_entity_id = e.entity_id
     )
     AND NOT EXISTS (SELECT 1 FROM ci.entity_identifiers x WHERE x.entity_id = e.entity_id)
     AND NOT EXISTS (SELECT 1 FROM ci.inventory x WHERE x.last_seen_place_entity_id = e.entity_id)
     AND NOT EXISTS (
       SELECT 1 FROM ci.receipts x
        WHERE x.place_entity_id = e.entity_id OR x.merchant_entity_id = e.entity_id
     )
     AND NOT EXISTS (SELECT 1 FROM ci.object_observations x WHERE x.place_entity_id = e.entity_id)
     AND NOT EXISTS (SELECT 1 FROM ci.users x WHERE x.entity_id = e.entity_id)
)
DELETE FROM ci_search.embeddings em
 USING bad_locations bad
 WHERE em.entity_id = bad.entity_id;

WITH bad_locations AS (
  SELECT DISTINCT e.entity_id
    FROM ci.entities e
    JOIN ci.position p ON p.location_entity_id = e.entity_id
   WHERE e.entity_type = 'Location'
     AND btrim(e.name) = btrim(p.name)
     AND (
          btrim(p.name) ~ '…$'
       OR btrim(p.name) ~ '[!?]'
       OR array_length(regexp_split_to_array(btrim(p.name), '\s+'), 1) > 14
     )
     AND NOT EXISTS (SELECT 1 FROM ci.events x WHERE x.location_entity_id = e.entity_id)
     AND NOT EXISTS (SELECT 1 FROM ci.entities x WHERE x.parent_place_id = e.entity_id)
     AND NOT EXISTS (SELECT 1 FROM ci.entities x WHERE x.merged_into_entity_id = e.entity_id)
     AND NOT EXISTS (
       SELECT 1 FROM ci.relationships x
        WHERE x.from_entity_id = e.entity_id OR x.to_entity_id = e.entity_id
     )
     AND NOT EXISTS (SELECT 1 FROM ci.entity_identifiers x WHERE x.entity_id = e.entity_id)
     AND NOT EXISTS (SELECT 1 FROM ci.inventory x WHERE x.last_seen_place_entity_id = e.entity_id)
     AND NOT EXISTS (
       SELECT 1 FROM ci.receipts x
        WHERE x.place_entity_id = e.entity_id OR x.merchant_entity_id = e.entity_id
     )
     AND NOT EXISTS (SELECT 1 FROM ci.object_observations x WHERE x.place_entity_id = e.entity_id)
     AND NOT EXISTS (SELECT 1 FROM ci.users x WHERE x.entity_id = e.entity_id)
)
DELETE FROM ci.pipeline_state ps
 USING bad_locations bad
 WHERE ps.entity_id = bad.entity_id;

-- 2. The Location rows themselves. Every FK pointing at ci.entities from a
--    place-bearing column is ON DELETE SET NULL, so
--    `ci.position.location_entity_id` detaches on its own.
WITH bad_locations AS (
  SELECT DISTINCT e.entity_id
    FROM ci.entities e
    JOIN ci.position p ON p.location_entity_id = e.entity_id
   WHERE e.entity_type = 'Location'
     AND btrim(e.name) = btrim(p.name)
     AND (
          btrim(p.name) ~ '…$'
       OR btrim(p.name) ~ '[!?]'
       OR array_length(regexp_split_to_array(btrim(p.name), '\s+'), 1) > 14
     )
     AND NOT EXISTS (SELECT 1 FROM ci.events x WHERE x.location_entity_id = e.entity_id)
     AND NOT EXISTS (SELECT 1 FROM ci.entities x WHERE x.parent_place_id = e.entity_id)
     AND NOT EXISTS (SELECT 1 FROM ci.entities x WHERE x.merged_into_entity_id = e.entity_id)
     AND NOT EXISTS (
       SELECT 1 FROM ci.relationships x
        WHERE x.from_entity_id = e.entity_id OR x.to_entity_id = e.entity_id
     )
     AND NOT EXISTS (SELECT 1 FROM ci.entity_identifiers x WHERE x.entity_id = e.entity_id)
     AND NOT EXISTS (SELECT 1 FROM ci.inventory x WHERE x.last_seen_place_entity_id = e.entity_id)
     AND NOT EXISTS (
       SELECT 1 FROM ci.receipts x
        WHERE x.place_entity_id = e.entity_id OR x.merchant_entity_id = e.entity_id
     )
     AND NOT EXISTS (SELECT 1 FROM ci.object_observations x WHERE x.place_entity_id = e.entity_id)
     AND NOT EXISTS (SELECT 1 FROM ci.users x WHERE x.entity_id = e.entity_id)
)
DELETE FROM ci.entities e
 USING bad_locations bad
 WHERE e.entity_id = bad.entity_id;

-- 3. The names themselves. Mirrors `isTitleText` (import/push/inputs.ts) and the
--    last three arms of `NOT_A_PLACE_NAME_SQL`
--    (pipeline/stages/promote/PositionPlacePromoteStage.ts). Every arm compares
--    btrim(name), because the guard trims before testing — without it a name
--    carrying stray whitespace is rejected by the code and missed here, and the
--    two would disagree about the same string.
UPDATE ci.position
   SET name = NULL
 WHERE btrim(name) ~ '…$'
    OR btrim(name) ~ '[!?]'
    OR array_length(regexp_split_to_array(btrim(name), '\s+'), 1) > 14;

-- ## Post-migration verification
--
-- Should now be 0:
--   SELECT count(*) FROM ci.position
--    WHERE btrim(name) ~ '…$' OR btrim(name) ~ '[!?]'
--       OR array_length(regexp_split_to_array(btrim(name), '\s+'), 1) > 14;
--
-- Should now be 0 (no Location survives that a bad position named):
--   SELECT count(*) FROM ci.entities e JOIN ci.position p
--          ON p.location_entity_id = e.entity_id
--    WHERE e.entity_type = 'Location' AND btrim(e.name) = btrim(p.name)
--      AND (btrim(p.name) ~ '…$' OR btrim(p.name) ~ '[!?]'
--           OR array_length(regexp_split_to_array(btrim(p.name), '\s+'), 1) > 14);
--
-- The surviving place list is spot-checkable by eye, and should hold only
-- addresses and venues:
--   SELECT DISTINCT name FROM ci.position WHERE name IS NOT NULL ORDER BY 1;
--   SELECT name FROM ci.entities WHERE entity_type = 'Location' ORDER BY 1;

-- migrate:down
-- No-op: irreversible data repair, same reasoning as
-- 20260818212254_backfill_position_coordinate_names,
-- 20260818235752_backfill_position_non_place_names and
-- 20260818220731_cleanup_group_conversation_filename_person_rows — a clipped
-- tweet and a ride narration were never place names, the Location entities
-- minted from them were never places, and nothing records which rows held one
-- versus a genuine (if wordy) name, so there is no source of truth to roll back
-- to.
