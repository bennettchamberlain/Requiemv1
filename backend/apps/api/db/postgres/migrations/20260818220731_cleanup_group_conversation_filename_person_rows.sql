-- migrate:up
-- Clean up 241 ci.entities Person rows created from a Google Voice
-- "Group Conversation - <timestamp>.html" export filename, not from any
-- actual contact name.
--
-- ## The bug (already fixed for future imports, 3e5956cb0)
--
-- backend/apps/api/src/domains/import/datasources/googlevoice.ts derives its
-- "conversation" label by stripping " - <Type> - <timestamp>" off the HTML
-- file's basename. A Google Voice group-SMS/MMS thread exports as a file
-- literally named "Group Conversation - 2024-09-25T01_45_41Z.html" — the
-- label itself, not a prefix before it — so the strip pattern never matches
-- and (pre-3e5956cb0) `replace()` returned the untouched basename, which was
-- then used as the CONTACT NAME for any outbound message in that thread whose
-- per-message sender markup didn't resolve to a real participant. That value
-- flows through `metadata.To` -> `participants_metadata.to` on the
-- resulting ci.communications row -> PersonStubBackfillService /
-- CommunicationParticipantLinkListener, which mint a stub Person for every
-- unrecognised raw participant string. 3e5956cb0 (2026-08-18, already on
-- this branch) fixed the parser so the label is only used when the strip
-- actually matched something; it did not touch rows already written under
-- the old parser, which is what this migration is for.
--
-- These rows are not a mis-typed person AND not a "group chat" worth its own
-- entity: the export's group-thread markup never yielded a resolvable
-- participant for these particular outbound messages, so there is no
-- participant list, group name, or any other salvageable identity to carry
-- forward — Google Voice group exports carry no group-name field at all
-- (unlike iMessage's `GroupName`), and this codebase has no Group/Thread
-- entity type to file one under regardless. The honest fix is removal, not
-- reclassification.
--
-- ## Verified against the live appliance database before writing this migration
--
--   SELECT count(*) FROM ci.entities
--    WHERE entity_type = 'Person'
--      AND linked_table = 'import:communications:participant'
--      AND name ~ '^Group Conversation - \d{4}-\d{2}-\d{2}T\d{2}_\d{2}_\d{2}Z\.html$';
--   -- 241 (matches the count reported in 3e5956cb0's commit message and the
--   -- audit that motivated this migration; scoped to linked_table so a
--   -- legitimately-named contact who happens to be called "Group
--   -- Conversation - ....html" via some other import path -- there is none
--   -- today -- would never be swept up)
--
-- Foreign-key / reference audit for those 241 entity_ids (ci.communications
-- has no formal FK on from_entity_id/to_entity_ids -- they are plain
-- uuid/uuid[] columns -- so this was checked by hand across every table in
-- the `ci`/`ci_search` schemas carrying an *entity_id column, per the task
-- brief's explicit call-out of communications.from_entity_id/to_entity_ids
-- and entity_identifiers):
--
--   comm_from (from_entity_id)        0
--   comm_to   (to_entity_ids &&)      446   <- handled below (array_remove)
--   event_organizer_entity_id         0
--   event_participant_entity_ids      0
--   entity_identifiers.entity_id      241   <- handled below (delete)
--   identifier_claims.entity_id       0
--   relationships (from/to)           0
--   entity_merges / merge_blocks /
--     merge_candidates                0
--   entities.merged_into_entity_id    0     <- nothing merged INTO a bad row
--   users.entity_id                   0
--   inventory / receipts              0
--   ci.pipeline_state.entity_id       482   <- handled below (delete;
--                                               entity_type='person',
--                                               stages index.embed_person /
--                                               index.vector_person, 241 each)
--   ci_search.embeddings.entity_id    241   <- handled below (delete)
--   ci_search.vectors.entity_id       241   <- handled below (delete)
--   ci_search.entity_tag/index_skips  0
--
-- Only `ci.communications.to_entity_ids` carries real, non-bookkeeping data
-- (446 rows) — always as a RECIPIENT (to_entity_ids), never as a sender
-- (from_entity_id is 0, consistent with the bug only ever populating the
-- outbound `To` field). Those communications and every other column on them
-- are untouched; only the bad entity_id is removed from the array, exactly
-- the same "not yet resolved" state PersonLinkStage/CommunicationParticipant
-- LinkListener already use for a recipient nothing has matched (NULL when
-- the array becomes empty, matching their own convention — see
-- PersonLinkStage.ts's `to_entity_ids IS NULL OR cardinality(...) = 0`
-- applicability predicate), so a future relinking sweep naturally revisits
-- them instead of reading as "already resolved, nothing to do".
--
-- Idempotent: every statement is scoped by the same bad-entity-id CTE
-- (recomputed fresh each statement, cheap at 241 rows), so a second run finds
-- zero matching entities and each statement affects zero rows.
-- Array subtraction (unnest + filter + re-aggregate) rather than a join to
-- bad_entities + array_remove: a plain join re-visits the same
-- communications row once per matching bad id it holds, and a per-match
-- array_remove would only ever strip the LAST-joined one, leaving the others
-- behind. array_agg naturally collapses to NULL when every element is
-- filtered out, which is exactly the "no recipients resolved" state
-- PersonLinkStage / CommunicationParticipantLinkListener already use.
WITH bad_entities AS (
  SELECT entity_id
    FROM ci.entities
   WHERE entity_type = 'Person'
     AND linked_table = 'import:communications:participant'
     AND name ~ '^Group Conversation - \d{4}-\d{2}-\d{2}T\d{2}_\d{2}_\d{2}Z\.html$'
)
UPDATE ci.communications c
   SET to_entity_ids = (
         SELECT array_agg(id)
           FROM unnest(c.to_entity_ids) AS id
          WHERE id NOT IN (SELECT entity_id FROM bad_entities)
       )
 WHERE c.to_entity_ids && (SELECT array_agg(entity_id) FROM bad_entities);

WITH bad_entities AS (
  SELECT entity_id
    FROM ci.entities
   WHERE entity_type = 'Person'
     AND linked_table = 'import:communications:participant'
     AND name ~ '^Group Conversation - \d{4}-\d{2}-\d{2}T\d{2}_\d{2}_\d{2}Z\.html$'
)
DELETE FROM ci.entity_identifiers ei
 USING bad_entities bad
 WHERE ei.entity_id = bad.entity_id;

WITH bad_entities AS (
  SELECT entity_id
    FROM ci.entities
   WHERE entity_type = 'Person'
     AND linked_table = 'import:communications:participant'
     AND name ~ '^Group Conversation - \d{4}-\d{2}-\d{2}T\d{2}_\d{2}_\d{2}Z\.html$'
)
DELETE FROM ci.pipeline_state ps
 USING bad_entities bad
 WHERE ps.entity_type = 'person'
   AND ps.entity_id = bad.entity_id;

WITH bad_entities AS (
  SELECT entity_id
    FROM ci.entities
   WHERE entity_type = 'Person'
     AND linked_table = 'import:communications:participant'
     AND name ~ '^Group Conversation - \d{4}-\d{2}-\d{2}T\d{2}_\d{2}_\d{2}Z\.html$'
)
DELETE FROM ci_search.embeddings emb
 USING bad_entities bad
 WHERE emb.entity_type = 'person'
   AND emb.entity_id = bad.entity_id;

WITH bad_entities AS (
  SELECT entity_id
    FROM ci.entities
   WHERE entity_type = 'Person'
     AND linked_table = 'import:communications:participant'
     AND name ~ '^Group Conversation - \d{4}-\d{2}-\d{2}T\d{2}_\d{2}_\d{2}Z\.html$'
)
DELETE FROM ci_search.vectors v
 USING bad_entities bad
 WHERE v.entity_type = 'person'
   AND v.entity_id = bad.entity_id;

DELETE FROM ci.entities
 WHERE entity_type = 'Person'
   AND linked_table = 'import:communications:participant'
   AND name ~ '^Group Conversation - \d{4}-\d{2}-\d{2}T\d{2}_\d{2}_\d{2}Z\.html$';

-- ## Post-migration verification
--
-- Should now be 0:
--   SELECT count(*) FROM ci.entities
--    WHERE entity_type = 'Person'
--      AND name ~ '^Group Conversation - \d{4}-\d{2}-\d{2}T\d{2}_\d{2}_\d{2}Z\.html$';
--
-- Should now be 0 (no dangling recipient references survive):
--   SELECT count(*) FROM ci.communications c, unnest(c.to_entity_ids) t(id)
--    WHERE NOT EXISTS (SELECT 1 FROM ci.entities e WHERE e.entity_id = t.id);
--
-- Total communications row count, and the count with a real content/preview,
-- should be UNCHANGED by this migration -- only the recipient array shrank.

-- migrate:down
-- No-op: irreversible data cleanup, same reasoning as
-- 20260818213148_backfill_google_voice_call_heading_duplication and the other
-- backfill migrations in this directory -- the removed Person rows carried no
-- real name (their name literally was an HTML export's filename), the
-- to_entity_ids entries they held were never a genuine resolution, and
-- nothing records which specific array slots were touched versus already
-- empty, so there is no source of truth to roll back to.
