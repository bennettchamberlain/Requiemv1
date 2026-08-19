-- migrate:up
-- Backfill: de-duplicate the call-type heading inside
-- ci.communications.content (and its whitespace-collapsed copy in
-- .preview) for Google Voice call/voicemail records imported before
-- 3e5956cb0 ("a call-log heading is not a person, and neither is a
-- filename") fixed the parser.
--
-- ## The bug
--
-- Some Google Voice exports put the call-type heading and the contact name
-- in ONE shared `<span class="fn">` with no tag boundary between them, e.g.
-- `<span class="fn">Missed call from\nSteven Stone</span>`. The old
-- `extractSender()` (backend/apps/api/src/domains/import/datasources/
-- googlevoice.ts) took that whole span verbatim, so `sender.name` became
-- "Missed call from\nSteven Stone" instead of "Steven Stone". That value is
-- `contact` in `processCallLog()`, which is then wrapped in a SECOND copy of
-- the same heading template — `` `${callType} call ${preposition} ${contact}` ``
-- — producing "Missed call from" + " " + "Missed call from\nSteven Stone".
-- The result is stored verbatim as both the item's content and
-- metadata.Description, which `descriptionFor()` (push/canonical.ts) copies
-- into `ci.communications.content` (there is no Text/Body/Message field on a
-- call record to take priority). `toCommunicationInput()` (push/inputs.ts)
-- separately derives `.preview` from `content` via `clip()`, which collapses
-- the internal whitespace/newline the duplication leaves behind — so the
-- same duplicated text shows up a second time in `.preview` wherever it was
-- set (`preview` is only written when it differs from `content`).
--
-- ## Scope: exactly the three verbs where the built heading is a LITERAL
-- ## duplicate of the raw markup heading
--
-- `processCallLog` always builds `${callType} call ${preposition}` from the
-- FILENAME-derived call type — e.g. "Missed call from", "Placed call to",
-- "Received call from" for the Missed/Placed/Received verbs. For those three,
-- the raw Google Voice markup heading is textually IDENTICAL to that built
-- string, so the corruption is an exact self-duplicate a SQL backreference
-- can safely detect and collapse.
--
-- Voicemail and Recorded records do NOT have this property: the real export
-- heading reads "Voicemail from" / "Recorded call with" while the built
-- prefix reads "Voicemail call from" / "Recorded call from" — related
-- corruption, but not a literal repeat, so it does not match (and is not
-- touched by) the backreference pattern below. Left for separate follow-up.
--
-- ## Verified against a real appliance database before writing this migration
--
--   SELECT count(*) FROM ci.communications
--    WHERE communication_type = 'call' AND source_system = 'google_voice';
--   -- 38398 total Google Voice call/voicemail records
--
--   SELECT count(*) FROM ci.communications
--    WHERE communication_type = 'call' AND source_system = 'google_voice'
--      AND content ~ '^((?:Missed|Placed|Received) call (?:from|to))\s*\1(?:\s+\S.*)?$';
--   -- 35162 rows match the exact duplication pattern (18599 Placed, 10449
--   -- Received, 6114 Missed) -- matches the affected-row count reported
--   -- alongside this fix. 8488 of those have no name after the doubled
--   -- heading at all (the pattern collapses to a single heading with
--   -- nothing fabricated in its place -- there is nothing to recover).
--
--   -- Zero rows outside the three verbs matched, and zero rows WITHIN the
--   -- three verbs failed to match the full-string anchored pattern (no
--   -- partial/unexpected shapes to worry about):
--   SELECT count(*) FROM ci.communications
--    WHERE communication_type = 'call' AND source_system = 'google_voice'
--      AND content ~ '^(?:Missed|Placed|Received) call (?:from|to)'
--      AND content !~ '^((?:Missed|Placed|Received) call (?:from|to))\s*\1(?:\s+\S.*)?$';
--   -- 0
--
--   -- .preview, where set, is always exactly the whitespace-collapsed copy
--   -- of .content for these rows (never independently corrupted, never
--   -- truncated -- max content length among them is 72 chars, well under
--   -- clip()'s 140-char limit):
--   SELECT count(*) FROM ci.communications
--    WHERE communication_type = 'call' AND source_system = 'google_voice'
--      AND content ~ '^(?:Missed|Placed|Received) call (?:from|to)'
--      AND preview IS NOT NULL
--      AND preview <> regexp_replace(btrim(content), '\s+', ' ', 'g');
--   -- 0
--
-- ## The fix, and why .preview is set to NULL rather than a fixed string
--
-- `content` becomes exactly one heading occurrence, followed by a single
-- space and whatever name text followed the SECOND (duplicate) heading, if
-- any -- nothing is fabricated for the nameless rows.
--
-- Once de-duplicated, the fixed `content` never contains the internal
-- newline/multi-space run that made `.preview` diverge from `.content` in
-- the first place (that run lived entirely inside the now-removed duplicate
-- span). `toCommunicationInput()` only ever populates `.preview` when it
-- differs from `.content` -- so a freshly-imported, never-corrupted row of
-- this shape has `.preview IS NULL`, and that is what this migration
-- restores rather than recomputing a `.preview` value that would just
-- equal the new `.content` anyway.
--
-- Idempotent: the WHERE clause is the same backreference pattern used to
-- find the corruption, so once `content` no longer duplicates the heading,
-- a second run matches (and therefore updates) zero rows -- verified above
-- that the pattern already has zero false positives against clean
-- "heading" / "heading name" shapes.
UPDATE ci.communications AS c
   SET content = fixed.new_content,
       preview = NULLIF(regexp_replace(btrim(fixed.new_content), '\s+', ' ', 'g'), fixed.new_content)
  FROM (
    SELECT id,
           rtrim(
             regexp_replace(
               content,
               '^((?:Missed|Placed|Received) call (?:from|to))\s*\1(?:\s+(\S.*))?$',
               E'\\1 \\2'
             )
           ) AS new_content
      FROM ci.communications
     WHERE communication_type = 'call'
       AND source_system = 'google_voice'
       AND content ~ '^((?:Missed|Placed|Received) call (?:from|to))\s*\1(?:\s+\S.*)?$'
  ) AS fixed
 WHERE c.id = fixed.id;

-- ## Post-migration verification
--
-- Should now be 0:
--   SELECT count(*) FROM ci.communications
--    WHERE communication_type = 'call' AND source_system = 'google_voice'
--      AND content ~ '^((?:Missed|Placed|Received) call (?:from|to))\s*\1(?:\s+\S.*)?$';
--
-- Spot check a formerly-duplicated row:
--   SELECT content, preview FROM ci.communications
--    WHERE communication_type = 'call' AND source_system = 'google_voice'
--      AND content = 'Placed call to William E Broza';

-- migrate:down
-- No-op: irreversible data backfill, same reasoning as
-- 20260628000000_backfill_content_user_id, 20260818174213_backfill_
-- capture_content_rows and 20260818212254_backfill_position_coordinate_names
-- -- the duplicated heading this removes was never meaningful content, and
-- nothing records which rows were touched versus already clean, so there is
-- no source of truth to roll back to.

