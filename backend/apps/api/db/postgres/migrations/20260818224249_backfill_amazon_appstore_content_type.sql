-- migrate:up

-- Amazon Appstore/Play Store app entitlements (amazon.ts RESOURCE_TYPE_MIME /
-- appAsins — mimetype application/vnd.android.package-archive) were routed
-- through the same commerce.purchase -> content('media') lane as an ebook or
-- a movie, because contentTypeFor had no mimetype-based override for the
-- 'app' case before this change. Fixed going forward in push/inputs.ts
-- toContentInput (an app-package mimetype now types 'app' regardless of
-- kind); this is the one-time correction for rows already imported under the
-- old logic. A plain re-import does not fix them on its own — push/
-- ContentService.createMany's conflict path is a find-or-return
-- (INGEST_REFRESH_COLUMNS.content is empty), so a re-synced row is matched by
-- its provenance triple and returned as-is, `type` untouched.
--
-- Scoped tightly to the exact shape of the confirmed bug (source_system =
-- 'amazon', that one mimetype, still carrying the old 'media' type) rather
-- than every 'media' row, so this only ever touches rows this bug could have
-- produced. Verified against live data (2026-08-18): 92 rows match.
UPDATE ci.content
SET type = 'app'
WHERE type = 'media'
  AND source_system = 'amazon'
  AND mimetype = 'application/vnd.android.package-archive';

-- migrate:down
-- No-op: irreversible data correction, same reasoning as
-- 20260628000000_backfill_content_user_id and
-- 20260818174213_backfill_capture_content_rows — 'app' is the correct type
-- for these rows, not a state to roll back from, and nothing marks which rows
-- this touched vs. one a fresh import would already have typed 'app'.
