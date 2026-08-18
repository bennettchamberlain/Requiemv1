-- migrate:up
-- Planning automation: proposed todos (trust-dial review inbox), pending
-- mutate/complete confirmations, and planned-block columns on ci.events.

ALTER TABLE ci.tasks
    DROP CONSTRAINT IF EXISTS tasks_status_check;

ALTER TABLE ci.tasks
    ADD CONSTRAINT tasks_status_check
        CHECK (status IN ('proposed', 'open', 'in_progress', 'done', 'skipped', 'archived'));

CREATE TABLE ci.task_pending_changes (
    id            UUID PRIMARY KEY,
    user_id       UUID        NOT NULL REFERENCES ci.users (id) ON DELETE CASCADE,
    task_id       UUID        NOT NULL REFERENCES ci.tasks (id) ON DELETE CASCADE,
    kind          TEXT        NOT NULL
                              CHECK (kind IN ('mutate', 'complete', 'event_revise')),
    patch         JSONB       NOT NULL DEFAULT '{}',
    rationale     TEXT,
    confidence    REAL        CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
    status        TEXT        NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending', 'accepted', 'declined')),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at   TIMESTAMPTZ
);

CREATE INDEX idx_task_pending_changes_user_pending
    ON ci.task_pending_changes (user_id, created_at DESC)
    WHERE status = 'pending';

CREATE INDEX idx_task_pending_changes_task
    ON ci.task_pending_changes (task_id)
    WHERE status = 'pending';

-- Planned blocks live on ci.events (event_type = 'planned_block'). Link to the
-- task they schedule, and keep intent minutes separate from generated duration.
ALTER TABLE ci.events
    ADD COLUMN IF NOT EXISTS task_id UUID NULL REFERENCES ci.tasks (id) ON DELETE SET NULL;

ALTER TABLE ci.events
    ADD COLUMN IF NOT EXISTS planned_minutes INTEGER NULL
        CHECK (planned_minutes IS NULL OR planned_minutes > 0);

CREATE INDEX IF NOT EXISTS idx_events_user_task
    ON ci.events (user_id, task_id)
    WHERE task_id IS NOT NULL;

-- Widen event status for planned-block lifecycle (roadmap M3).
DO $$
DECLARE
    constraint_name text;
BEGIN
    SELECT con.conname INTO constraint_name
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'ci'
      AND rel.relname = 'events'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%tentative%confirmed%cancelled%';

    IF constraint_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE ci.events DROP CONSTRAINT %I', constraint_name);
    END IF;
END $$;

ALTER TABLE ci.events
    ADD CONSTRAINT events_status_check
        CHECK (status IN (
            'tentative', 'confirmed', 'cancelled', 'completed', 'no_show', 'rescheduled',
            'planned', 'in_progress', 'skipped'
        ));

-- migrate:down

ALTER TABLE ci.events DROP CONSTRAINT IF EXISTS events_status_check;

ALTER TABLE ci.events
    ADD CONSTRAINT events_status_check
        CHECK (status IN (
            'tentative', 'confirmed', 'cancelled', 'completed', 'no_show', 'rescheduled'
        ));

DROP INDEX IF EXISTS ci.idx_events_user_task;
ALTER TABLE ci.events DROP COLUMN IF EXISTS planned_minutes;
ALTER TABLE ci.events DROP COLUMN IF EXISTS task_id;

DROP TABLE IF EXISTS ci.task_pending_changes;

ALTER TABLE ci.tasks
    DROP CONSTRAINT IF EXISTS tasks_status_check;

-- Reject rows that used the widened vocabulary before restoring the old check.
UPDATE ci.tasks SET status = 'open' WHERE status = 'proposed';

ALTER TABLE ci.tasks
    ADD CONSTRAINT tasks_status_check
        CHECK (status IN ('open', 'in_progress', 'done', 'skipped', 'archived'));
