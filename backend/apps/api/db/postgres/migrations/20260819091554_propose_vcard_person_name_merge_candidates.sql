-- migrate:up
-- Propose (never merge) the 2,070 Person-entity pairs -- covering 1,773 distinct
-- contact cards -- where a card re-typed by the companion migration
-- 20260819091547_retype_vcard_contact_concepts_as_person.sql shares an EXACT
-- name with a Person another source already contributed.
--
-- ## Why this exists
--
-- Until this branch, a contact card with no phone number and no email address was
-- filed as a `Concept` rather than a `Person` (the full root cause is in the
-- companion migration's header: the parser typed the item but not the entity, so
-- `resolveEntityType`'s handle-based default was the only thing left to classify
-- it, and it had no handle to find). The companion migration re-types those
-- 2,249 rows -- 2,247 from vCard, 2 from a CSV contact list -- and re-keys them
-- onto the coordinate the fixed parser mints.
--
-- Re-typing is only half the story. 1,780 of those cards describe someone this
-- appliance ALREADY has a Person row for -- the same human, contributed twice
-- under two types, so neither the graph nor duplicate detection ever saw them as
-- one. By source of the twin (capped counts, see the cap note below):
--
--   import:linkedin       1714 pairs
--   import:vcard           195 pairs   (the card WITH a handle, same person)
--   import:google_voice    153 pairs
--   import:contact_list      8 pairs
--                         ----
--                         2070
--
-- ## Why a merge-candidate proposal, not a rename, an auto-merge or a delete
--
-- The same reason 20260818220833_propose_phone_matched_person_merge_candidates
-- gives, and this migration follows that one to the letter. `ci.merge_candidates`
-- is the purpose-built, human-reviewed path for exactly this evidence, written
-- today by pipeline/stages/clean/DuplicateDetectStage.ts under the explicit rule
-- "CLEAN proposes; a human disposes": a merge is irreversible in practice
-- (PersonMergeService repoints entity_identifiers,
-- communications.from_entity_id/to_entity_ids,
-- events.organizer_entity_id/participant_entity_ids and every relationship, then
-- deletes embeddings), so nothing in this codebase merges automatically, ever.
--
-- Name evidence in particular must not be actioned by a machine:
-- IDENTIFIER_KIND_SCORES.name is 0.5 and its comment says why -- "display names
-- are not unique and this is the number that keeps them below any plausible
-- auto-merge floor. Two people called 'John Smith' are a QUESTION, not an
-- answer." 0.5 is also exactly MIN_CANDIDATE_SCORE, whose comment reads "Equal to
-- the weakest single piece of evidence, so a lone name match still surfaces", so
-- a name-only pair is a legitimate PROPOSAL by this codebase's own rule and
-- nothing more. This migration writes the same evidence shape (kind, value,
-- score) with the same weight and touches no Person row, no name, no
-- communication and no identifier.
--
-- ## Why DuplicateDetectStage cannot find these pairs on its own
--
-- That stage groups `ci.identifier_claims` by entity_id -- the identifier's
-- ADJUDICATED resolution, i.e. whichever entity currently owns the
-- (kind, value_normalized) row in `ci.entity_identifiers`. That index is
-- `entity_identifiers_owner_kind_value_uniq` UNIQUE (owner_user_id, kind,
-- value_normalized), so a given name resolves to exactly ONE entity_id per
-- owner, and the self-join that looks for "the same claim, a DIFFERENT entity_id"
-- structurally cannot fire for a pair where one side never won -- or never
-- entered -- that index.
--
-- Verified on the live QA appliance rather than assumed, using the pair that
-- motivated this work:
--
--   SELECT e.entity_id, e.entity_type, e.linked_table, ei.kind, ei.value_normalized
--     FROM ci.entities e
--     LEFT JOIN ci.entity_identifiers ei ON ei.entity_id = e.entity_id
--    WHERE lower(btrim(e.name)) = 'morgan spadone';
--   -- Person  | import:linkedin | name | morgan spadone
--   -- Concept | import:vcard    |      |                 <- no identifier row AT ALL
--   -- Content | content         |      |                 <- an unrelated defect
--
-- Only a query that reaches around `ci.entity_identifiers` into the entities'
-- own names (as this migration does, once) can see the pair. Note the fixed
-- parser does not heal this either: the re-typed row still loses the
-- first-writer-wins race for the `name` identifier to the LinkedIn row, which is
-- precisely why the proposal is the deliverable and not a follow-up import.
--
-- ## Verified against the live QA appliance before writing this migration
--
--   Cards sharing a name with an existing Person, and the pairs they generate.
--   Measured in the state this statement actually runs in -- i.e. AFTER the
--   companion migration, so the re-typed rows are themselves part of every name
--   group they belong to, which is what the cap counts:
--     uncapped          2112 pairs / 1780 cards
--     capped at 6       2070 pairs / 1773 cards   <- what this migration writes
--     excluded by cap     42 pairs /    7 cards
--
--   MAX_GROUP_MEMBERS = 6 is DuplicateDetectStage's own "stop treating this as
--   evidence" cap, applied here for consistency with the stage. Its stated
--   rationale is a SHARED value (`info@`, a family landline) rather than an
--   over-duplicated one, and the five names it excludes here are the second
--   case, not the first:
--
--     benjamin drolet 9, john canning 7, liam broza 7, steven berry 7,
--     steven stone 7, terrence wilburn 7
--
--   Six names, seven cards -- "liam broza" is the appliance owner and holds two
--   of them (a vCard card and a contact-list row), which is also why including
--   the contact-list source pushed that group from 6 to 7 and cost it the 8 pairs
--   it would otherwise have contributed.
--
--   These are real people this appliance holds seven-to-nine Person rows for,
--   across LinkedIn, vCard, Google Voice and a contact list -- so the cap costs
--   42 proposals that a reviewer might well have accepted. Applied anyway,
--   deliberately: the alternative is a per-migration exception to a corpus-wide
--   evidence rule, and the review queue's second-order argument (proposing every
--   pair a large group generates buries the real duplicates) is the practical
--   way a proposal system dies. Those five people remain findable by
--   `person-duplicate-names` in `ci-import doctor`, which counts rows in
--   duplicate name groups with no cap.
--
--   Name quality: 0 of the 2,249 re-typed rows carry a name that
--   `isNonNameParticipant` (graph/utils/participantSanity.ts) would refuse --
--   0 embedded newlines, 0 call-log headings, 0 export filenames. Exactly one is
--   phone-shaped, which that predicate deliberately ALLOWS ("a bare phone
--   number ... still pass"). The exclusions below are therefore no-ops on this
--   corpus and are carried for the same reason the phone migration carried them:
--   a name that is structurally not a name is not reviewable evidence, and this
--   statement may run on an appliance whose data is not this one.
--
--   NOTE on `\y` vs `\b`: Postgres regexes are POSIX AREs. `\y` is the
--   word-boundary escape; `\b` matches a literal BACKSPACE and would make the
--   call-log exclusion silently match nothing -- a mistake an earlier draft of
--   the phone migration actually shipped and had to correct.
--
-- Idempotent: ON CONFLICT on merge_candidates' own
-- (owner_user_id, entity_type, entity_id_a, entity_id_b) unique index does
-- nothing, so a second run -- or DuplicateDetectStage later re-discovering the
-- same pair by some future, smarter query -- never duplicates a row or clobbers
-- one a human has already reviewed.
WITH retyped AS (
  -- The rows the companion migration moved, identified by the coordinate it
  -- moved them TO. Handle-absence is what made them mis-typed in the first
  -- place, and it is an exact discriminator: 0 of the 2,249 mis-typed rows
  -- carried properties->'email' or ->'phone', and 0 of the 1,335 correctly-typed
  -- cards lacked one. It also keeps the 3 cards whose display name IS their own
  -- email address out of this set -- they legitimately sit at
  -- uuidv5(ns, 'contact:' || lower(name)) and were never mis-typed.
  --
  -- The source list is kept in lockstep with the companion migration's, whose
  -- header explains why both provenance halves are matched as a pair.
  SELECT e.entity_id, e.owner_user_id, lower(btrim(e.name)) AS name_key
    FROM ci.entities e
   WHERE e.entity_type = 'Person'
     AND (e.linked_table, e.properties->>'Source') IN (
       ('import:vcard', 'vCard'),
       ('import:contact_list', 'ContactList'),
       ('import:apple_contacts', 'AppleContacts')
     )
     AND NOT (e.properties ? 'email' OR e.properties ? 'phone')
     AND e.owner_user_id IS NOT NULL
     AND COALESCE(e.is_active, true) = true
     AND e.merged_into_entity_id IS NULL
     AND e.name IS NOT NULL
     AND btrim(e.name) <> ''
     AND e.linked_id = ci.uuid_generate_v5(
       '6f4b3f9e-1c2a-5d8e-9a7b-0c1d2e3f4a5b'::uuid, -- IMPORT_NAMESPACE, GraphIngestService.ts
       'contact:' || lower(btrim(e.name))
     )
     -- Not reviewable evidence: see the name-quality note above. Mirrors
     -- nonNameParticipantReason's three shapes, in POSIX ARE form.
     AND e.name !~ '[\r\n]'
     AND e.name !~* '^[[:space:]]*(missed|placed|received|recorded|voicemail)([[:space:]]+call)?[[:space:]]+(from|to|with)\y'
     AND e.name !~* '\.(html?|json|csv|vcf|txt)$'
     AND e.name !~* '^group conversation\y'
),
twin AS (
  -- Any other live Person of this owner's, from any source. Deliberately not
  -- restricted to `import:%`: a Person the user created by hand, or one the
  -- enrichment pass minted, is just as much the same human.
  SELECT e.entity_id, e.owner_user_id, lower(btrim(e.name)) AS name_key
    FROM ci.entities e
   WHERE e.entity_type = 'Person'
     AND e.owner_user_id IS NOT NULL
     AND COALESCE(e.is_active, true) = true
     AND e.merged_into_entity_id IS NULL
     AND e.name IS NOT NULL
     AND btrim(e.name) <> ''
     AND e.name !~ '[\r\n]'
     AND e.name !~* '^[[:space:]]*(missed|placed|received|recorded|voicemail)([[:space:]]+call)?[[:space:]]+(from|to|with)\y'
     AND e.name !~* '\.(html?|json|csv|vcf|txt)$'
     AND e.name !~* '^group conversation\y'
),
matched AS (
  -- Scoped per owner_user_id: two accounts on one appliance each knowing a
  -- "John Smith" is not a duplicate, and pairing across owners would be a data
  -- leak rather than a cleanup.
  SELECT DISTINCT r.entity_id AS r_id, t.entity_id AS t_id, r.owner_user_id, r.name_key
    FROM retyped r
    JOIN twin t
      ON t.owner_user_id = r.owner_user_id
     AND t.name_key = r.name_key
     AND t.entity_id <> r.entity_id
),
-- MAX_GROUP_MEMBERS (= 6, clean/DuplicateDetectStage.ts). The re-typed row
-- itself counts toward the group, because the stage counts DISTINCT subjects
-- holding the (kind, value) claim corpus-wide and post-re-type this row is one
-- of them. A plain GROUP BY, not `count(DISTINCT ...) OVER (...)`: Postgres does
-- not support DISTINCT inside a window function.
group_sizes AS (
  SELECT owner_user_id, name_key, count(DISTINCT t_id) + 1 AS group_size
    FROM matched
   GROUP BY 1, 2
),
pairs AS (
  SELECT m.owner_user_id,
         LEAST(m.r_id, m.t_id)    AS entity_id_a, -- CHECK (entity_id_a < entity_id_b)
         GREATEST(m.r_id, m.t_id) AS entity_id_b,
         m.name_key
    FROM matched m
    JOIN group_sizes g
      ON g.owner_user_id = m.owner_user_id
     AND g.name_key = m.name_key
   WHERE g.group_size <= 6
)
INSERT INTO ci.merge_candidates (
  owner_user_id, entity_type, entity_id_a, entity_id_b,
  score, evidence, detected_by, detector_version
)
SELECT owner_user_id,
       'Person',
       entity_id_a,
       entity_id_b,
       0.5, -- IDENTIFIER_KIND_SCORES.name, clean/DuplicateDetectStage.ts
       jsonb_build_array(jsonb_build_object('kind', 'name', 'value', name_key, 'score', 0.5)),
       'migration:20260819091554_propose_vcard_person_name_merge_candidates',
       0 -- not a DuplicateDetectStage generation number; see the note above on
         -- why that stage cannot reach these pairs on its own
  FROM pairs
ON CONFLICT (owner_user_id, entity_type, entity_id_a, entity_id_b) DO NOTHING;

-- ## Post-migration verification
--
--   SELECT count(*) FROM ci.merge_candidates
--    WHERE detected_by = 'migration:20260819091554_propose_vcard_person_name_merge_candidates';
--   -- <= 2070 (ON CONFLICT DO NOTHING may skip a pair DuplicateDetectStage or a
--   -- prior run already proposed under the same ordered entity_id_a/entity_id_b)
--
--   -- Every proposed pair should be two live Persons with the same name, one of
--   -- them a vCard card:
--   SELECT a.name, a.properties->>'Source', b.name, b.properties->>'Source'
--     FROM ci.merge_candidates mc
--     JOIN ci.entities a ON a.entity_id = mc.entity_id_a
--     JOIN ci.entities b ON b.entity_id = mc.entity_id_b
--    WHERE mc.detected_by = 'migration:20260819091554_propose_vcard_person_name_merge_candidates'
--    LIMIT 20;

-- migrate:down
-- Only this migration's own proposals, and only the ones still untouched: a
-- human's accept/reject is a decision, not a side effect of a schema change, and
-- `merge_candidates_status_check` keeps 'accepted'/'rejected' distinguishable
-- from 'pending' precisely so a rollback can leave them alone. An accepted
-- pair's merge is PersonMergeService's to undo, not this file's.
DELETE FROM ci.merge_candidates
 WHERE detected_by = 'migration:20260819091554_propose_vcard_person_name_merge_candidates'
   AND status = 'pending';
