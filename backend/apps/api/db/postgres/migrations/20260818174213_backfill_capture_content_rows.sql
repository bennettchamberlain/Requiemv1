-- migrate:up
-- Backfill ci.content rows for photo/video events imported before 8abfb5de5.
--
-- destinationsFor (backend/apps/api/src/domains/import/push/canonical.ts) used
-- to route a dated capture.* record to ['events'] alone, never
-- ['events', 'content'] — so EventMediaLoader's inner join
-- (ContentService.findMediaFilesByEventIds, joining ci.content to ci.events on
-- the shared (source_type, source_system, source_id) triple) had no content
-- row to find, and every gallery tile rendered blank regardless of how many
-- files MediaStage had actually uploaded. 8abfb5de5 fixed what NEW imports
-- write; this migration recovers the events that already landed in ci.events
-- with the old, incomplete destination list.
--
-- ## Why the bytes are still recoverable
--
-- MediaStage (backend/apps/api/src/domains/import/stages/MediaStage.ts) stamps
-- the uploaded ci.files id onto the staged item's own metadata as `FileId`
-- BEFORE PushStage runs (the stage that reads it necessarily follows the stage
-- that writes it — "it runs BEFORE push because the push reads what it
-- writes"). toEventInput (backend/apps/api/src/domains/import/push/inputs.ts)
-- spreads that same metadata object onto ci.events.metadata verbatim. So every
-- dated capture event ever pushed through the real pipeline already carries
-- its own file's id at metadata->>'FileId' — a durable pointer into ci.files
-- this migration only has to read, not reconstruct.
--
-- A capture event with NO FileId never had bytes uploaded in the first place
-- (its media_type never matched MediaStage's image/video/audio predicate —
-- e.g. an Instagram row misclassified as text/plain) and is deliberately
-- excluded below: there is nothing to link, and only a re-import can produce
-- the missing bytes.
--
-- Verified against a real appliance database before writing this migration:
-- 2,098 capture events with no linked content row (apple_photos 1,574,
-- whatsapp 507, facebook 10, instagram 6, grok 1) — of which 2,092 carry a
-- FileId that resolves to a live (non-deleted), correctly-owned ci.files row;
-- the remaining 6 (instagram) have no FileId at all and stay unfixed here.
--
-- ## What each new row contains
--
-- Mirrors exactly what toContentInput/toEventInput would have written at push
-- time: type='media' (contentTypeFor treats every capture.* kind as media),
-- external_id = the file id, mimetype from the file's own content_type,
-- source_data = the event's own metadata jsonb (the SAME object that fed both
-- toEventInput and toContentInput originally — recovered, not fabricated),
-- and title/description copied from the linked event's own ci.entities base
-- row rather than invented. event_id is set directly rather than left for
-- ContentService's triple auto-link, since that auto-link is exactly the
-- mechanism a real re-import would have used and this migration stands in for.

-- Guards a manual re-run inside a session that already ran this migration and
-- has not committed/disconnected (ON COMMIT DROP only clears it at commit).
DROP TABLE IF EXISTS _capture_content_backfill;

CREATE TEMP TABLE _capture_content_backfill ON COMMIT DROP AS
SELECT
  e.event_id,
  e.user_id,
  e.source_type,
  e.source_system,
  e.source_id,
  e.metadata AS event_metadata,
  COALESCE(
    NULLIF(TRIM(e.metadata ->> 'URL'), ''),
    NULLIF(TRIM(e.metadata ->> 'Url'), ''),
    NULLIF(TRIM(e.metadata ->> 'url'), '')
  ) AS content_url,
  COALESCE(NULLIF(TRIM(eb.description), ''), NULLIF(TRIM(e.metadata ->> 'Text'), '')) AS content_text,
  f.id AS file_id,
  f.content_type AS mimetype,
  COALESCE(NULLIF(TRIM(eb.name), ''), 'Untitled') AS content_title,
  eb.description AS entity_description,
  ci.gen_uuid_v7() AS content_id
FROM ci.events e
JOIN ci.entities eb ON eb.entity_id = e.event_id AND eb.entity_type = 'Event'
JOIN ci.files f ON f.id = (e.metadata ->> 'FileId')::uuid
WHERE e.category = 'capture'
  AND e.metadata ->> 'FileId' IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM ci.content c WHERE c.event_id = e.event_id
  )
  -- Defensive, not expected to ever match: events_source_triple_uniq already
  -- guarantees no two events share a (user_id, source_type, source_system,
  -- source_id) triple, and the event_id check above already excludes every
  -- event that already has a content row. But content_source_triple_uniq
  -- governs INSERTs into a different table, so a migration that skips a
  -- would-be collision here instead of relying on that invariant holding is
  -- the safer failure mode — and it is what keeps this safe to run more than
  -- once.
  AND NOT EXISTS (
    SELECT 1 FROM ci.content c2
     WHERE e.source_id IS NOT NULL
       AND c2.user_id = e.user_id
       AND c2.source_type IS NOT DISTINCT FROM e.source_type
       AND c2.source_system IS NOT DISTINCT FROM e.source_system
       AND c2.source_id = e.source_id
  );

-- Base CTI row first (content_id_entities_fk is DEFERRABLE INITIALLY
-- DEFERRED, so order only matters for readability — matches the order the two
-- CTI conversion migrations use).
INSERT INTO ci.entities
  (entity_id, entity_type, name, description, properties, owner_user_id, linked_table, linked_id, created_at, updated_at)
SELECT
  content_id, 'Content', content_title, entity_description, '{}'::jsonb, user_id, 'content', content_id, now(), now()
FROM _capture_content_backfill;

INSERT INTO ci.content
  (id, type, text, url, mimetype, external_id, source_data, user_id, event_id, source_type, source_system, source_id)
SELECT
  content_id, 'media', content_text, content_url, mimetype, file_id::text, event_metadata, user_id, event_id,
  source_type, source_system, source_id
FROM _capture_content_backfill;

-- migrate:down
-- No-op: irreversible data backfill, same reasoning as
-- 20260628000000_backfill_content_user_id — the rows this creates are real
-- recovered content (a live ci.files row genuinely belongs to that event),
-- not scratch state, and nothing marks them as distinguishable afterward from
-- a row a normal re-import would have produced.
