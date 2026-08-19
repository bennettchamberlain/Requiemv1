-- migrate:up

-- ═══════════════════════════════════════════════════════════════════════════
-- Pre-fill ci.pipeline_state for the new index.embed_* / index.vector* stages.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- The per-entity-type embed stages and the tsvector stages ship with an empty
-- ledger, and an empty ledger means "nothing has ever been processed": their
-- first sweeps would re-embed the ENTIRE existing corpus (hours of contended
-- GPU for ~900k communications alone) and re-write every tsvector, all to
-- produce rows the index already holds. Every existing ci_search row was
-- written by the search-index listeners with the same model (generation 1,
-- nomic-embed-text@768) and the same weighted-text recipes the stages now
-- share, so recording them as done at version 1 is accurate, not a shortcut.
--
-- A future model switch bumps the embed stages' derived version past 1 and
-- re-embeds everything properly — pre-filled rows included, which is exactly
-- the property the ledger exists for.
--
-- ON CONFLICT DO NOTHING throughout: index.embed (content) has been live on
-- the ledger and its real rows must win over inference from index presence.

-- Every existing dense embedding → its type's embed stage, done at v1.
INSERT INTO ci.pipeline_state (entity_type, entity_id, stage, stage_version, status, attempts, user_id)
SELECT e.entity_type, e.entity_id, m.stage, 1, 'done', 0, e.user_id
  FROM ci_search.embeddings e
  JOIN (VALUES
         ('content',          'index.embed'),
         ('communication',    'index.embed_communication'),
         ('event',            'index.embed_event'),
         ('item',             'index.embed_item'),
         ('person',           'index.embed_person'),
         ('file',             'index.embed_file'),
         ('browser-activity', 'index.embed_browser_activity')
       ) AS m(entity_type, stage) ON m.entity_type = e.entity_type
ON CONFLICT (entity_type, entity_id, stage) DO NOTHING;

-- Every existing tsvector → its type's vector stage, done at v1.
INSERT INTO ci.pipeline_state (entity_type, entity_id, stage, stage_version, status, attempts, user_id)
SELECT v.entity_type, v.entity_id, m.stage, 1, 'done', 0, v.user_id
  FROM ci_search.vectors v
  JOIN (VALUES
         ('content',          'index.vector'),
         ('communication',    'index.vector_communication'),
         ('event',            'index.vector_event'),
         ('item',             'index.vector_item'),
         ('person',           'index.vector_person'),
         ('file',             'index.vector_file'),
         ('browser-activity', 'index.vector_browser_activity')
       ) AS m(entity_type, stage) ON m.entity_type = v.entity_type
ON CONFLICT (entity_type, entity_id, stage) DO NOTHING;

-- Deliberate listener skips (ci_search.index_skips) → skipped ledger rows for
-- the embed stages, reason preserved. Without these the stages would re-examine
-- (and re-decline) every low-value row the listeners already judged.
-- index_skips carries no user_id; the ledger column is nullable and the sweep
-- anti-join keys on (entity_type, entity_id, stage) alone.
INSERT INTO ci.pipeline_state (entity_type, entity_id, stage, stage_version, status, reason, attempts, user_id)
SELECT k.entity_type, k.entity_id, m.stage, 1, 'skipped', k.reason, 0, NULL
  FROM ci_search.index_skips k
  JOIN (VALUES
         ('content',          'index.embed'),
         ('communication',    'index.embed_communication'),
         ('event',            'index.embed_event'),
         ('item',             'index.embed_item'),
         ('person',           'index.embed_person'),
         ('file',             'index.embed_file'),
         ('browser-activity', 'index.embed_browser_activity')
       ) AS m(entity_type, stage) ON m.entity_type = k.entity_type
ON CONFLICT (entity_type, entity_id, stage) DO NOTHING;

-- migrate:down

-- Removes the pre-fill for the stages that were NEW in this migration. Rows
-- under 'index.embed' (content) are deliberately left alone: that stage was
-- live before this migration, so its pre-filled rows cannot be told apart from
-- ledger rows the pipeline wrote itself, and deleting them would re-embed the
-- content corpus on the next sweep.
DELETE FROM ci.pipeline_state
 WHERE stage IN (
         'index.embed_communication',
         'index.embed_event',
         'index.embed_item',
         'index.embed_person',
         'index.embed_file',
         'index.embed_browser_activity',
         'index.vector',
         'index.vector_communication',
         'index.vector_event',
         'index.vector_item',
         'index.vector_person',
         'index.vector_file',
         'index.vector_browser_activity'
       );
