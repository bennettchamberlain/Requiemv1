-- migrate:up
-- Remove the ci.content rows an Instagram HTML import wrote with no text, no
-- url and no file behind them, and the capture.photo events it minted for
-- media entries that carried no media -- both already fixed for future imports
-- in this same branch (datasources/instagram.ts, push/canonical.ts kindFor).
--
-- ## The bug (three faces of one cause: the parser read the LABEL, not the value)
--
-- processHtmlActivity built every activity entry out of `htmlToText(chunk)`,
-- i.e. what survives a tag strip. Everything that identifies one of these
-- entries lives in an ATTRIBUTE, which a tag strip cannot reach:
--
--  * F25 -- the per-entry permalink is `<a href="https://www.instagram.com/p/
--    <shortcode>/">`. It was never mapped, so `like` / `post` /
--    `social_bookmark` content rows reached ci.content with a blank `text` AND
--    a blank `url`: rows that name nothing, link to nothing, and embed to
--    nothing. 2,010 of them across the affected appliances.
--  * F24 -- other_content.html ships byte-identical placeholder entries whose
--    only fields are an EMPTY `Media` cell plus "Is an advertisement: False"
--    and an "Update time". None of that is an empty string, so the only guard
--    (`if (!text) continue;`) never fired, and each survived under its own
--    `#<i>` id so they never deduped against each other either.
--  * F23 -- profile_photos.html entries reference their jpg via `<img src>` /
--    `<a href>` resolved through the page's `<base href="../../">`. The path
--    was never resolved, so the entry landed as a text/plain row with an empty
--    external_id and no url -- and kindFor read classification 'media' with a
--    non-media MIME as capture.photo, manufacturing a photo event with no
--    photo behind it.
--
-- ## Why these rows are DELETED rather than repaired in place
--
-- There is nothing to repair from. The permalink, the owner handle and the
-- media path were never persisted anywhere -- not in `text`, not in `url`, not
-- in `source_data` (which holds only {Type, Source, kind, filename} for these
-- rows). The only source of the missing values is the export on disk, which
-- means re-parsing, which means a re-import.
--
-- And a re-import alone does NOT fix them: INGEST_REFRESH_COLUMNS.content and
-- .event are both [], so ingest is find-or-return -- a second import of the
-- same export returns the existing blank row untouched. Worse, the fixed
-- parser keys a post-bearing content row on the post URI
-- (`instagram:p:<shortcode>`) instead of the per-entry id, so the repaired row
-- arrives under a DIFFERENT source_id and the blank one would survive
-- alongside it forever as a permanent duplicate. Deleting first is what makes
-- the re-import land as a create instead of a no-op.
--
-- ## Why the fixed parser cannot re-create them
--
-- Deleting bad rows that a live code path re-mints is theatre. It does not
-- re-mint them: the F24 entries are now dropped by a substance guard before
-- they are ever pushed, the F23 entries are dropped unless their file resolves
-- on disk (and then they are emitted as real image/jpeg media items), and a
-- like/save/repost/story-view now carries metadata.URL, so a content row with
-- a blank text AND a blank url is no longer a shape this importer can produce.
--
-- ## Verified against a real appliance database before writing this migration
--
--   SELECT type, count(*) FROM ci.content
--    WHERE source_system = 'instagram' GROUP BY 1;
--   -- like 22, media 6, social_bookmark 6, post 5  (39 total)
--
--   -- Every one of those 39 matches the predicate below: 33 blank-text-and-url
--   -- (F25), 5 other_content placeholders + 1 profile photo (F24/F23). Zero
--   -- Instagram content rows are correct today, so nothing correct is touched.
--
--   SELECT count(*) FROM ci.events
--    WHERE source_system = 'instagram' AND metadata->>'kind' = 'capture.photo';
--   -- 6  (5 other_content.html + 1 profile_photos.html -- every "photo"
--   --     Instagram has ever produced on this appliance, none with a photo)
--
--   -- Reference audit for the 39 content ids (only ci.content and ci.events
--   -- carry FKs to ci.entities; ci.relationships, ci_search.*,
--   -- ci.pipeline_state and ci.graph_deltas hold plain uuid columns and are
--   -- cleaned by hand, exactly as in 20260818220731):
--   --   ci.entities                    39   <- deleted (cascades to ci.content)
--   --   ci_search.embeddings           39   <- deleted
--   --   ci_search.vectors              39   <- deleted
--   --   ci.pipeline_state              84   <- deleted
--   --   ci.graph_deltas                39   <- deleted
--   --   ci.relationships (from)         6   <- deleted (DOCUMENTS -> its event)
--   --   ci.relationships (to)           0
--   --   hbpe.content_context            0   <- FK, deleted defensively
--   --   hbpe.l2_content_cluster         0   <- FK, deleted defensively
--   --   ci_search.entity_tag            0
--   --   ci_search.index_skips           0
--   --   ci.entity_identifiers           0
--   --   ci.identifier_claims            0
--   --   ci.object_observations          0
--   --   ci.pipeline_dead_letters        0
--   --   ci.users                        0
--   -- and for the 6 event ids: entities 6, embeddings 6, vectors 6,
--   -- pipeline_state 12, graph_deltas 6, relationships(to) 6,
--   -- hbpe.l1_event_cluster 0, ci.event_analytics 0, ci.capture_events 0.
--
-- ## Scope guards
--
-- `external_id IS NULL` is what keeps a REPAIRED row safe: once the media leg
-- runs, a profile photo's content row carries external_id = <file id> with
-- external_id_kind = 'file', so it fails the predicate and survives. The same
-- guard, expressed as a NOT EXISTS, is what keeps a repaired photo's EVENT
-- safe. `mimetype = 'text/plain'` narrows the other_content/profile_photos
-- branches to rows written by the broken text lane -- a correctly imported
-- image/jpeg row is never in range. Nothing outside source_system='instagram'
-- with an 'instagram:%' source_id is considered at all.
--
-- Idempotent: every statement recomputes the same predicate (cheap at 39
-- rows), so a second run selects zero rows and each statement affects zero
-- rows. Ordered so each hand-cleaned table is emptied while ci.content still
-- exists to select from; the ci.entities delete goes last and takes ci.content
-- with it through content_id_entities_fk (ON DELETE CASCADE).

-- ---------------------------------------------------------------------------
-- 1. Contentless ci.content rows (F25 blank rows + F24/F23 media-less rows)
-- ---------------------------------------------------------------------------

WITH bad_content AS (
  SELECT id
    FROM ci.content
   WHERE source_system = 'instagram'
     AND source_id LIKE 'instagram:%'
     AND external_id IS NULL
     AND coalesce(btrim(url), '') = ''
     AND (
           coalesce(btrim(text), '') = ''
        OR (
             mimetype = 'text/plain'
             AND (
                   source_id LIKE 'instagram:other_content.html#%'
                OR source_id LIKE 'instagram:profile_photos.html#%'
             )
           )
         )
)
DELETE FROM ci.relationships r
 USING bad_content bad
 WHERE r.from_entity_id = bad.id
    OR r.to_entity_id = bad.id;

WITH bad_content AS (
  SELECT id
    FROM ci.content
   WHERE source_system = 'instagram'
     AND source_id LIKE 'instagram:%'
     AND external_id IS NULL
     AND coalesce(btrim(url), '') = ''
     AND (
           coalesce(btrim(text), '') = ''
        OR (
             mimetype = 'text/plain'
             AND (
                   source_id LIKE 'instagram:other_content.html#%'
                OR source_id LIKE 'instagram:profile_photos.html#%'
             )
           )
         )
)
DELETE FROM ci_search.embeddings emb
 USING bad_content bad
 WHERE emb.entity_type = 'content'
   AND emb.entity_id = bad.id;

WITH bad_content AS (
  SELECT id
    FROM ci.content
   WHERE source_system = 'instagram'
     AND source_id LIKE 'instagram:%'
     AND external_id IS NULL
     AND coalesce(btrim(url), '') = ''
     AND (
           coalesce(btrim(text), '') = ''
        OR (
             mimetype = 'text/plain'
             AND (
                   source_id LIKE 'instagram:other_content.html#%'
                OR source_id LIKE 'instagram:profile_photos.html#%'
             )
           )
         )
)
DELETE FROM ci_search.vectors v
 USING bad_content bad
 WHERE v.entity_type = 'content'
   AND v.entity_id = bad.id;

WITH bad_content AS (
  SELECT id
    FROM ci.content
   WHERE source_system = 'instagram'
     AND source_id LIKE 'instagram:%'
     AND external_id IS NULL
     AND coalesce(btrim(url), '') = ''
     AND (
           coalesce(btrim(text), '') = ''
        OR (
             mimetype = 'text/plain'
             AND (
                   source_id LIKE 'instagram:other_content.html#%'
                OR source_id LIKE 'instagram:profile_photos.html#%'
             )
           )
         )
)
DELETE FROM ci.pipeline_state ps
 USING bad_content bad
 WHERE ps.entity_type = 'content'
   AND ps.entity_id = bad.id;

WITH bad_content AS (
  SELECT id
    FROM ci.content
   WHERE source_system = 'instagram'
     AND source_id LIKE 'instagram:%'
     AND external_id IS NULL
     AND coalesce(btrim(url), '') = ''
     AND (
           coalesce(btrim(text), '') = ''
        OR (
             mimetype = 'text/plain'
             AND (
                   source_id LIKE 'instagram:other_content.html#%'
                OR source_id LIKE 'instagram:profile_photos.html#%'
             )
           )
         )
)
DELETE FROM ci.graph_deltas gd
 USING bad_content bad
 WHERE gd.entity_id = bad.id;

WITH bad_content AS (
  SELECT id
    FROM ci.content
   WHERE source_system = 'instagram'
     AND source_id LIKE 'instagram:%'
     AND external_id IS NULL
     AND coalesce(btrim(url), '') = ''
     AND (
           coalesce(btrim(text), '') = ''
        OR (
             mimetype = 'text/plain'
             AND (
                   source_id LIKE 'instagram:other_content.html#%'
                OR source_id LIKE 'instagram:profile_photos.html#%'
             )
           )
         )
)
DELETE FROM hbpe.content_context cc
 USING bad_content bad
 WHERE cc.content_id = bad.id;

WITH bad_content AS (
  SELECT id
    FROM ci.content
   WHERE source_system = 'instagram'
     AND source_id LIKE 'instagram:%'
     AND external_id IS NULL
     AND coalesce(btrim(url), '') = ''
     AND (
           coalesce(btrim(text), '') = ''
        OR (
             mimetype = 'text/plain'
             AND (
                   source_id LIKE 'instagram:other_content.html#%'
                OR source_id LIKE 'instagram:profile_photos.html#%'
             )
           )
         )
)
DELETE FROM hbpe.l2_content_cluster lc
 USING bad_content bad
 WHERE lc.content_id = bad.id;

-- Deleting the ci.entities base row removes the ci.content row with it
-- (content_id_entities_fk, ON DELETE CASCADE). The subquery is evaluated
-- against the statement's own snapshot, before the referential action fires.
DELETE FROM ci.entities e
 WHERE e.entity_type = 'Content'
   AND e.entity_id IN (
     SELECT id
       FROM ci.content
      WHERE source_system = 'instagram'
        AND source_id LIKE 'instagram:%'
        AND external_id IS NULL
        AND coalesce(btrim(url), '') = ''
        AND (
              coalesce(btrim(text), '') = ''
           OR (
                mimetype = 'text/plain'
                AND (
                      source_id LIKE 'instagram:other_content.html#%'
                   OR source_id LIKE 'instagram:profile_photos.html#%'
                )
              )
            )
   );

-- ---------------------------------------------------------------------------
-- 2. Phantom capture.photo events (F24 placeholders + F23 photo-less photos)
-- ---------------------------------------------------------------------------
--
-- Scoped to the two media files whose entries the fixed parser now drops
-- outright when no bytes resolve, and only where no file-bearing content row
-- exists for the same provenance triple -- so a photo that HAS been repaired
-- (external_id_kind = 'file') keeps its event.

WITH bad_events AS (
  SELECT ev.event_id
    FROM ci.events ev
   WHERE ev.source_system = 'instagram'
     AND (
           ev.source_id LIKE 'instagram:other_content.html#%'
        OR ev.source_id LIKE 'instagram:profile_photos.html#%'
         )
     AND ev.metadata->>'kind' = 'capture.photo'
     AND NOT EXISTS (
       SELECT 1
         FROM ci.content c
        WHERE c.source_type = ev.source_type
          AND c.source_system = ev.source_system
          AND c.source_id = ev.source_id
          AND c.external_id_kind = 'file'
     )
)
DELETE FROM ci.relationships r
 USING bad_events bad
 WHERE r.from_entity_id = bad.event_id
    OR r.to_entity_id = bad.event_id;

WITH bad_events AS (
  SELECT ev.event_id
    FROM ci.events ev
   WHERE ev.source_system = 'instagram'
     AND (
           ev.source_id LIKE 'instagram:other_content.html#%'
        OR ev.source_id LIKE 'instagram:profile_photos.html#%'
         )
     AND ev.metadata->>'kind' = 'capture.photo'
     AND NOT EXISTS (
       SELECT 1
         FROM ci.content c
        WHERE c.source_type = ev.source_type
          AND c.source_system = ev.source_system
          AND c.source_id = ev.source_id
          AND c.external_id_kind = 'file'
     )
)
DELETE FROM ci_search.embeddings emb
 USING bad_events bad
 WHERE emb.entity_type = 'event'
   AND emb.entity_id = bad.event_id;

WITH bad_events AS (
  SELECT ev.event_id
    FROM ci.events ev
   WHERE ev.source_system = 'instagram'
     AND (
           ev.source_id LIKE 'instagram:other_content.html#%'
        OR ev.source_id LIKE 'instagram:profile_photos.html#%'
         )
     AND ev.metadata->>'kind' = 'capture.photo'
     AND NOT EXISTS (
       SELECT 1
         FROM ci.content c
        WHERE c.source_type = ev.source_type
          AND c.source_system = ev.source_system
          AND c.source_id = ev.source_id
          AND c.external_id_kind = 'file'
     )
)
DELETE FROM ci_search.vectors v
 USING bad_events bad
 WHERE v.entity_type = 'event'
   AND v.entity_id = bad.event_id;

WITH bad_events AS (
  SELECT ev.event_id
    FROM ci.events ev
   WHERE ev.source_system = 'instagram'
     AND (
           ev.source_id LIKE 'instagram:other_content.html#%'
        OR ev.source_id LIKE 'instagram:profile_photos.html#%'
         )
     AND ev.metadata->>'kind' = 'capture.photo'
     AND NOT EXISTS (
       SELECT 1
         FROM ci.content c
        WHERE c.source_type = ev.source_type
          AND c.source_system = ev.source_system
          AND c.source_id = ev.source_id
          AND c.external_id_kind = 'file'
     )
)
DELETE FROM ci.pipeline_state ps
 USING bad_events bad
 WHERE ps.entity_type = 'event'
   AND ps.entity_id = bad.event_id;

WITH bad_events AS (
  SELECT ev.event_id
    FROM ci.events ev
   WHERE ev.source_system = 'instagram'
     AND (
           ev.source_id LIKE 'instagram:other_content.html#%'
        OR ev.source_id LIKE 'instagram:profile_photos.html#%'
         )
     AND ev.metadata->>'kind' = 'capture.photo'
     AND NOT EXISTS (
       SELECT 1
         FROM ci.content c
        WHERE c.source_type = ev.source_type
          AND c.source_system = ev.source_system
          AND c.source_id = ev.source_id
          AND c.external_id_kind = 'file'
     )
)
DELETE FROM ci.graph_deltas gd
 USING bad_events bad
 WHERE gd.entity_id = bad.event_id;

WITH bad_events AS (
  SELECT ev.event_id
    FROM ci.events ev
   WHERE ev.source_system = 'instagram'
     AND (
           ev.source_id LIKE 'instagram:other_content.html#%'
        OR ev.source_id LIKE 'instagram:profile_photos.html#%'
         )
     AND ev.metadata->>'kind' = 'capture.photo'
     AND NOT EXISTS (
       SELECT 1
         FROM ci.content c
        WHERE c.source_type = ev.source_type
          AND c.source_system = ev.source_system
          AND c.source_id = ev.source_id
          AND c.external_id_kind = 'file'
     )
)
DELETE FROM hbpe.l1_event_cluster lc
 USING bad_events bad
 WHERE lc.event_id = bad.event_id;

-- As above: the base row takes ci.events with it (events_event_id_entities_fk,
-- ON DELETE CASCADE), and ci.event_analytics cascades from ci.events.
DELETE FROM ci.entities e
 WHERE e.entity_type = 'Event'
   AND e.entity_id IN (
     SELECT ev.event_id
       FROM ci.events ev
      WHERE ev.source_system = 'instagram'
        AND (
              ev.source_id LIKE 'instagram:other_content.html#%'
           OR ev.source_id LIKE 'instagram:profile_photos.html#%'
            )
        AND ev.metadata->>'kind' = 'capture.photo'
        AND NOT EXISTS (
          SELECT 1
            FROM ci.content c
           WHERE c.source_type = ev.source_type
             AND c.source_system = ev.source_system
             AND c.source_id = ev.source_id
             AND c.external_id_kind = 'file'
        )
   );

-- ## Post-migration verification
--
-- Should now be 0 (no Instagram content row without text, url or a file):
--   SELECT count(*) FROM ci.content
--    WHERE source_system = 'instagram' AND external_id IS NULL
--      AND coalesce(btrim(url), '') = '' AND coalesce(btrim(text), '') = '';
--
-- Should now be 0 (no Instagram photo event without a photo):
--   SELECT count(*) FROM ci.events ev
--    WHERE ev.source_system = 'instagram' AND ev.metadata->>'kind' = 'capture.photo'
--      AND NOT EXISTS (SELECT 1 FROM ci.content c
--                       WHERE c.source_type = ev.source_type
--                         AND c.source_system = ev.source_system
--                         AND c.source_id = ev.source_id
--                         AND c.external_id_kind = 'file');
--
-- Should now be 0 (nothing dangling in the hand-cleaned tables):
--   SELECT count(*) FROM ci_search.vectors v
--    WHERE v.entity_type IN ('content', 'event')
--      AND NOT EXISTS (SELECT 1 FROM ci.entities e WHERE e.entity_id = v.entity_id);
--
-- Instagram DMs (ci.communications) and follower/following rows are untouched;
-- their counts should be UNCHANGED.
--
-- Re-import the Instagram export afterwards to repopulate: the deleted rows
-- come back with a permalink, an owner, a single copy of each caption, and --
-- for a profile photo -- the actual bytes.

-- migrate:down
-- No-op: irreversible data cleanup, same reasoning as
-- 20260818220731_cleanup_group_conversation_filename_person_rows and the other
-- backfill migrations in this directory. The removed rows carried no text, no
-- url and no file -- there is nothing to restore them to, and nothing records
-- which rows were deleted versus already absent. Re-importing the Instagram
-- export is the forward path.
