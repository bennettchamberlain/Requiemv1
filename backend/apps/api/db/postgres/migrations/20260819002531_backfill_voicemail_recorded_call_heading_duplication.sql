-- migrate:up
-- Finish 20260818213148: de-duplicate the call-type heading in
-- ci.communications.content (and its whitespace-collapsed copy in .preview) for
-- the two Google Voice verbs that migration explicitly left behind.
--
-- ## Why there was a leftover
--
-- `processCallLog()` derives CallType from a FIVE-way alternation --
-- /(Missed|Placed|Received|Voicemail|Recorded)/ on the export's filename -- and
-- then wraps the contact in a heading it builds itself,
-- `${callType} call ${preposition} ${contact}`. Before 3e5956cb0, `contact` was
-- the WHOLE `<span class="fn">` including the export's own heading, so the
-- built heading landed on top of the raw one.
--
-- 20260818213148 fixed only Missed/Placed/Received, and said so: for those
-- three the built prefix ("Missed call from") is textually IDENTICAL to the raw
-- markup heading, so one backreference detects and collapses the repeat. The
-- other two are not self-duplicates -- Google Voice writes "Voicemail from" and
-- "Recorded call with" while the template builds "Voicemail call from" and
-- "Recorded call from" -- so the backreference pattern never matched them and
-- they were left for "separate follow-up". This is that follow-up.
--
-- ## Verified against a real appliance database before writing this migration
--
--   SELECT count(*) FROM ci.communications
--    WHERE communication_type = 'call' AND source_system = 'google_voice'
--      AND content ~* '^(Voicemail|Recorded)';
--   -- 3079, and EVERY one of them matches one of the two patterns below
--   -- (2891 Voicemail + 188 Recorded = 3079); there are no other shapes:
--   --   "Voicemail call from Voicemail from"                     914
--   --   "Voicemail call from Voicemail from\nWilliam E Broza"     694
--   --   "Recorded call from Recorded call with"                   134
--   --   ... 2,031 of the 3,079 also carry the same duplication in .preview.
--
--   -- .preview, where set, is always exactly the whitespace-collapsed copy of
--   -- .content for these rows -- never independently corrupted, never
--   -- truncated (longest content is 69 chars, well under clip()'s 140):
--   SELECT count(*) FROM ci.communications
--    WHERE communication_type = 'call' AND source_system = 'google_voice'
--      AND content ~* '^(Voicemail call from|Recorded call from)'
--      AND preview IS NOT NULL
--      AND preview <> regexp_replace(btrim(content), '[[:space:]]+', ' ', 'g');
--   -- 0
--
--   -- The three-verb rows 20260818213148 already fixed end as a bare heading
--   -- when the export named nobody ("Placed call to" 4420, "Missed call from"
--   -- 2107, "Received call from" 1961). This migration produces the same shape
--   -- for the nameless Voicemail/Recorded rows rather than fabricating the
--   -- template's "unknown" fallback -- consistency with the rows already
--   -- repaired matters more than matching a fallback that only fires when the
--   -- parser had no filename label either.
--
-- ## The fix
--
-- `content` keeps ONE heading -- the built one, which is what a freshly
-- imported record of this shape reads today -- followed by a single space and
-- whatever name text followed the raw heading, if any. Nothing is invented for
-- the nameless rows.
--
-- `.preview` goes back to NULL for the same reason 20260818213148 gave: once
-- de-duplicated, `content` no longer contains the internal newline that made
-- `clip()`'s collapsed copy differ from it, and `toCommunicationInput()` only
-- writes `.preview` when it differs -- so NULL is what a never-corrupted row of
-- this shape has. `NULLIF` reproduces exactly that rule rather than asserting
-- it.
--
-- The two verbs are handled by NESTED replaces rather than one alternation, so
-- a cross-paired heading ("Voicemail call from Recorded call with", of which
-- there are none) can never be silently collapsed as if it were a duplicate.
-- The nesting is safe: after the Voicemail replace the row reads "Voicemail
-- call from ...", which cannot match the Recorded pattern.
--
-- Idempotent: the WHERE clause is the same pair of patterns used to find the
-- corruption, and each requires the heading to appear TWICE, so once collapsed
-- a second run matches -- and updates -- zero rows. A correct row, with the
-- heading exactly once, is never in the candidate set.
UPDATE ci.communications AS c
   SET content = fixed.new_content,
       preview = NULLIF(regexp_replace(btrim(fixed.new_content), '[[:space:]]+', ' ', 'g'), fixed.new_content)
  FROM (
    SELECT id,
           rtrim(
             regexp_replace(
               regexp_replace(
                 content,
                 '^(Voicemail call from)[[:space:]]+Voicemail from([[:space:]]+([^[:space:]].*))?$',
                 E'\\1 \\3'
               ),
               '^(Recorded call from)[[:space:]]+Recorded call with([[:space:]]+([^[:space:]].*))?$',
               E'\\1 \\3'
             )
           ) AS new_content
      FROM ci.communications
     WHERE communication_type = 'call'
       AND source_system = 'google_voice'
       AND (content ~ '^Voicemail call from[[:space:]]+Voicemail from([[:space:]]+[^[:space:]].*)?$'
            OR content ~ '^Recorded call from[[:space:]]+Recorded call with([[:space:]]+[^[:space:]].*)?$')
  ) AS fixed
 WHERE c.id = fixed.id;

-- ## Post-migration verification
--
-- Should now be 0:
--   SELECT count(*) FROM ci.communications
--    WHERE communication_type = 'call' AND source_system = 'google_voice'
--      AND (content ~ '^Voicemail call from[[:space:]]+Voicemail from'
--           OR content ~ '^Recorded call from[[:space:]]+Recorded call with');
--
-- Spot check a formerly-duplicated row:
--   SELECT content, preview FROM ci.communications
--    WHERE communication_type = 'call' AND source_system = 'google_voice'
--      AND content = 'Voicemail call from William E Broza';
--
-- Row count is UNCHANGED; only content/preview move.

-- migrate:down
-- No-op: irreversible data backfill, same reasoning as
-- 20260818213148_backfill_google_voice_call_heading_duplication -- the
-- duplicated heading this removes was never meaningful content, and nothing
-- records which rows were touched versus already clean, so there is no source
-- of truth to roll back to.
