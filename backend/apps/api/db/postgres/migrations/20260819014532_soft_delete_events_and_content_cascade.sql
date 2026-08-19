-- migrate:up
-- =====================================================================
-- SOFT-DELETE EVENTS — make ci.events.is_deleted load-bearing
-- =====================================================================
-- Deleting a memory object is now something a user can do from the app, and
-- for events it is a TOMBSTONE rather than a physical DELETE: EventService
-- flips `is_deleted` and every read path skips flagged rows, so an accidental
-- deletion can be undone instead of cascading irreplaceable imported history
-- away.
--
-- Two bits of schema have to hold up their end of that:
--
-- 1. `is_deleted` was `BOOLEAN DEFAULT FALSE` — nullable. The TypeORM entity
--    has always declared it non-nullable (`isDeleted!: boolean`) and the read
--    filters are written as `is_deleted = false`, which a NULL would fail. No
--    NULLs exist today; this pins that down so a future insert that omits the
--    column cannot make a row invisible.
--
-- 2. `content_event_id_fkey` was ON DELETE SET NULL. A photo/video event
--    carries its binary through a `ci.content` row (type='media'), and that
--    row is only reachable through its event — so a physical event delete
--    stranded it: alive, indexed, `event_id = NULL`, and unreachable from any
--    view. The soft delete above means the FK no longer fires for a user
--    deletion at all, but the physical path still exists (account deletion, a
--    future purge), and CASCADE is the honest semantic for a row that has no
--    independent existence.
-- =====================================================================

UPDATE ci.events SET is_deleted = FALSE WHERE is_deleted IS NULL;

ALTER TABLE ci.events
  ALTER COLUMN is_deleted SET DEFAULT FALSE,
  ALTER COLUMN is_deleted SET NOT NULL;

COMMENT ON COLUMN ci.events.is_deleted IS
  'Tombstone written by EventService.remove and cleared by EventService.restore. Rows flagged TRUE are excluded from every read path and un-indexed from ci_search; they are never returned to a client.';

ALTER TABLE ci.content DROP CONSTRAINT IF EXISTS content_event_id_fkey;

ALTER TABLE ci.content
  ADD CONSTRAINT content_event_id_fkey
  FOREIGN KEY (event_id) REFERENCES ci.events(event_id) ON DELETE CASCADE;

-- migrate:down

ALTER TABLE ci.content DROP CONSTRAINT IF EXISTS content_event_id_fkey;

ALTER TABLE ci.content
  ADD CONSTRAINT content_event_id_fkey
  FOREIGN KEY (event_id) REFERENCES ci.events(event_id) ON DELETE SET NULL;

ALTER TABLE ci.events
  ALTER COLUMN is_deleted DROP NOT NULL;
