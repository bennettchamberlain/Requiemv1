-- migrate:up
-- =================================================================
-- GRAPH DELTAS — recorded by the database, not by the ORM
-- =================================================================
--
-- `ci.graph_deltas` was created (20260120150000_create_graph_deltas.sql) with
-- this note at the top of the file:
--
--     Delta records are created by the application layer (TypeScript services)
--     rather than database triggers, keeping logic versioned and testable.
--
-- The application layer in question was `DeltaEntitySubscriber`, a TypeORM
-- EntitySubscriber hooking afterInsert / afterUpdate / afterRemove. It has
-- never recorded a single delta. Measured on a live appliance:
--
--     ci.entities = 170     ci.relationships = 0     ci.graph_deltas = 0
--
-- ORM subscribers fire only for writes that go through TypeORM's entity
-- manager. `GraphIngestService` — the path essentially every entity and
-- relationship on this appliance arrives by — writes with
-- `.createQueryBuilder().insert().values(...)` in ON CONFLICT DO UPDATE chunks
-- (measured at ~6,200 records/sec). The query builder emits no subscriber
-- events, so the subscriber sat there, correct-looking and inert, while the
-- graph filled up.
--
-- The table is READ. `backend/apps/summary/src/ci/summary/insight_aggregator.py`
-- builds the "what changed in your graph" section of every insight summary out
-- of it (`has_new_data`, `_get_graph_deltas`, `_get_recently_changed_relationships`).
-- Those queries have returned zero rows for as long as they have existed, and a
-- zero-row answer is indistinguishable from "your graph was quiet" — so the
-- feature has been silently reporting a still graph on an appliance that was
-- ingesting continuously.
--
-- Hence triggers, and STATEMENT-level ones with transition tables:
--
--   * A trigger cannot be bypassed by ANY write path — ORM, query builder, raw
--     SQL, COPY, a psql session, a service nobody has written yet.
--     Bypassability is precisely how this broke.
--   * `FOR EACH STATEMENT ... REFERENCING NEW TABLE` keeps a set-based write
--     set-based: a 50,000-row bulk insert costs ONE function call and ONE
--     `INSERT ... SELECT`, not 50,000 of them. A FOR EACH ROW trigger would have
--     bought the same coverage by spending the throughput the import path is
--     built on.
--
-- `DeltaEntitySubscriber` is deleted in the same change, and unregistered from
-- `AuditModule`. `DeltaService` and `DeltaEntity` stay: they are the read path,
-- and nothing about them changes.

-- -----------------------------------------------------------------
-- 1. The audit log stops being a foreign key of its own subjects
-- -----------------------------------------------------------------
-- `graph_deltas.entity_id` and `.relationship_id` carried foreign keys with
-- ON DELETE SET NULL. Two consequences, both fatal to recording deletions:
--
--   * A 'deleted' delta could not be written AT ALL. By the time an
--     AFTER DELETE statement trigger runs the row is already gone, so the FK
--     check on the delta's own INSERT fails — and the `has_valid_reference`
--     CHECK forbids the obvious workaround of writing NULL, because
--     node_type = 'entity' requires entity_id IS NOT NULL.
--   * ON DELETE SET NULL was erasing the history that was already there:
--     deleting an entity blanked `entity_id` on every past delta about it. An
--     audit log that forgets what it audited the moment the subject disappears
--     is not an audit log.
--
-- The columns become exactly what the original table comment already calls
-- them — ids "denormalized for query efficiency when source is deleted".
-- `ci.graph_deltas` is append-only history, and history outlives its referents.
-- (`summary_id`, `changed_by_user_id` and `owner_user_id` keep their FKs: those
-- point at things that are not the subject of the record.)
ALTER TABLE ci.graph_deltas DROP CONSTRAINT IF EXISTS graph_deltas_entity_id_fkey;
ALTER TABLE ci.graph_deltas DROP CONSTRAINT IF EXISTS graph_deltas_relationship_id_fkey;

-- -----------------------------------------------------------------
-- 2. What a delta row has to look like, and who decided
-- -----------------------------------------------------------------
-- Not invented here — matched, column for column, to what the Python consumer
-- actually selects:
--
--   has_new_data                      WHERE owner_user_id = :user_id
--                                       AND changed_at >= :since
--
--   _get_graph_deltas                 delta_id, entity_id, relationship_id,
--                                     node_type, entity_type, relationship_type,
--                                     from_entity_id, to_entity_id, change_type,
--                                     changed_fields, change_reason, changed_at
--                                     WHERE owner_user_id = :user_id
--
--   _get_recently_changed_relationships
--                                     d.relationship_id, d.relationship_type,
--                                     d.change_type, d.changed_at, d.changed_fields
--                                     WHERE d.node_type = 'relationship'
--                                       AND d.owner_user_id = :user_id
--                                     LEFT JOIN ci.relationships on the
--                                     relationship_id, then DISTINCT ON it
--
-- Every one of those is scoped by `owner_user_id`, so a delta without one is
-- invisible to the consumer: the trigger copies the source row's owner and
-- never invents a value. `changed_by_user_id` stays NULL — a trigger sees a
-- database session, not an HTTP identity, and inventing an actor would be worse
-- than admitting there isn't one. `change_source` is 'db_trigger' on every row,
-- which is the honest provenance and distinguishes these from anything a future
-- service writes by hand. `_get_recently_changed_relationships` does
-- `DISTINCT ON (d.relationship_id)`, which is a second reason the deletion path
-- must keep the real id rather than NULL — a column of NULLs would collapse
-- every deleted relationship into a single row.
--
-- `change_type` is the five-value vocabulary the CHECK constraint pins and the
-- renderers uppercase into prose (summarizer.py:727, summary_functions.py:545):
--
--     created · updated · archived · deleted · merged
--
--   INSERT => created
--   DELETE => deleted
--   UPDATE => merged   when merged_into_entity_id goes NULL -> NOT NULL
--             archived when is_archived goes FALSE -> TRUE,
--                      or is_active goes TRUE -> FALSE
--             updated  otherwise
--
-- `changed_fields` is `{"field": {"old": …, "new": …}}` — the shape the column
-- comment documents and the shape both renderers destructure. Each of them
-- labels an entity delta with
--
--     changed_fields["name"]["new"] or changed_fields["name"]["old"] or "Unknown"
--
-- which is why an ENTITY delta always carries `name`, even when the name is not
-- what changed. Without that anchor, every edit to a description or a property
-- would reach the LLM as "UPDATED Person: Unknown". On such an update old and
-- new are equal — the entry is a label, not a claim that the name moved.
-- Relationship deltas need no anchor; their renderer prints relationship_type.
--
-- Only fields worth a delta are diffed (see the jsonb_build_object lists below).
-- `embedding`, `search_vector`, `search_content`, `outgoing_relationships`,
-- `updated_at` and `last_accessed` are deliberately excluded: the enrichment
-- pipeline rewrites those constantly, and one delta per embedding backfill would
-- bury the handful of changes a human would recognise. An UPDATE that touches
-- nothing tracked writes NO row at all — that filter is `d.fields IS NOT NULL`
-- at the bottom of the UPDATE branch, since `jsonb_object_agg` over zero rows
-- is NULL.

CREATE OR REPLACE FUNCTION ci.record_entity_graph_delta() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    -- One statement per branch, over the transition table. PL/pgSQL prepares a
    -- statement the first time that branch executes, so a branch naming a
    -- transition table its trigger did not declare is never parsed.
    IF TG_OP = 'INSERT' THEN
        INSERT INTO ci.graph_deltas (
            entity_id, node_type, entity_type, change_type, changed_fields,
            change_source, owner_user_id
        )
        SELECT
            n.entity_id,
            'entity',
            n.entity_type,
            'created',
            jsonb_build_object(
                'name',        jsonb_build_object('new', n.name),
                'description', jsonb_build_object('new', n.description),
                'entity_type', jsonb_build_object('new', n.entity_type),
                'properties',  jsonb_build_object('new', n.properties)
            ),
            'db_trigger',
            n.owner_user_id
        FROM inserted AS n;

    ELSIF TG_OP = 'UPDATE' THEN
        INSERT INTO ci.graph_deltas (
            entity_id, node_type, entity_type, change_type, changed_fields,
            change_source, owner_user_id
        )
        SELECT
            n.entity_id,
            'entity',
            n.entity_type,
            CASE
                WHEN o.merged_into_entity_id IS NULL
                 AND n.merged_into_entity_id IS NOT NULL                 THEN 'merged'
                WHEN (o.is_archived IS NOT TRUE AND n.is_archived IS TRUE)
                  OR (o.is_active IS NOT FALSE AND n.is_active IS FALSE) THEN 'archived'
                ELSE 'updated'
            END,
            -- The diff, plus the display anchor. The right-hand side of `||`
            -- wins, and when the name DID change the two agree — so this only
            -- ever adds a label to an update that left the name alone.
            d.fields || jsonb_build_object('name', jsonb_build_object('old', o.name, 'new', n.name)),
            'db_trigger',
            n.owner_user_id
        FROM new_rows AS n
        -- Paired on the primary key, which is the identity every other table in
        -- the schema references and which nothing updates. A statement that
        -- rewrote entity_id itself would leave its rows unpaired and unrecorded;
        -- there is no such statement, and there must not be one.
        JOIN old_rows AS o USING (entity_id)
        CROSS JOIN LATERAL (
            SELECT
                jsonb_build_object(
                    'entity_type',           o.entity_type,
                    'name',                  o.name,
                    'description',           o.description,
                    'properties',            o.properties,
                    'is_active',             o.is_active,
                    'is_archived',           o.is_archived,
                    'merged_into_entity_id', o.merged_into_entity_id
                ) AS before,
                jsonb_build_object(
                    'entity_type',           n.entity_type,
                    'name',                  n.name,
                    'description',           n.description,
                    'properties',            n.properties,
                    'is_active',             n.is_active,
                    'is_archived',           n.is_archived,
                    'merged_into_entity_id', n.merged_into_entity_id
                ) AS after
        ) AS s
        CROSS JOIN LATERAL (
            SELECT jsonb_object_agg(
                       k.key,
                       jsonb_build_object('old', s.before -> k.key, 'new', s.after -> k.key)
                   ) AS fields
            FROM jsonb_object_keys(s.after) AS k(key)
            WHERE s.before -> k.key IS DISTINCT FROM s.after -> k.key
        ) AS d
        WHERE d.fields IS NOT NULL;

    ELSE -- DELETE
        INSERT INTO ci.graph_deltas (
            entity_id, node_type, entity_type, change_type, changed_fields,
            change_source, owner_user_id
        )
        SELECT
            o.entity_id,
            'entity',
            o.entity_type,
            'deleted',
            jsonb_build_object(
                'name',        jsonb_build_object('old', o.name),
                'description', jsonb_build_object('old', o.description),
                'entity_type', jsonb_build_object('old', o.entity_type),
                'properties',  jsonb_build_object('old', o.properties)
            ),
            'db_trigger',
            o.owner_user_id
        FROM deleted AS o;
    END IF;

    RETURN NULL; -- AFTER STATEMENT: the return value is ignored
END;
$$;

COMMENT ON FUNCTION ci.record_entity_graph_delta() IS
    'Records ci.entities changes into ci.graph_deltas, one INSERT ... SELECT per '
    'statement over the transition table. Replaces DeltaEntitySubscriber, which '
    'hooked TypeORM and so never saw the bulk query-builder writes that create '
    'essentially every entity. See 20260809182943_graph_delta_triggers.sql.';

CREATE OR REPLACE FUNCTION ci.record_relationship_graph_delta() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO ci.graph_deltas (
            relationship_id, node_type, relationship_type, from_entity_id, to_entity_id,
            change_type, changed_fields, change_source, owner_user_id
        )
        SELECT
            n.relationship_id,
            'relationship',
            n.relationship_type,
            n.from_entity_id,
            n.to_entity_id,
            'created',
            jsonb_build_object(
                'relationship_type', jsonb_build_object('new', n.relationship_type),
                'from_entity_id',    jsonb_build_object('new', n.from_entity_id),
                'to_entity_id',      jsonb_build_object('new', n.to_entity_id),
                'strength',          jsonb_build_object('new', n.strength),
                'is_bidirectional',  jsonb_build_object('new', n.is_bidirectional),
                'properties',        jsonb_build_object('new', n.properties)
            ),
            'db_trigger',
            n.owner_user_id
        FROM inserted AS n;

    ELSIF TG_OP = 'UPDATE' THEN
        INSERT INTO ci.graph_deltas (
            relationship_id, node_type, relationship_type, from_entity_id, to_entity_id,
            change_type, changed_fields, change_source, owner_user_id
        )
        SELECT
            n.relationship_id,
            'relationship',
            n.relationship_type,
            n.from_entity_id,
            n.to_entity_id,
            CASE
                WHEN o.is_active IS NOT FALSE AND n.is_active IS FALSE THEN 'archived'
                ELSE 'updated'
            END,
            d.fields,
            'db_trigger',
            n.owner_user_id
        FROM new_rows AS n
        JOIN old_rows AS o USING (relationship_id)
        CROSS JOIN LATERAL (
            SELECT
                jsonb_build_object(
                    'relationship_type', o.relationship_type,
                    'from_entity_id',    o.from_entity_id,
                    'to_entity_id',      o.to_entity_id,
                    'strength',          o.strength,
                    'is_bidirectional',  o.is_bidirectional,
                    'properties',        o.properties,
                    'is_active',         o.is_active,
                    'start_date',        o.start_date,
                    'end_date',          o.end_date
                ) AS before,
                jsonb_build_object(
                    'relationship_type', n.relationship_type,
                    'from_entity_id',    n.from_entity_id,
                    'to_entity_id',      n.to_entity_id,
                    'strength',          n.strength,
                    'is_bidirectional',  n.is_bidirectional,
                    'properties',        n.properties,
                    'is_active',         n.is_active,
                    'start_date',        n.start_date,
                    'end_date',          n.end_date
                ) AS after
        ) AS s
        CROSS JOIN LATERAL (
            SELECT jsonb_object_agg(
                       k.key,
                       jsonb_build_object('old', s.before -> k.key, 'new', s.after -> k.key)
                   ) AS fields
            FROM jsonb_object_keys(s.after) AS k(key)
            WHERE s.before -> k.key IS DISTINCT FROM s.after -> k.key
        ) AS d
        WHERE d.fields IS NOT NULL;

    ELSE -- DELETE
        INSERT INTO ci.graph_deltas (
            relationship_id, node_type, relationship_type, from_entity_id, to_entity_id,
            change_type, changed_fields, change_source, owner_user_id
        )
        SELECT
            o.relationship_id,
            'relationship',
            o.relationship_type,
            o.from_entity_id,
            o.to_entity_id,
            'deleted',
            jsonb_build_object(
                'relationship_type', jsonb_build_object('old', o.relationship_type),
                'from_entity_id',    jsonb_build_object('old', o.from_entity_id),
                'to_entity_id',      jsonb_build_object('old', o.to_entity_id),
                'strength',          jsonb_build_object('old', o.strength),
                'is_bidirectional',  jsonb_build_object('old', o.is_bidirectional),
                'properties',        jsonb_build_object('old', o.properties)
            ),
            'db_trigger',
            o.owner_user_id
        FROM deleted AS o;
    END IF;

    RETURN NULL;
END;
$$;

COMMENT ON FUNCTION ci.record_relationship_graph_delta() IS
    'Records ci.relationships changes into ci.graph_deltas, set-based, one '
    'INSERT ... SELECT per statement. Note that ci.relationships has had no '
    'foreign keys to ci.entities since 20260127185821, so deleting an entity '
    'does NOT delete its edges and produces no relationship delta — every '
    'relationship delta comes from a statement against ci.relationships itself. '
    'See 20260809182943_graph_delta_triggers.sql.';

-- -----------------------------------------------------------------
-- 3. The triggers
-- -----------------------------------------------------------------
-- Six: three operations on each table. INSERT and DELETE need one transition
-- table, UPDATE needs both — an UPDATE trigger declaring only NEW TABLE could
-- not tell a real change from a rewrite of identical values, which is the
-- difference between an audit log and a firehose.
--
-- Deliberately NOT `FOR EACH ROW`: the ingest path writes in chunks of
-- hundreds, and the entire reason this is a trigger is that it must not cost
-- the bulk path its shape.

DROP TRIGGER IF EXISTS entities_graph_delta_insert ON ci.entities;
CREATE TRIGGER entities_graph_delta_insert
    AFTER INSERT ON ci.entities
    REFERENCING NEW TABLE AS inserted
    FOR EACH STATEMENT EXECUTE FUNCTION ci.record_entity_graph_delta();

DROP TRIGGER IF EXISTS entities_graph_delta_update ON ci.entities;
CREATE TRIGGER entities_graph_delta_update
    AFTER UPDATE ON ci.entities
    REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
    FOR EACH STATEMENT EXECUTE FUNCTION ci.record_entity_graph_delta();

DROP TRIGGER IF EXISTS entities_graph_delta_delete ON ci.entities;
CREATE TRIGGER entities_graph_delta_delete
    AFTER DELETE ON ci.entities
    REFERENCING OLD TABLE AS deleted
    FOR EACH STATEMENT EXECUTE FUNCTION ci.record_entity_graph_delta();

DROP TRIGGER IF EXISTS relationships_graph_delta_insert ON ci.relationships;
CREATE TRIGGER relationships_graph_delta_insert
    AFTER INSERT ON ci.relationships
    REFERENCING NEW TABLE AS inserted
    FOR EACH STATEMENT EXECUTE FUNCTION ci.record_relationship_graph_delta();

DROP TRIGGER IF EXISTS relationships_graph_delta_update ON ci.relationships;
CREATE TRIGGER relationships_graph_delta_update
    AFTER UPDATE ON ci.relationships
    REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
    FOR EACH STATEMENT EXECUTE FUNCTION ci.record_relationship_graph_delta();

DROP TRIGGER IF EXISTS relationships_graph_delta_delete ON ci.relationships;
CREATE TRIGGER relationships_graph_delta_delete
    AFTER DELETE ON ci.relationships
    REFERENCING OLD TABLE AS deleted
    FOR EACH STATEMENT EXECUTE FUNCTION ci.record_relationship_graph_delta();

-- migrate:down
DROP TRIGGER IF EXISTS relationships_graph_delta_delete ON ci.relationships;
DROP TRIGGER IF EXISTS relationships_graph_delta_update ON ci.relationships;
DROP TRIGGER IF EXISTS relationships_graph_delta_insert ON ci.relationships;
DROP TRIGGER IF EXISTS entities_graph_delta_delete ON ci.entities;
DROP TRIGGER IF EXISTS entities_graph_delta_update ON ci.entities;
DROP TRIGGER IF EXISTS entities_graph_delta_insert ON ci.entities;

DROP FUNCTION IF EXISTS ci.record_relationship_graph_delta();
DROP FUNCTION IF EXISTS ci.record_entity_graph_delta();

-- Restoring the foreign keys means the audit log can no longer outlive its
-- subjects, so the rows that outlived theirs have to go first — they are exactly
-- the rows the constraint would refuse. (NULLing the columns instead is not
-- available: `has_valid_reference` requires the id to be present.)
DELETE FROM ci.graph_deltas AS d
 WHERE d.entity_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM ci.entities AS e WHERE e.entity_id = d.entity_id);

DELETE FROM ci.graph_deltas AS d
 WHERE d.relationship_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM ci.relationships AS r WHERE r.relationship_id = d.relationship_id);

ALTER TABLE ci.graph_deltas
    ADD CONSTRAINT graph_deltas_entity_id_fkey
    FOREIGN KEY (entity_id) REFERENCES ci.entities(entity_id) ON DELETE SET NULL;

ALTER TABLE ci.graph_deltas
    ADD CONSTRAINT graph_deltas_relationship_id_fkey
    FOREIGN KEY (relationship_id) REFERENCES ci.relationships(relationship_id) ON DELETE SET NULL;
