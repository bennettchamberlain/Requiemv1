-- migrate:up
-- Repair the 3,320 ci.entities Person rows whose NAME is a parser leak rather
-- than a person: a Google Voice call-log heading ("Missed call from",
-- "Placed call to\nNancy Davis") or a Messenger/Voice export filename
-- ("Group Conversation - 2024-09-25T01_45_41Z.html").
--
-- Runs AFTER 20260819001555, which repaired the participant STRINGS these were
-- minted from, and alongside the shared `participantSanity` guard that now
-- refuses such a string in `classifyParticipant`,
-- `PersonLinkStage.classifyIdentifier`, `EntityIdentifierService` and the
-- import push path. All three parts are required together: 20260818220731
-- deleted 241 of these rows with neither of the other two, and all 241 came
-- back. Deleting the output of a generator that is still running is theatre.
--
-- ## Three populations, and why they are treated differently
--
-- The split is NOT by `linked_table` but by whether the row carries a STRONG
-- identifier (ci.entity_identifiers.kind IN ('email','phone')). That is the
-- semantic difference, and on the live database it partitions the rows exactly.
--
--   RENAME  2,353 rows -- every one carries a phone identifier. These are REAL
--           contacts wearing a wrong label: between them they are the sender of
--           63,415 iMessage chats, 38,264 Google Voice calls and 20,829 Google
--           Voice chats. Deleting them would be catastrophic. The phone is
--           unique per (owner, kind, value), so no other Person can hold it --
--           this row IS that person, and only the display name is wrong.
--           New name = the contact after the heading, or, when the export named
--           nobody, the phone itself. That is EXACTLY what today's parser
--           writes (`googlevoice.ts` pushes `p.name || p.phone`), which is the
--           only defensible target for a repair: the state a fresh import of
--           the same export would produce.
--
--   MERGE     720 rows -- stubs carrying nothing but the garbage display name,
--           minted by `PersonStubBackfillService` /
--           `CommunicationParticipantLinkListener`. Under today's code and the
--           repaired participant strings a fresh sweep mints NO row for these:
--           it looks up ('name', normalized contact) in ci.entity_identifiers
--           -- a UNIQUE index, so the answer is unambiguous -- and links to
--           whoever owns it. So they are merged onto that owner and deleted.
--           When nothing external owns the name, the sibling stubs sharing it
--           collapse onto the lowest entity_id among themselves ("Received call
--           from\nDavid Florence" and "Voicemail from\nDavid Florence" are one
--           David Florence), leaving one row rather than a fresh set of
--           duplicates. 6 such canonical rows survive and are renamed.
--
--   DROP      241 rows -- stubs named after an export FILE. There is no tail to
--           recover and no identity to carry forward: Google Voice group
--           exports carry no group-name field, and this codebase has no
--           Group/Thread entity type to file one under. Removal is the honest
--           answer, exactly as 20260818220731 argued -- what that migration
--           lacked was the other two parts.
--
-- Deliberately NOT done: the 311 renamed rows whose recovered name matches an
-- existing Person are left as duplicates rather than merged. They hold a phone
-- identifier the match does not, and folding a phone number onto a contact on
-- the strength of a display-name string is an identity assertion, not a
-- corruption repair -- `normalizeName`'s own header says display names are
-- "weaker than an email/phone" and "not globally unique". A fresh import
-- produces exactly the same duplicate (its `properties.names` write is ON
-- CONFLICT DO NOTHING against a value another Person already claims), so this
-- IS the reproducible state; deduplicating people by name belongs to
-- ci.entity_merge_candidates, not to a backfill.
--
-- ## Verified against a real appliance database before writing this migration
--
--   -- Populations, with the predicate exactly as below:
--   --   total 3320 = merge 720 + drop 241 + rename(strong) 2353
--   --                                     + rename(canonical stub) 6
--   --
--   -- Reference audit for the 961 rows that get DELETED (merge + drop). Only
--   -- ci.communications carries real data; the rest is bookkeeping or zero.
--   -- Checked across EVERY *entity_id column in the ci/ci_search schemas:
--   --   communications.from_entity_id  20396  <- repointed to the merge target
--   --   communications.to_entity_ids     446  <- element removed (drop pop)
--   --   entity_identifiers               961  <- deleted (all kind='name',
--   --                                            every value garbage)
--   --   pipeline_state                  1922  <- deleted
--   --   ci_search.embeddings             961  <- deleted
--   --   ci_search.vectors                961  <- deleted
--   --   relationships                      0
--   --   events.organizer_entity_id         0
--   --   events.participant_entity_ids      0
--   --   identifier_claims                  0
--   --   entity_merges (source + target)    0
--   --   entities.merged_into_entity_id     0
--   --   users.entity_id                    0   (is_self is excluded anyway)
--   --   ci_search.entity_tag / index_skips 0
--   --   pipeline_dead_letters              0
--   --   ci.graph_deltas                  967  <- NOT touched, see below
--   --
--   -- ci.graph_deltas is an append-only change LOG (1,014,529 rows) with no
--   -- foreign key to ci.entities. Its rows record that these entities were
--   -- once created; rewriting history to hide a repair would be worse than a
--   -- log entry pointing at a row that no longer exists -- which is already
--   -- the state 20260818220731 left behind. Left alone deliberately.
--
--   -- Every recovered tail on this corpus is pure ASCII (0 of 1,037 carry a
--   -- non-ASCII byte). That is what lets the identifier value below be
--   -- computed in SQL as lower(collapse-whitespace): `normalizeName` in
--   -- TypeScript ALSO applies NFKD + diacritic folding, which SQL cannot do
--   -- without `unaccent`. The ASCII guard on the INSERT makes the two
--   -- byte-identical where it fires, and skips the row where they could
--   -- differ rather than writing a key nothing would ever join.
--
-- ## Idempotency
--
-- The working set is computed ONCE, from `ci.entities.name`, into a temp table
-- (dropped on commit, as 20260818174213 does). Recomputing it per statement
-- would make each statement's population depend on the deletes the previous
-- one performed. Once a row is renamed or deleted it no longer matches the
-- predicate, so a second run of this migration selects nothing and every
-- statement affects zero rows. Nothing already-correct is ever a candidate: a
-- Person whose name carries no heading, no export extension and no newline is
-- never selected.
--
-- The heading pattern is byte-for-byte `CALL_LOG_HEADING` from
-- backend/apps/api/src/domains/graph/utils/participantSanity.ts (whitespace
-- REQUIRED between the parts, so it cannot match an email address), and the
-- filename patterns are that module's EXPORT_FILENAME / GROUP_CONVERSATION.

CREATE TEMP TABLE _person_name_repair ON COMMIT DROP AS
WITH bad AS (
  SELECT e.entity_id,
         e.owner_user_id,
         e.properties,
         btrim(
           regexp_replace(
             regexp_replace(
               e.name,
               '^[[:space:]]*(missed|placed|received|recorded|voicemail)([[:space:]]+call)?[[:space:]]+(from|to|with)\y[[:space:]]*',
               '', 'i'
             ),
             '[[:space:]]+', ' ', 'g'
           )
         ) AS tail,
         EXISTS (
           SELECT 1 FROM ci.entity_identifiers s
            WHERE s.entity_id = e.entity_id AND s.kind IN ('email', 'phone')
         ) AS strong,
         -- The display name a fresh import would fall back to when the export
         -- named nobody: the handle. Email first only because an address is
         -- more legible than ten digits; on this corpus it is always a phone.
         (SELECT s.value_normalized
            FROM ci.entity_identifiers s
           WHERE s.entity_id = e.entity_id AND s.kind IN ('email', 'phone')
           ORDER BY (s.kind = 'email') DESC, s.value_normalized
           LIMIT 1) AS strong_value
    FROM ci.entities e
   WHERE e.entity_type = 'Person'
     AND e.linked_table LIKE 'import:%'
     AND COALESCE(e.is_self, false) = false
     AND (e.name ~* '^[[:space:]]*(missed|placed|received|recorded|voicemail)([[:space:]]+call)?[[:space:]]+(from|to|with)\y'
          OR e.name ~* '(\.(html?|json|csv|vcf|txt)$)|(^[[:space:]]*group conversation\y)'
          OR e.name ~ '[\n\r]')
), classified AS (
  SELECT b.*,
         lower(b.tail) AS tail_norm,
         -- Recoverable = a heading really did wrap a contact, and what it
         -- wrapped is not itself garbage. A filename has no heading to strip,
         -- so its tail is the whole filename and it fails here.
         (b.tail <> '' AND b.tail !~* '(\.(html?|json|csv|vcf|txt)$)|(^[[:space:]]*group conversation\y)') AS recoverable
    FROM bad b
)
SELECT c.entity_id,
       c.owner_user_id,
       c.properties,
       c.tail,
       c.tail_norm,
       c.strong,
       c.recoverable,
       CASE WHEN c.recoverable THEN c.tail ELSE c.strong_value END AS new_name,
       CASE
         WHEN c.strong OR NOT c.recoverable THEN NULL
         ELSE COALESCE(
           -- Whoever the linker would resolve this contact to today. The
           -- (owner, kind, value) index is UNIQUE, so there is at most one.
           (SELECT t.entity_id
              FROM ci.entity_identifiers t
              JOIN ci.entities te ON te.entity_id = t.entity_id
             WHERE t.owner_user_id = c.owner_user_id
               AND t.kind = 'name'
               AND t.value_normalized = c.tail_norm
               AND t.entity_id <> c.entity_id
               AND te.entity_type = 'Person'
               AND NOT EXISTS (SELECT 1 FROM classified x
                                WHERE x.entity_id = te.entity_id AND NOT x.strong)),
           -- Nobody owns the name: the stubs sharing it are each other's
           -- duplicates, so they collapse onto the lowest entity_id. The row
           -- that IS the lowest gets itself here and is therefore kept.
           (SELECT o.entity_id FROM classified o
             WHERE o.owner_user_id = c.owner_user_id
               AND o.tail_norm = c.tail_norm
               AND NOT o.strong
               AND o.recoverable
             ORDER BY o.entity_id
             LIMIT 1)
         )
       END AS target_id
  FROM classified c;

CREATE INDEX ON _person_name_repair (entity_id);

-- (1) MERGE -- a merged stub's communications become the target's.
UPDATE ci.communications c
   SET from_entity_id = r.target_id
  FROM _person_name_repair r
 WHERE c.from_entity_id = r.entity_id
   AND r.target_id IS NOT NULL
   AND r.target_id <> r.entity_id;

-- Same substitution inside `to_entity_ids`, de-duplicated in case the target
-- was already a recipient of the same row. Element-wise rebuild rather than
-- array_replace: a row holding TWO merged stubs must lose both, and a
-- per-match array_replace only ever rewrites the last one joined.
UPDATE ci.communications c
   SET to_entity_ids = (
         SELECT array_agg(DISTINCT COALESCE(r.target_id, id))
           FROM unnest(c.to_entity_ids) AS id
           LEFT JOIN _person_name_repair r
             ON r.entity_id = id AND r.target_id IS NOT NULL AND r.target_id <> r.entity_id
       )
 WHERE c.to_entity_ids && (
         SELECT array_agg(entity_id) FROM _person_name_repair
          WHERE target_id IS NOT NULL AND target_id <> entity_id
       );

-- (2) DROP -- the filename-named stubs are un-set as a sender and removed from
-- every recipient list. `array_agg` collapses to NULL when the last element
-- goes, which is the "no recipient resolved" shape `PersonLinkStage` and
-- `CommunicationParticipantLinkListener` already treat as unresolved. With
-- 20260819001555 having removed the filename from `participants_metadata`, a
-- revisiting sweep now finds nothing to mint instead of re-creating these --
-- the exact loop 20260818220731 left open.
UPDATE ci.communications c
   SET to_entity_ids = (
         SELECT array_agg(id) FROM unnest(c.to_entity_ids) AS id
          WHERE id NOT IN (SELECT entity_id FROM _person_name_repair
                            WHERE NOT strong AND NOT recoverable)
       )
 WHERE c.to_entity_ids && (
         SELECT array_agg(entity_id) FROM _person_name_repair WHERE NOT strong AND NOT recoverable
       );

UPDATE ci.communications c
   SET from_entity_id = NULL
  FROM _person_name_repair r
 WHERE c.from_entity_id = r.entity_id
   AND NOT r.strong
   AND NOT r.recoverable;

-- (3) Everything hanging off a Person about to be deleted. `doomed` is
-- (merged away) UNION (dropped): a stub with no strong identifier that is
-- either resolvable to somebody else or not recoverable at all. A stub that is
-- recoverable and is its OWN target survives and is renamed by (5).
CREATE TEMP TABLE _person_name_doomed ON COMMIT DROP AS
SELECT entity_id FROM _person_name_repair
 WHERE NOT strong
   AND (NOT recoverable OR (target_id IS NOT NULL AND target_id <> entity_id));

CREATE INDEX ON _person_name_doomed (entity_id);

DELETE FROM ci.entity_identifiers ei USING _person_name_doomed d WHERE ei.entity_id = d.entity_id;

DELETE FROM ci.pipeline_state ps USING _person_name_doomed d
 WHERE ps.entity_type = 'person' AND ps.entity_id = d.entity_id;

DELETE FROM ci_search.embeddings emb USING _person_name_doomed d
 WHERE emb.entity_type = 'person' AND emb.entity_id = d.entity_id;

DELETE FROM ci_search.vectors v USING _person_name_doomed d
 WHERE v.entity_type = 'person' AND v.entity_id = d.entity_id;

DELETE FROM ci.entities e USING _person_name_doomed d WHERE e.entity_id = d.entity_id;

-- (4) The `name` identifier a surviving row should own, written BEFORE the
-- rename because the working set holds the recovered contact either way.
-- ON CONFLICT DO NOTHING is exactly what
-- `EntityIdentifierService.upsertForEntities` does, so a name another Person
-- already claims stays with that Person. ASCII-only: see the header.
INSERT INTO ci.entity_identifiers (entity_id, owner_user_id, kind, value_normalized, raw_value, source)
SELECT r.entity_id, r.owner_user_id, 'name', r.tail_norm, r.tail, 'migration:20260819002002'
  FROM _person_name_repair r
 WHERE r.recoverable
   AND r.tail !~ '[^ -~]'
   AND NOT EXISTS (SELECT 1 FROM _person_name_doomed d WHERE d.entity_id = r.entity_id)
ON CONFLICT (owner_user_id, kind, value_normalized) DO NOTHING;

-- (5) The rename. `name` is the field a person READS, and the BEFORE UPDATE
-- trigger `entities_search_vector_trigger` recomputes `search_vector` from it,
-- so full-text search stops matching "missed call from" as a side effect.
-- `properties.names` is rewritten too: it is what `GraphIngestService`
-- re-indexes into ci.entity_identifiers, so leaving the garbage there would put
-- the identifier back on the next ingest that touches the row -- the same "the
-- generator is still running" mistake this whole change exists to undo.
-- `properties.{first,middle,last}_name` are recomputed only where they ALREADY
-- exist (the stub minter's `splitPersonName` wrote them, over the heading:
-- first "Received", middle "call from David", last "Florence"); they are never
-- added, because a fresh import of the rename population does not write them
-- either. The rule mirrors `splitPersonName`: one token -> no parts at all,
-- two -> first + last, three or more -> everything between as middle.
UPDATE ci.entities e
   SET name = p.new_name,
       properties =
         CASE
           WHEN p.properties ? 'first_name' OR p.properties ? 'middle_name' OR p.properties ? 'last_name'
             THEN p.base - 'first_name' - 'middle_name' - 'last_name'
                  || CASE
                       WHEN cardinality(p.parts) >= 2
                         THEN jsonb_strip_nulls(jsonb_build_object(
                                'first_name', p.parts[1],
                                'middle_name', CASE WHEN cardinality(p.parts) > 2
                                                    THEN array_to_string(p.parts[2:cardinality(p.parts) - 1], ' ')
                                               END,
                                'last_name', p.parts[cardinality(p.parts)]))
                       ELSE '{}'::jsonb
                     END
           ELSE p.base
         END,
       updated_at = now()
  FROM (
    SELECT r.entity_id,
           r.new_name,
           r.properties,
           string_to_array(r.new_name, ' ') AS parts,
           CASE WHEN r.properties ? 'names'
                THEN jsonb_set(r.properties, '{names}', jsonb_build_array(r.new_name))
                ELSE r.properties
           END AS base
      FROM _person_name_repair r
     WHERE r.new_name IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM _person_name_doomed d WHERE d.entity_id = r.entity_id)
  ) AS p
 WHERE e.entity_id = p.entity_id;

-- (6) Any `name` identifier whose VALUE is itself a heading or a filename,
-- wherever it survived: (5) fixed the entity, this fixes the index the linker
-- resolves against. Self-contained -- such a value is never a legitimate
-- identifier for anybody -- so it needs no reference to the populations above
-- and is idempotent on its own.
DELETE FROM ci.entity_identifiers ei
 WHERE ei.kind = 'name'
   AND (ei.value_normalized ~* '^[[:space:]]*(missed|placed|received|recorded|voicemail)([[:space:]]+call)?[[:space:]]+(from|to|with)\y'
        OR ei.value_normalized ~* '(\.(html?|json|csv|vcf|txt)$)|(^[[:space:]]*group conversation\y)'
        OR ei.value_normalized ~ '[\n\r]');

-- ## Post-migration verification
--
-- Should now be 0 -- no Person is named after a heading or a file:
--   SELECT count(*) FROM ci.entities
--    WHERE entity_type = 'Person'
--      AND (name ~* '^[[:space:]]*(missed|placed|received|recorded|voicemail)([[:space:]]+call)?[[:space:]]+(from|to|with)\y'
--           OR name ~* '(\.(html?|json|csv|vcf|txt)$)|(^[[:space:]]*group conversation\y)'
--           OR name ~ '[\n\r]');
--
-- Should now be 0 -- no dangling reference survives:
--   SELECT count(*) FROM ci.communications c, unnest(c.to_entity_ids) t(id)
--    WHERE NOT EXISTS (SELECT 1 FROM ci.entities e WHERE e.entity_id = t.id);
--   SELECT count(*) FROM ci.communications c
--    WHERE c.from_entity_id IS NOT NULL
--      AND NOT EXISTS (SELECT 1 FROM ci.entities e WHERE e.entity_id = c.from_entity_id);
--
-- Should now be 0 -- no garbage left in the identifier index:
--   SELECT count(*) FROM ci.entity_identifiers
--    WHERE kind = 'name'
--      AND (value_normalized ~* '^[[:space:]]*(missed|placed|received|recorded|voicemail)([[:space:]]+call)?[[:space:]]+(from|to|with)\y'
--           OR value_normalized ~* '(\.(html?|json|csv|vcf|txt)$)|(^[[:space:]]*group conversation\y)');
--
-- ci.communications row count is UNCHANGED; ci.entities loses exactly the 961
-- merged/dropped Person rows.

-- migrate:down
-- No-op: irreversible data repair, same reasoning as
-- 20260818220731_cleanup_group_conversation_person_entities and the other
-- backfills in this directory. The removed rows carried no real name, the
-- renamed rows' previous name was a parser artefact, and nothing records which
-- rows were touched versus already clean, so there is no source of truth to
-- roll back to.
