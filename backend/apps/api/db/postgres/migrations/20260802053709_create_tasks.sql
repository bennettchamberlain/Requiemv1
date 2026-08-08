-- migrate:up

-- Planning tasks. See docs/architecture/planning-roadmap.md.
--
-- Deliberately NOT folded into ci.actions: an action is a feed card with a hero
-- image and a chat thread, with no status, no time and no hierarchy. It is also
-- ordered by `priority ASC` for the feed, so reusing it would return the backlog
-- into the feed. ci.actions.task_id (added below) bridges the two instead.
CREATE TABLE ci.tasks (
    id                UUID        PRIMARY KEY DEFAULT gen_uuid_v7(),
    user_id           UUID        NOT NULL REFERENCES ci.users (id) ON DELETE CASCADE,

    title             TEXT        NOT NULL,
    description       TEXT        NULL,
    notes             TEXT        NULL,

    status            TEXT        NOT NULL DEFAULT 'open',
    priority          INTEGER     NOT NULL DEFAULT 3,

    -- Subtask hierarchy. Deleting a parent takes its children.
    parent_id         UUID        NULL REFERENCES ci.tasks (id) ON DELETE CASCADE,

    -- `due_at` is an instant (a deadline). `scheduled_for` / `defer_until` are
    -- owner-LOCAL calendar dates and `task_time` is a zoneless wall-clock time:
    -- they are inputs to PlanningTimeService, never outputs of it. Converting
    -- them to an instant always goes through zonedWallTimeToUTC with the user's
    -- ci.users.timezone.
    due_at            TIMESTAMPTZ NULL,
    task_time         TIME        NULL,
    scheduled_for     DATE        NULL,
    defer_until       DATE        NULL,
    defer_count       INTEGER     NOT NULL DEFAULT 0,

    estimated_minutes INTEGER     NULL,
    actual_minutes    INTEGER     NOT NULL DEFAULT 0,
    completed_at      TIMESTAMPTZ NULL,

    -- Provenance for ingested tasks (email, calendar, a routine).
    source_kind       TEXT        NOT NULL DEFAULT 'manual',
    source_ref        TEXT        NULL,

    metadata          JSONB       NOT NULL DEFAULT '{}',

    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT tasks_status_check
        CHECK (status IN ('open', 'in_progress', 'done', 'skipped', 'archived')),
    CONSTRAINT tasks_priority_check
        CHECK (priority BETWEEN 0 AND 5),
    CONSTRAINT tasks_estimated_minutes_check
        CHECK (estimated_minutes IS NULL OR estimated_minutes > 0),
    CONSTRAINT tasks_no_self_parent
        CHECK (parent_id IS NULL OR parent_id <> id)
);

-- The list read: a user's open work, soonest deadline first.
CREATE INDEX idx_tasks_user_status ON ci.tasks (user_id, status, due_at);

-- Subtask lookup.
CREATE INDEX idx_tasks_parent ON ci.tasks (parent_id) WHERE parent_id IS NOT NULL;

-- Day view: everything a user has pencilled in for a date.
CREATE INDEX idx_tasks_user_scheduled ON ci.tasks (user_id, scheduled_for)
    WHERE scheduled_for IS NOT NULL;

-- Ingestion idempotency. User-scoped on purpose: two users can legitimately
-- ingest the same upstream source_ref (a shared calendar invite, a builtin
-- routine) without colliding. Contrast ci.events' events_source_triple_uniq,
-- which is global and would collide across tenants.
CREATE UNIQUE INDEX ux_tasks_source ON ci.tasks (user_id, source_kind, source_ref)
    WHERE source_ref IS NOT NULL;

-- Task -> task ordering constraints ("do X before Y").
--
-- Not modelled as ci.relationships rows: tasks are not ci.entities, so
-- from_entity_id / to_entity_id would be dangling non-FK uuids (relationships'
-- FKs to entities were removed in 20260127185821).
CREATE TABLE ci.task_dependencies (
    task_id       UUID        NOT NULL REFERENCES ci.tasks (id) ON DELETE CASCADE,
    depends_on_id UUID        NOT NULL REFERENCES ci.tasks (id) ON DELETE CASCADE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (task_id, depends_on_id),
    CONSTRAINT task_dependencies_no_self_edge CHECK (task_id <> depends_on_id)
);

-- Reverse lookup: "what is blocked by this task?"
CREATE INDEX idx_task_dependencies_depends_on ON ci.task_dependencies (depends_on_id);

-- Lets a feed card point at the task it is nudging toward. One nullable column;
-- no existing ci.actions reader is affected.
ALTER TABLE ci.actions
    ADD COLUMN IF NOT EXISTS task_id UUID NULL REFERENCES ci.tasks (id) ON DELETE SET NULL;

-- migrate:down

ALTER TABLE ci.actions DROP COLUMN IF EXISTS task_id;
DROP TABLE IF EXISTS ci.task_dependencies;
DROP TABLE IF EXISTS ci.tasks;
