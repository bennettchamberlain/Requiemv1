-- migrate:up

-- Repair `ci.content.event_id` for rows written while `DESTINATION_ORDER` put
-- content ahead of events.
--
-- `ContentService.createManyDetailed` resolves `event_id` from the provenance
-- triple at INSERT time (`resolveEventIdsByTriple`). Between 19cace2eb
-- (2026-08-17, the batching refactor) and the fix this migration accompanies,
-- the batch wrote every content row before any event row, so that lookup found
-- nothing and the column stayed NULL for every row of every import in that
-- window. On a 1,393,402-record corpus that was 0 of 41,851 linked, with 2,916
-- sharing a triple with an event and eligible here.
--
-- What that column feeds: `findMediaFilesByEventIds` filters on
-- `content.event_id` and inner-joins the event, and it is the query behind every
-- gallery, list and drawer thumbnail. The L0 `Content -DOCUMENTS-> Event` edge
-- rule is likewise zero-candidate without it. So the visible symptom is blank
-- media everywhere, not a missing column in an admin view.
--
-- Keyed on the triple, NOT on "event_id IS NULL" alone: a re-run must be able to
-- pick up rows a partial earlier run left behind, and must never overwrite a
-- link that already exists. The `event_id IS NULL` guard makes it idempotent;
-- the join makes it correct.
--
-- Re-import does NOT do this instead: `INGEST_REFRESH_COLUMNS.content` is `[]`,
-- so a second import of the same corpus is find-or-return and never revisits
-- the column. Without this migration the existing rows have no repair path.
--
-- The triple is unique per source row, but a defensive DISTINCT ON keeps the
-- statement single-valued even if a corpus ever violated that.

UPDATE ci.content AS c
   SET event_id = m.event_id,
       updated_at = now()
  FROM (
    SELECT DISTINCT ON (e.source_type, e.source_system, e.source_id)
           e.source_type,
           e.source_system,
           e.source_id,
           e.user_id,
           e.event_id
      FROM ci.events e
     WHERE e.source_type   IS NOT NULL
       AND e.source_system IS NOT NULL
       AND e.source_id     IS NOT NULL
     ORDER BY e.source_type, e.source_system, e.source_id, e.created_at
  ) AS m
 WHERE c.event_id      IS NULL
   AND c.source_type   = m.source_type
   AND c.source_system = m.source_system
   AND c.source_id     = m.source_id
   -- ci.content.user_id is nullable on rows minted before the insert:false fix,
   -- so a NULL on the content side must not block the repair; a non-NULL one
   -- must still match, so one user's event can never claim another's content.
   AND (c.user_id IS NULL OR c.user_id = m.user_id);

-- migrate:down

-- Irreversible by design. The prior state is "this link was never derived",
-- which is indistinguishable from a link legitimately absent because no event
-- shares the triple. Unsetting every event_id would destroy the links the fixed
-- push writes correctly at insert time, so down is a deliberate no-op.
SELECT 1;
