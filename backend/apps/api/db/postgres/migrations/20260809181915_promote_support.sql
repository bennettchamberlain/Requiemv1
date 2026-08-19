-- migrate:up
-- =====================================================================
-- PROMOTE SUPPORT — Phase 8
-- =====================================================================
-- Two `promote.*` stages get writers in this change:
--
--   promote.place   ci.entities (Location: place_kind / parent_place_id /
--                   location_point / location_boundary) and the
--                   ci.events.location_entity_id link that makes a place's
--                   visit count answerable.
--   promote.object  ci.inventory, from `commerce.purchase` events.
--
-- Neither needs a new table or a new column: the rich schema was migrated in
-- 20260803223013 / 20260808150200 and has been sitting empty ever since. What
-- it needed was a writer, and what a writer needs from the database is exactly
-- two things — an index that keeps the sweep cheap, and a comment on every
-- column so the NEXT audit does not have to grep the whole backend to discover
-- that nothing fills them.
--
-- Deliberately NOT here: any DDL for ci.product_models, ci.receipts,
-- ci.receipt_line_items, ci.object_observations or ci.object_identifiers.
-- Those tables still have no reader anywhere in the backend, and the Phase 8
-- gate is that a table gets a read path in the same change as its writer.
-- Adding storage support for a write that is not allowed to happen yet would
-- be the third write-only shipment in a row.

-- ---------------------------------------------------------------------
-- 1. The promote.object sweep index
-- ---------------------------------------------------------------------
-- `PipelineStateService.selectStale` pages its candidates by KEYSET in
-- `event_id` order, filtered by `user_id` and the stage's applicability
-- predicate:
--
--   SELECT s.event_id FROM ci.events s
--    WHERE s.user_id = $3
--      AND (s.event_type IN ('purchase','order') AND COALESCE(s.is_deleted,false) = false)
--      AND NOT EXISTS (... ci.pipeline_state ...)
--      AND ($5::uuid IS NULL OR s.event_id > $5::uuid)
--    ORDER BY s.event_id LIMIT $6;
--
-- There is no index whose leading columns are (user_id, event_id), so Postgres
-- walks `events_pkey` and applies the type filter as it goes. That is tolerable
-- on the FIRST hop and pathological on the LAST one, because a keyset cursor
-- near the end of the table has to skip every non-commerce row before it.
-- Measured on the dev appliance (324,044 events, 2,777 of them commerce), last
-- hop, EXPLAIN (ANALYZE, BUFFERS) on the scan node alone:
--
--   events_pkey scan + filter      60,893 buffers   309,787 rows discarded   184 ms
--   this index (Index Only Scan)   19,703 buffers             0 discarded     33 ms
--
-- The residual 19,703 is an artifact of measuring a just-created index inside a
-- rolled-back transaction: the visibility map is unset, so every tuple is
-- fetched from the heap anyway. Once autovacuum sets it, the same hop is the
-- 744-buffer first-hop number. The figure that survives either way is the
-- 309,787 discarded rows — the sweep pays for the whole corpus on every hop,
-- once per hop, for a stage that applies to 0.9 % of it.
--
-- (user_id, event_id) and not (event_id) alone: user_id is an equality
-- predicate and event_id is the ordering, which is the one column order that
-- lets a single index serve both without a sort.
--
-- ci.events is 324k rows, so this CREATE INDEX holds a SHARE lock — writes
-- blocked, reads not — for the length of a partial-index build over ~2.8k
-- matching rows, i.e. well under a second. dbmate runs a migration inside a
-- transaction and CREATE INDEX CONCURRENTLY cannot run in one, so a corpus
-- where that trade is wrong wants this built out of band instead.
CREATE INDEX IF NOT EXISTS events_promote_commerce_sweep_idx
    ON ci.events (user_id, event_id)
 WHERE event_type IN ('purchase', 'order')
   AND COALESCE(is_deleted, false) = false;

COMMENT ON INDEX ci.events_promote_commerce_sweep_idx IS
  'Keyset sweep support for pipeline stage promote.object: (user_id, event_id) over commerce events only. Matches PipelineStateService.selectStale''s user_id equality + ORDER BY event_id exactly. Drop it only alongside the stage.';

-- No sibling index for promote.place. Its predicate
-- (location_coordinates IS NOT NULL AND location_name IS NOT NULL) already
-- rides `events_location_coordinates_gix`, and the same measurement puts the
-- whole sweep at 99 buffers / 0.29 ms over 405 located rows. An index added
-- against a number that has not been measured to be a problem is a write-time
-- cost on every ci.events INSERT in exchange for nothing.

-- ---------------------------------------------------------------------
-- 2. Provenance is documented, not stored in new columns
-- ---------------------------------------------------------------------
-- Promotion has to be REVERSIBLE: a promoted row must be traceable to what
-- produced it and withdrawable without collateral damage. The rebuild plan
-- (§8.4) puts that provenance in `properties` for ci.entities and in a
-- per-table jsonb bag elsewhere, and both columns already exist — so this is a
-- comment, not a column.
--
-- Both stages write the same envelope under the key `promote`:
--
--   {"promote": {"stage": "promote.place", "version": 1,
--                "event_id": "<uuid>", "at": "<iso8601>"}}
--
-- and both refuse to overwrite a value whose row does NOT carry that envelope,
-- which is what keeps a user's own edit safe from a version bump. Withdrawal is
-- therefore a predicate, not a diff:
--
--   -- withdraw promote.place
--   UPDATE ci.events SET location_entity_id = NULL,
--          metadata = metadata - 'promote'
--    WHERE user_id = $1 AND metadata->'promote'->>'stage' = 'promote.place';
--   DELETE FROM ci.entities
--    WHERE owner_user_id = $1 AND entity_type = 'Location'
--      AND properties->'promote'->>'stage' = 'promote.place';
--
--   -- withdraw promote.object
--   DELETE FROM ci.inventory
--    WHERE user_id = $1 AND metadata->'promote'->>'stage' = 'promote.object';
--
--   -- then, for either: DELETE FROM ci.pipeline_state WHERE stage = '<id>';
--
-- Deleting the ledger rows LAST is what makes the withdrawal complete rather
-- than merely destructive — leave them and the next sweep sees a converged
-- corpus and re-promotes nothing.

COMMENT ON COLUMN ci.entities.location_boundary IS
  'Observed geographic footprint of a place, as a geography(Polygon). Written by pipeline stage promote.place: the convex hull of every ci.events.location_coordinates linked to this place, buffered by the positional uncertainty and floored at half a location-dedupe cell (~56 m — the distance at which entities_location_snap_dedup_uniq already treats two coordinates as the same place). NOT an administrative boundary. Rows carrying properties->promote were written by the stage and may be replaced by it; rows without it are user- or importer-authored and are never touched.';

COMMENT ON COLUMN ci.entities.place_kind IS
  'Geographic level, room -> planet. Written by PlaceService.findOrCreateForGeocode (leaf, ''address'') and PlaceService.ensureHierarchy (city/region/country nodes), both driven by pipeline stage promote.place. Constrained by valid_place_kind.';

COMMENT ON COLUMN ci.entities.parent_place_id IS
  'Containing place: venue -> city -> region -> country. Written by PlaceService.ensureHierarchy from the geocode provider''s address_components, which promote.place reads out of ci.geocode_cache — never by calling the provider. An unparented place means the geocode cache held no components for its name, not that it has no parent.';

COMMENT ON COLUMN ci.events.location_entity_id IS
  'The ci.entities Location this event happened at. Written by pipeline stage promote.place (and, until it is retired, GeocodeBatchListener). Read by PlaceService.getVisitStats, which is what makes PlaceType.visitStats a number rather than a permanent zero.';

COMMENT ON COLUMN ci.inventory.lifecycle_state IS
  'Ownership state. Written by pipeline stage promote.object as ''active'' for every promoted purchase, digital or not: a receipt records an acquisition and says nothing about what became of the thing, and promoting a 2022 grocery line as ''consumed'' would be a guess dressed as a fact. Moving it is a user action or a later clean.* stage. Read via ItemService -> ItemEntity.toEgressType -> Item.lifecycleState.';

COMMENT ON COLUMN ci.inventory.identity_confidence IS
  'How sure we are this row is the thing it claims to be, in (0,1]. Written by pipeline stage promote.object: 0.9 when the purchase carried a normalizable product identifier (ASIN/ISBN), 0.55 when only a product NAME was on the receipt. Never fabricated upward — the rebuild plan gates product-model minting at >= 0.5, so this number decides what a later stage is allowed to do with the row.';

COMMENT ON COLUMN ci.inventory.identity_method IS
  'How identity was established. Written by pipeline stage promote.object as ''receipt''. Constrained by inventory_identity_method_check.';

COMMENT ON COLUMN ci.inventory.quantity IS
  'Units this row represents. Written by pipeline stage promote.object from the purchase line quantity: one row per receipt LINE, not per unit, because the source cannot tell the units apart.';

COMMENT ON COLUMN ci.inventory.product_id IS
  'FK to ci.product_models. STILL UNWRITTEN. promote.object deliberately leaves it NULL: filling it requires minting a ci.product_models row, and that table has no reader anywhere in the backend (no service, no resolver, no operator endpoint), so writing it would fail the Phase 8 read-path gate. Unblocking it is a ProductService with findByIds plus an ItemType.product ResolveField, landed in the same change as the writer.';

COMMENT ON COLUMN ci.inventory.acquisition_receipt_id IS
  'FK to ci.receipts. STILL UNWRITTEN, for the same reason as product_id: ci.receipts has no reader. The Amazon corpus does carry order-level rollups (630 ci.events rows of event_type ''order'', one per Order ID) that would populate it, and promote.object records each as skipped: order_rollup_no_line_item so the number is countable instead of invisible.';

COMMENT ON COLUMN ci.inventory.acquisition_line_item_id IS
  'FK to ci.receipt_line_items. STILL UNWRITTEN — see acquisition_receipt_id.';

-- migrate:down
COMMENT ON COLUMN ci.inventory.acquisition_line_item_id IS NULL;
COMMENT ON COLUMN ci.inventory.acquisition_receipt_id IS NULL;
COMMENT ON COLUMN ci.inventory.product_id IS NULL;
COMMENT ON COLUMN ci.inventory.quantity IS NULL;
COMMENT ON COLUMN ci.inventory.identity_method IS NULL;
COMMENT ON COLUMN ci.inventory.identity_confidence IS NULL;
COMMENT ON COLUMN ci.inventory.lifecycle_state IS NULL;
COMMENT ON COLUMN ci.events.location_entity_id IS NULL;
COMMENT ON COLUMN ci.entities.parent_place_id IS NULL;
COMMENT ON COLUMN ci.entities.place_kind IS NULL;
COMMENT ON COLUMN ci.entities.location_boundary IS NULL;

DROP INDEX IF EXISTS ci.events_promote_commerce_sweep_idx;
