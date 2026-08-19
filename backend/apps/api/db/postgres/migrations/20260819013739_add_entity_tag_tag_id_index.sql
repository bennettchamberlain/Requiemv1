-- migrate:up

-- `entity_tag.tag_id` carries a foreign key to `ci_search.tags`, and Postgres
-- does NOT index the referencing side of a FK. Every tag-keyed access is
-- therefore a sequential scan over the whole join table:
--
--   * `getEntitiesForTags` / `getTagUsageCounts` join `t.id = et.tag_id`
--     (the hot path behind every tag filter in search and the graph),
--   * renaming a tag onto an existing label re-points its rows with
--     `UPDATE ... WHERE tag_id = $1`,
--   * deleting a tag clears them with `DELETE ... WHERE tag_id = $1`
--     — which the FK forces us to do first, since it has no ON DELETE rule.
--
-- The unique constraint `entity_tag_unique_entry (entity_type, entity_id,
-- tag_id)` cannot serve any of these: `tag_id` is its trailing column.

CREATE INDEX IF NOT EXISTS entity_tag_tag_id_idx ON ci_search.entity_tag (tag_id);

-- migrate:down

DROP INDEX IF EXISTS ci_search.entity_tag_tag_id_idx;
