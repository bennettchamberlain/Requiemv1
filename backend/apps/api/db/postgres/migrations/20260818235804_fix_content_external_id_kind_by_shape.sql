-- migrate:up
-- Re-derive ci.content.external_id_kind from the SHAPE of external_id, and
-- repair the rows the first backfill (20260818215331_add_content_external_id_
-- kind) mislabelled.
--
-- ## What went wrong in 20260818215331
--
-- That migration classified by SOURCE SYSTEM:
--
--   UPDATE ci.content SET external_id_kind = 'external_uri'
--    WHERE external_id IS NOT NULL AND source_type = 'ci-import-tools'
--      AND source_system = 'spotify';
--   UPDATE ci.content SET external_id_kind = 'file'
--    WHERE external_id IS NOT NULL AND source_type = 'ci-import-tools'
--      AND source_system IS DISTINCT FROM 'spotify';
--
-- The second statement is an "everything that is not Spotify is a file id"
-- rule. That was a true observation of one appliance's data on 2026-08-18, not
-- a structural property: Spotify is not the only in-tree datasource that mints
-- a source-native URI. `toContentInput` (domains/import/push/inputs.ts) stamps
-- `external_id` from `metadata.URI` for ANY record that carries one, and four
-- other datasources set that field:
--
--   datasources/amazon_music.ts    'amazonmusic:track:<ident>' / 'amazonmusic:album:<asin>'
--   datasources/audible.ts         'audible:asin:<asin>'
--   datasources/kindle_reading.ts  'kindle:asin:<asin>' / 'kindle:doc:<asin>'
--   datasources/prime_video.ts     'primevideo:title:<sha1-16>'
--
-- Any such row present when 20260818215331 ran was stamped 'file' -- a claim
-- that `external_id` is a `ci.files.id`, about a value that can never resolve
-- against ci.files. That is precisely the mis-resolution the column was added
-- to prevent, and it is the one class of error a consumer cannot detect
-- (ContentService.findMediaFilesByEventIds lets NULL through but TRUSTS
-- 'file').
--
-- Those UPDATEs were also unguarded -- no `AND external_id_kind IS NULL` -- so
-- re-running that migration on a database where a later, better writer had
-- already classified a row would silently re-stamp it back to the wrong value.
--
-- ## The rule this migration uses instead
--
-- The value's own shape, which is a structural property and stays true as new
-- datasources land. It mirrors `classifyExternalId()` in
-- backend/apps/api/src/domains/memory/externalIdKind.ts EXACTLY -- the two are
-- one rule with two implementations and MUST be changed together:
--
--   external_id ~ '^[a-z_]+:'                  -> 'external_uri'
--     A scheme-prefixed source-native id: spotify:, amazonmusic:, audible:,
--     kindle:, primevideo:, and any URL scheme (https:) a source hands us.
--   external_id ~* '^<8-4-4-4-12 hex>$'        -> 'file'
--     A ci.files.id (uuidv7), fully anchored.
--   anything else                              -> left NULL (unclassified)
--     A bare platform id -- a YouTube videoId, a Google Drive fileId, a
--     Facebook post id, a Steam appid -- is not distinguishable from any other
--     opaque string by looking at it. Guessing 'file' for those is the exact
--     mistake above; NULL is the honest answer, and the WRITERS now stamp them
--     (see below) so this class shrinks to pre-existing rows only.
--
-- The two patterns are disjoint by construction: a UUID contains no colon, and
-- the URI pattern requires a colon preceded only by [a-z_].
--
-- ## Which rows this migration deliberately RE-STAMPS, and why
--
-- Statement 1 is the repair, and it is the ONLY statement here that overwrites
-- a non-NULL value. It re-stamps rows where external_id_kind = 'file' but
-- external_id is scheme-prefixed. Those rows are wrong by inspection of the
-- value itself, so leaving them alone to honour "only stamp what is unstamped"
-- would preserve the defect. It is scoped to the 'file' -> 'external_uri'
-- direction only; it can never demote a correctly-stamped file row, because a
-- UUID cannot match the URI pattern.
--
-- Statements 2 and 3 are additive and carry `AND external_id_kind IS NULL`:
-- they classify rows no writer and no earlier backfill has spoken for. They
-- must never overwrite, because a writer that stamped a value explicitly knows
-- more than the shape test does (the ETL transforms stamp 'external_uri' for
-- bare platform ids this SQL leaves NULL).
--
-- ## Verified against the appliance corpus before writing this migration
--
--   SELECT external_id_kind, external_id ~ '^[a-z_]+:' AS uri_shaped,
--          source_system, count(*)
--     FROM ci.content WHERE external_id IS NOT NULL GROUP BY 1,2,3;
--   -- 33499 external_uri / uri_shaped / spotify
--   -- 11432 file / not uri_shaped, all UUID-shaped (google_photos, gmail,
--   --       apple_photos, generic, whatsapp, facebook, twitter, grok)
--   -- 0 rows outside those two buckets.
--
-- So on that corpus statement 1 repairs 0 rows: no amazon_music / audible /
-- kindle / prime_video content had been imported there yet. The defect is
-- latent, not dormant -- the next import of any of those four sources into a
-- database whose external_id_kind column predates it produces mislabelled
-- rows, and this migration is what an appliance that already ran that import
-- needs. Statements 2 and 3 are also 0-row there (every row was already
-- stamped by 20260818215331), which is what "narrow" means: on an
-- already-correct database this migration touches nothing at all.
--
--   -- The ::uuid cast is CASE-guarded on purpose: external_id is TEXT and a
--   -- LEFT JOIN's ON clause runs over every left row, including the
--   -- 'spotify:track:...' ones, so an unguarded cast raises 22P02.
--   SELECT count(*) FROM ci.content c
--     LEFT JOIN ci.files f
--       ON f.id = (CASE WHEN c.external_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
--                       THEN c.external_id::uuid END)
--    WHERE c.external_id_kind = 'file' AND f.id IS NULL;
--   -- 0 violations (the integrity check added alongside this migration as
--   --   GET /api/maintenance/content/external-id-kind reports the same figure
--   --   on demand; see ExternalIdKindIntegrityService).
--
-- ## Idempotency
--
-- Every statement's WHERE clause is the negation of its own effect: after
-- statement 1 no 'file' row is scheme-prefixed, and after 2 and 3 no NULL row
-- matches either shape. A second run therefore updates zero rows. Re-running
-- is also safe against a NEWER writer: 2 and 3 only touch NULLs, and 1 only
-- touches a value that is provably wrong.

-- 1. Repair: scheme-prefixed values wrongly stamped 'file' by 20260818215331.
UPDATE ci.content
   SET external_id_kind = 'external_uri'
 WHERE external_id_kind = 'file'
   AND external_id ~ '^[a-z_]+:';

-- 2. Classify unstamped scheme-prefixed values (rows written after
--    20260818215331 by a path that did not stamp, or skipped by its
--    source_type = 'ci-import-tools' filter -- e.g. every source_type = 'ETL'
--    row).
UPDATE ci.content
   SET external_id_kind = 'external_uri'
 WHERE external_id_kind IS NULL
   AND external_id ~ '^[a-z_]+:';

-- 3. Classify unstamped UUID-shaped values as file ids. Anchored on both ends:
--    a value that merely starts with something UUID-like is not a file id.
UPDATE ci.content
   SET external_id_kind = 'file'
 WHERE external_id_kind IS NULL
   AND external_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

-- Restate the column's meaning now that it is derived from shape rather than
-- from a source list, and now that 'external_uri' covers bare platform ids the
-- ETL writers stamp explicitly (a Spotify track id, a YouTube videoId, a
-- Google Drive fileId) as well as scheme-prefixed URIs.
COMMENT ON COLUMN ci.content.external_id_kind IS
  'What content.external_id references, when set: ''file'' = a ci.files.id (no FK; locally-captured/uploaded media), ''external_uri'' = a source-native reference that never resolves against ci.files -- either scheme-prefixed (spotify:track:<id>, amazonmusic:album:<asin>, audible:asin:<asin>, kindle:asin:<asin>, primevideo:title:<sha1>) or a bare platform id stamped by the writer that minted it (a YouTube videoId, a Google Drive fileId, a Facebook post id). NULL = unclassified: a pre-existing row whose external_id fits neither shape and whose writer did not say. Derived by classifyExternalId() in domains/memory/externalIdKind.ts, mirrored in SQL by migration 20260818235804_fix_content_external_id_kind_by_shape. Read paths that join external_id against ci.files MUST exclude ''external_uri'' rows rather than assume every row is a file id (see ContentService.findMediaFilesByEventIds).';

-- ## Post-migration verification
--
-- Should now be 0 (no 'file' row is scheme-prefixed):
--   SELECT count(*) FROM ci.content
--    WHERE external_id_kind = 'file' AND external_id ~ '^[a-z_]+:';
--
-- Should now be 0 (nothing shape-classifiable is left unstamped):
--   SELECT count(*) FROM ci.content
--    WHERE external_id_kind IS NULL AND external_id IS NOT NULL
--      AND (external_id ~ '^[a-z_]+:'
--           OR external_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');
--
-- Every 'file' row should resolve against ci.files (the integrity check --
-- same CASE-guarded join as above, or just call
-- GET /api/maintenance/content/external-id-kind):
--   SELECT count(*) FROM ci.content c
--     LEFT JOIN ci.files f
--       ON f.id = (CASE WHEN c.external_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
--                       THEN c.external_id::uuid END)
--    WHERE c.external_id_kind = 'file' AND f.id IS NULL;

-- migrate:down
-- No-op: irreversible data repair, same reasoning as
-- 20260818213148_backfill_google_voice_call_heading_duplication and
-- 20260818212254_backfill_position_coordinate_names. Nothing records which
-- rows were mislabelled versus already correct, and the value this restores is
-- derived from external_id itself, so there is no prior state worth returning
-- to -- rolling back would only reinstate the wrong classification. The column
-- itself is still dropped by 20260818215331's own down migration.
