-- migrate:up

-- `content.external_id` is structurally overloaded. For locally-captured or
-- uploaded media (the CI-Import-Tools media leg — photos, videos, audio,
-- attachments) it is a `ci.files.id` UUID, with no FK enforcing the join. For a
-- source-native reference (Spotify's `spotify:track:<id>` / `:episode:` /
-- `:show:` URI — see push/inputs.ts toContentInput, which stamps external_id
-- from metadata.URI whenever a source carries one) it is an opaque external
-- platform reference that will never resolve against `ci.files`. Nothing
-- distinguishes the two today, so a read path that joins `external_id` against
-- `ci.files` without additional scoping would silently mis-resolve — the same
-- class of gap that produced the "broken thumbnail" bug already fixed once by
-- migration 20260818174213_backfill_capture_content_rows.
--
-- This column makes the ambiguity explicit and queryable, without a broader
-- redesign: no FK is added (one is not possible while 'external_uri' rows
-- share the column with 'file' rows), and going forward the import pipeline
-- stamps it on every write that also stamps `external_id` (see
-- push/inputs.ts toContentInput).
ALTER TABLE ci.content
  ADD COLUMN IF NOT EXISTS external_id_kind TEXT
    CONSTRAINT content_external_id_kind_check
    CHECK (external_id_kind IS NULL OR external_id_kind IN ('file', 'external_uri'));

COMMENT ON COLUMN ci.content.external_id_kind IS
  'What content.external_id references, when set: ''file'' = a ci.files.id (no FK; locally-captured/uploaded media), ''external_uri'' = an opaque source-native reference that never resolves against ci.files (e.g. Spotify''s spotify:track:<id>). NULL = unclassified — a pre-migration row this backfill could not confidently classify, or a write path not yet updated to stamp it. Read paths that join external_id against ci.files MUST exclude ''external_uri'' rows rather than assume every row is a file id (see ContentService.findMediaFilesByEventIds).';

-- Backfill existing rows. Verified against live data (2026-08-18): every
-- ci.content row carries source_type = 'ci-import-tools' (the ETL connector
-- pipeline under domains/etl has never written a content row on this
-- appliance), and among those, every source_system with a non-null
-- external_id is UUID-shaped and resolves against ci.files EXCEPT spotify,
-- whose external_id is always a spotify: URI. Only these known-good cases are
-- backfilled; anything outside them (a future ETL-written row, a source_type
-- this appliance has not seen) is left NULL rather than guessed.
UPDATE ci.content
SET external_id_kind = 'external_uri'
WHERE external_id IS NOT NULL
  AND source_type = 'ci-import-tools'
  AND source_system = 'spotify';

UPDATE ci.content
SET external_id_kind = 'file'
WHERE external_id IS NOT NULL
  AND source_type = 'ci-import-tools'
  AND source_system IS DISTINCT FROM 'spotify';

-- migrate:down
ALTER TABLE ci.content DROP COLUMN external_id_kind;

