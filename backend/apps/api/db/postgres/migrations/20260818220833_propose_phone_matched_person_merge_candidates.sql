-- migrate:up
-- Propose (never merge) 434 Person-entity pairs — covering 353 distinct
-- bare-phone-number Person rows, a few of which have more than one plausible
-- match for the same number — where a bare-phone-number name (e.g.
-- "+18446142073") and a REAL name elsewhere in the same user's data share the
-- same phone number, evidenced by an EXACT last-ten-digit match on
-- ci.entities.properties->'phones', scoped per owner_user_id.
--
-- ## Why this exists: 34% of Person rows are bare phone numbers
--
-- A live-DB audit found 4,022 of 11,844 Person rows (34%) named only a raw
-- phone number, never resolved to a contact name. Investigating whether a
-- real name was available somewhere and simply never cross-referenced
-- (rather than the phone number genuinely being all the source data ever
-- said) found BOTH answers, split cleanly by import source:
--
--   import:communications:participant (1,660 rows): 1 matchable. The
--     overwhelming majority are genuinely unavoidable -- the participant
--     string on every message naming that number was ALWAYS just the bare
--     number, in every communication that mentions it, for that owner. There
--     is nothing to cross-reference against; this is scenario (a), expected
--     and undocumented-elsewhere-because-there-is-nothing-else-to-find.
--
--   import:google_voice (563 rows): 22 matchable. Mostly the same honest gap
--     -- extractSender() in googlevoice.ts already records "no name" rather
--     than fabricate one (see 3e5956cb0) when the export's own markup names
--     no one.
--
--   import:imessage (1,799 rows): 330 matchable (18.3%). This is scenario
--     (b), and it has a concrete, fixed-forward root cause: imessage.ts's
--     participant edge carried a bare `{ type: 'contact', name: row.
--     contact_id }` with NO `attributes` array, so entityIdentityKey()
--     (import/staging/identity.ts) found no identity handle on it,
--     naturalKeyFor fell back to keying the entity by NAME, and
--     toGraphEntity never populated `properties.phones` -- so
--     GraphIngestService.indexIdentifiers never wrote a ci.entity_identifiers
--     row for ANY of these 1,799 entities (verified: 0 of 1,799 have one,
--     versus 100% coverage for the google_voice and communications:
--     participant stub paths, which both set `identity: true` correctly).
--     That is a strictly worse failure than the ordinary "first writer wins"
--     race on ci.entity_identifiers' (owner_user_id, kind, value_normalized)
--     unique index: these entities were never even IN the race. Fixed
--     forward in the same change as this migration (imessage.ts now emits
--     the same `attributes: [{ name, value, identity: true }]` shape
--     googlevoice.ts already used). That fix only prevents the gap from
--     growing on future imports -- it cannot retroactively link the 1,799
--     rows already written, which is what this migration addresses.
--
-- ## Why a merge-candidate proposal, not a rename or an auto-merge
--
-- This codebase already has a purpose-built, human-reviewed path for exactly
-- this evidence: ci.merge_candidates, written today by
-- backend/apps/api/src/domains/pipeline/stages/clean/DuplicateDetectStage.ts
-- under the explicit rule "CLEAN proposes; a human disposes" -- a merge is
-- documented there as irreversible in practice (PersonMergeService repoints
-- entity_identifiers, communications.from_entity_id/to_entity_ids,
-- events.organizer_entity_id/participant_entity_ids and every relationship,
-- then deletes embeddings), so nothing in this codebase merges automatically,
-- ever. This migration follows that precedent to the letter: it INSERTS
-- proposals with the SAME evidence shape (kind, value, score) and the SAME
-- IDENTIFIER_KIND_SCORES.phone weight (0.85) DuplicateDetectStage uses, and
-- touches no Person row, no name, no communication, no identifier.
--
-- ## Why DuplicateDetectStage cannot find these pairs on its own
--
-- That stage groups ci.identifier_claims by entity_id -- the identifier's
-- ADJUDICATED resolution, i.e. whichever entity currently owns the (kind,
-- value_normalized) row in ci.entity_identifiers. Because that index is
-- UNIQUE per owner, a given phone number resolves to exactly one entity_id
-- corpus-wide, so the self-join that finds "the same claim, a DIFFERENT
-- entity_id" structurally cannot fire for a pair where one side never won
-- (or never entered) that index -- which describes every pair here. Only a
-- query that reaches around ci.entity_identifiers into each entity's own
-- properties->'phones' (as PersonDuplicateService historically did, and as
-- this migration does once) can see them.
--
-- ## Verified against the live appliance database before writing this migration
--
-- Bare-phone Person count, by source (name ~ '^\+?[0-9()-.\s]{7,}$'):
--   import:imessage                     1799
--   import:communications:participant   1660
--   import:google_voice                  563
--   (total 4022, matching the audit that motivated this task)
--
-- Matchable against a real name elsewhere (exact last-10-digit match on
-- properties->'phones', same owner_user_id, candidate name genuinely NOT
-- phone-shaped and NOT an empty/truncated call-log heading like "Missed call
-- from          +" or "recorded call with"), by DISTINCT bare-phone entity /
-- by PAIR (a handful of numbers matched more than one plausible candidate
-- name, each proposed as its own reviewable pair):
--                                       entities   pairs
--   import:imessage                        330      411
--   import:google_voice                     22       22
--   import:communications:participant        1        1
--   (total                                  353      434)
--
-- Fan-out sanity (guards against a shared/family/support number inflating
-- into a false "duplicate"): the largest number of DISTINCT real-named
-- candidates any single phone value matches is 2 -- nowhere near
-- MAX_GROUP_MEMBERS (6), DuplicateDetectStage's own "stop treating this as
-- evidence" cap, which the query below applies anyway for safety on data
-- that may have changed since this was written.
--
-- Spot-checked sample (bare name -> real name, real source):
--   +19549091500 (imessage) -> Phoenix Jeffery Ferguson (vcard)
--   +19495842313 (imessage) -> William E Broza          (vcard)
--   +13107741450 (imessage) -> Sean Broza                (vcard)
--   +14153421427 (imessage) -> Shaw Walters              (google_voice)
--   +13108088199 (communications:participant) -> Paul    (vcard)
--
-- NOTE on `\y` vs `\b`: an earlier draft of the call-log-heading exclusion
-- below used PCRE/JS-style `\b` for a word boundary. Postgres regex (POSIX
-- ARE) has NO such meaning for `\b` -- it matches a literal BACKSPACE
-- character, so that draft silently matched nothing and the exclusion was a
-- near no-op (verified: it let ~2,042 additional rows through as
-- "candidates" that should have been excluded). `\y` is the correct Postgres
-- word-boundary escape and is what the query below actually uses; the counts
-- in this comment block are from the corrected query.
--
-- Idempotent: ON CONFLICT on merge_candidates' own
-- (owner_user_id, entity_type, entity_id_a, entity_id_b) unique index does
-- nothing, so a second run (or DuplicateDetectStage later re-discovering the
-- same pair by some future, smarter query) never duplicates or clobbers a
-- row a human has already reviewed.
WITH bare_phone AS (
  SELECT entity_id, owner_user_id,
         right(regexp_replace(name, '\D', '', 'g'), 10) AS last10
    FROM ci.entities
   WHERE entity_type = 'Person'
     AND COALESCE(is_active, true) = true
     AND merged_into_entity_id IS NULL
     AND name ~ '^\+?[0-9()\-.\s]{7,}$'
),
candidate_phones AS (
  SELECT entity_id, owner_user_id, name,
         right(regexp_replace(jsonb_array_elements_text(properties -> 'phones'), '\D', '', 'g'), 10) AS last10
    FROM ci.entities
   WHERE entity_type = 'Person'
     AND COALESCE(is_active, true) = true
     AND merged_into_entity_id IS NULL
     AND properties ? 'phones'
     AND name IS NOT NULL
     AND btrim(name) <> ''
     -- The candidate's OWN name must be a real, reviewable name: not itself
     -- phone-shaped, and not a bare/truncated call-log heading ("Missed call
     -- from", "Placed call to          +") that carries no name either.
     AND name !~ '^\+?[0-9()\-.\s]{7,}$'
     -- `\y` is Postgres's word-boundary escape (its regex flavour is POSIX
     -- ARE, not PCRE/JS — `\b` there means a literal BACKSPACE character, so
     -- using the JS form here would silently match nothing).
     AND name !~* '^\s*(missed|placed|received|recorded|voicemail)\y[^\n]*?\y(call\s+)?(from|to|with)\y\s*\+?\s*$'
),
matched AS (
  SELECT DISTINCT bp.entity_id AS bp_id, cp.entity_id AS cp_id, bp.owner_user_id, bp.last10
    FROM bare_phone bp
    JOIN candidate_phones cp
      ON cp.owner_user_id = bp.owner_user_id
     AND cp.last10 = bp.last10
     AND cp.entity_id <> bp.entity_id
   WHERE length(bp.last10) = 10
),
-- The group-size cap DuplicateDetectStage itself applies (MAX_GROUP_MEMBERS
-- = 6, clean/DuplicateDetectStage.ts): above it a shared value is not
-- evidence of one identity, it's a landline everyone in a household used.
-- (A plain GROUP BY, not `count(DISTINCT ...) OVER (...)` — Postgres does not
-- support DISTINCT inside a window function.)
group_sizes AS (
  SELECT owner_user_id, last10, count(DISTINCT cp_id) AS group_size
    FROM matched
   GROUP BY owner_user_id, last10
),
pairs AS (
  SELECT m.owner_user_id,
         LEAST(m.bp_id, m.cp_id)    AS entity_id_a,
         GREATEST(m.bp_id, m.cp_id) AS entity_id_b,
         m.last10
    FROM matched m
    JOIN group_sizes gs ON gs.owner_user_id = m.owner_user_id AND gs.last10 = m.last10
   WHERE gs.group_size <= 6
)
INSERT INTO ci.merge_candidates (
  owner_user_id, entity_type, entity_id_a, entity_id_b,
  score, evidence, detected_by, detector_version
)
SELECT owner_user_id,
       'Person',
       entity_id_a,
       entity_id_b,
       0.85, -- IDENTIFIER_KIND_SCORES.phone, clean/DuplicateDetectStage.ts
       jsonb_build_array(jsonb_build_object('kind', 'phone', 'value', last10, 'score', 0.85)),
       'migration:20260818220833_propose_phone_matched_person_merge_candidates',
       0 -- not a DuplicateDetectStage generation number; see the note above
         -- on why that stage can't reach these pairs on its own
  FROM pairs
ON CONFLICT (owner_user_id, entity_type, entity_id_a, entity_id_b) DO NOTHING;

-- ## Post-migration verification
--
--   SELECT count(*) FROM ci.merge_candidates
--    WHERE detected_by = 'migration:20260818220833_propose_phone_matched_person_merge_candidates';
--   -- should be <= 434 (ON CONFLICT DO NOTHING may skip a pair
--   -- DuplicateDetectStage or a prior run of this migration already
--   -- proposed under the same ordered entity_id_a/entity_id_b)
--
--   -- Every proposed pair should still show one bare-phone name and one
--   -- real name today:
--   SELECT a.name, b.name FROM ci.merge_candidates mc
--     JOIN ci.entities a ON a.entity_id = mc.entity_id_a
--     JOIN ci.entities b ON b.entity_id = mc.entity_id_b
--    WHERE mc.detected_by = 'migration:20260818220833_propose_phone_matched_person_merge_candidates'
--    LIMIT 20;

-- migrate:down
DELETE FROM ci.merge_candidates
 WHERE detected_by = 'migration:20260818220833_propose_phone_matched_person_merge_candidates';
