-- migrate:up
-- Repair the STRING that mints garbage people:
-- `ci.communications.participants_metadata`.
--
-- ## Why this migration exists at all
--
-- Migration 20260818220731 deleted 241 `ci.entities` Person rows named after a
-- Google Voice group-thread export file ("Group Conversation -
-- 2024-09-25T01_45_41Z.html"). All 241 are back. Its own closing comment
-- explains why it thought that was safe: it emptied
-- `ci.communications.to_entity_ids` so "a future relinking sweep naturally
-- revisits them". The relinking sweep is exactly the thing that mints these
-- rows. `PersonStubBackfillService` selects communications whose
-- `to_entity_ids` is NULL or empty, reads `participants_metadata.{from,to,cc,
-- bcc}`, and creates a stub Person for every unrecognised participant string —
-- so the migration handed 446 rows back to the minter with the same filename
-- still sitting in `participants_metadata.to`, and got the same 241 people.
--
-- Deleting the output of a generator that is still running is theatre. The
-- generator here has two halves: the code (fixed in this branch — a shared
-- `participantSanity` guard now refuses these strings in `classifyParticipant`,
-- `PersonLinkStage.classifyIdentifier`, `EntityIdentifierService` and the
-- import push path) and the DATA it reads, which is this migration.
--
-- ## What is wrong in the data, exactly
--
-- 1. `participants_metadata->>'from'` on Google Voice CALL records carries the
--    call-log heading instead of (or in front of) the contact:
--    "Placed call to", "Missed call from", "Voicemail from",
--    "Placed call to\nWilliam E Broza". The pre-3e5956cb0 `extractSender()`
--    took the whole `<span class="fn">` verbatim, and some exports put the
--    heading and the name in ONE span separated by a newline.
--
-- 2. `participants_metadata->'to'` on 446 Google Voice CHAT records carries the
--    export FILENAME "Group Conversation - <timestamp>.html" as the recipient,
--    because the old label parse returned the untouched basename.
--
-- ## Verified against a real appliance database before writing this migration
--
--   -- (1) heading in `from`: 38,398 rows, all of them Google Voice calls, and
--   -- NO other source or field is affected.
--   SELECT source_system, communication_type, count(*) FROM ci.communications
--    WHERE participants_metadata->>'from' ~*
--          '^[[:space:]]*(missed|placed|received|recorded|voicemail)([[:space:]]+call)?[[:space:]]+(from|to|with)\y'
--    GROUP BY 1,2;
--   -- google_voice | call | 38398   (single row)
--
--   -- Stripping the heading leaves a real contact on 28,827 of them and
--   -- nothing at all on 9,571 -- and leaves NO residue behind (0 rows keep a
--   -- newline, 0 end up looking like a filename):
--   -- residual_newline 0 | residual_filename 0 | empties 9571 | total 38398
--
--   -- (2) the filename in `to`: 446 rows, one bad element each, out of 859,447
--   -- `to` elements in the whole table. Every one of the 446 loses its ONLY
--   -- element, so the key is dropped rather than left as an empty array.
--
--   -- Zero `to`/`cc`/`bcc` elements anywhere carry a call-log heading, so the
--   -- element rewrite below is a no-op for them today; it is written the same
--   -- way as `from` regardless, because "the shape that was corrupted once"
--   -- is a poor scope for a repair.
--
-- ## The heading pattern, and why it demands whitespace
--
-- `googlevoice.ts` derives CallType from a FIVE-way alternation
-- (Missed|Placed|Received|Voicemail|Recorded); the observed headings are
-- "Missed call from", "Placed call to", "Received call from", "Voicemail from"
-- and "Recorded call with", hence the optional " call" and the three
-- prepositions. It requires WHITESPACE between the parts rather than the looser
-- "verb ... preposition somewhere on the line": an email address contains no
-- whitespace, so this form cannot match one, while the loose form reads
-- "voicemail@from.example.com" as a heading. This is byte-for-byte the rule
-- `CALL_LOG_HEADING` in
-- backend/apps/api/src/domains/graph/utils/participantSanity.ts applies at
-- runtime, so the repaired data and the guard agree.
--
-- Idempotent: both statements select only rows that still MATCH the corruption
-- pattern, and the pattern is anchored at the start of a value the statement
-- removes, so a second run finds zero rows. Nothing already-correct is touched
-- -- a `from` with no heading is never in the candidate set at all.

-- (1) `from`: keep the contact the heading was wrapped around; drop the key
-- entirely when the export named nobody. An empty string would still be a
-- participant as far as `readString()` is concerned, and "" is not a person.
UPDATE ci.communications AS c
   SET participants_metadata = CASE
         WHEN fixed.clean = '' THEN c.participants_metadata - 'from'
         ELSE jsonb_set(c.participants_metadata, '{from}', to_jsonb(fixed.clean))
       END
  FROM (
    SELECT id,
           btrim(
             regexp_replace(
               regexp_replace(
                 participants_metadata ->> 'from',
                 '^[[:space:]]*(missed|placed|received|recorded|voicemail)([[:space:]]+call)?[[:space:]]+(from|to|with)\y[[:space:]]*',
                 '',
                 'i'
               ),
               '[[:space:]]+', ' ', 'g'
             )
           ) AS clean
      FROM ci.communications
     WHERE participants_metadata ->> 'from' ~*
           '^[[:space:]]*(missed|placed|received|recorded|voicemail)([[:space:]]+call)?[[:space:]]+(from|to|with)\y'
  ) AS fixed
 WHERE c.id = fixed.id;

-- (2) `to`/`cc`/`bcc`: rebuild each array without the elements that are not
-- participants at all -- an export filename, or a heading that wrapped nobody
-- -- and with the heading stripped off the ones that are. The key is dropped
-- when nothing survives, which is the same "no recipient resolved" shape a
-- record that never named one has (`readStringArray` reads a missing key as
-- []), rather than an empty array that reads as "we looked and found none".
UPDATE ci.communications AS c
   SET participants_metadata = CASE
         WHEN fixed.clean_array IS NULL THEN c.participants_metadata - fixed.field
         ELSE jsonb_set(c.participants_metadata, ARRAY[fixed.field], fixed.clean_array)
       END
  FROM (
    SELECT s.id,
           s.field,
           (
             SELECT jsonb_agg(t.clean)
               FROM (
                 SELECT btrim(
                          regexp_replace(
                            regexp_replace(
                              e.value,
                              '^[[:space:]]*(missed|placed|received|recorded|voicemail)([[:space:]]+call)?[[:space:]]+(from|to|with)\y[[:space:]]*',
                              '',
                              'i'
                            ),
                            '[[:space:]]+', ' ', 'g'
                          )
                        ) AS clean
                   FROM jsonb_array_elements_text(s.arr) AS e(value)
               ) AS t
              WHERE t.clean <> ''
                AND t.clean !~* '(\.(html?|json|csv|vcf|txt)$)|(^group conversation\y)'
           ) AS clean_array
      FROM (
        SELECT c2.id, f.field, c2.participants_metadata -> f.field AS arr
          FROM ci.communications c2
          CROSS JOIN (VALUES ('to'), ('cc'), ('bcc')) AS f(field)
         WHERE jsonb_typeof(c2.participants_metadata -> f.field) = 'array'
           AND EXISTS (
             SELECT 1
               FROM jsonb_array_elements_text(c2.participants_metadata -> f.field) AS e(value)
              WHERE e.value ~* '(\.(html?|json|csv|vcf|txt)$)|(^[[:space:]]*group conversation\y)'
                 OR e.value ~* '^[[:space:]]*(missed|placed|received|recorded|voicemail)([[:space:]]+call)?[[:space:]]+(from|to|with)\y'
           )
      ) AS s
  ) AS fixed
 WHERE c.id = fixed.id;

-- ## Post-migration verification
--
-- Should now be 0 -- no participant string can mint a heading-named or
-- filename-named Person again:
--   SELECT count(*) FROM ci.communications
--    WHERE participants_metadata->>'from' ~*
--          '^[[:space:]]*(missed|placed|received|recorded|voicemail)([[:space:]]+call)?[[:space:]]+(from|to|with)\y';
--   SELECT count(*) FROM ci.communications c
--    WHERE EXISTS (SELECT 1 FROM jsonb_array_elements_text(
--                    CASE WHEN jsonb_typeof(c.participants_metadata->'to')='array'
--                         THEN c.participants_metadata->'to' ELSE '[]'::jsonb END) t(v)
--                   WHERE v ~* '^group conversation\y');
--
-- Row count of ci.communications, and `content`/`preview`/`from_entity_id`/
-- `to_entity_ids` on every row, are UNCHANGED by this migration -- it rewrites
-- only the raw participant strings.

-- migrate:down
-- No-op: irreversible data repair, same reasoning as
-- 20260818213148_backfill_google_voice_call_heading_duplication and
-- 20260818220731_cleanup_group_conversation_person_entities -- the heading this
-- removes was never part of anybody's name, the filename was never a
-- recipient, and nothing records which rows were touched versus already clean,
-- so there is no source of truth to roll back to.
