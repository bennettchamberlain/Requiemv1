-- migrate:up
-- Trust-dial confirmation for auto-proposed calendar placements.

DO $$
DECLARE
    constraint_name text;
BEGIN
    SELECT con.conname INTO constraint_name
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'ci'
      AND rel.relname = 'task_pending_changes'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%mutate%complete%event_revise%';

    IF constraint_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE ci.task_pending_changes DROP CONSTRAINT %I', constraint_name);
    END IF;
END $$;

ALTER TABLE ci.task_pending_changes
    ADD CONSTRAINT task_pending_changes_kind_check
        CHECK (kind IN ('mutate', 'complete', 'event_revise', 'schedule'));

-- migrate:down

ALTER TABLE ci.task_pending_changes
    DROP CONSTRAINT IF EXISTS task_pending_changes_kind_check;

UPDATE ci.task_pending_changes SET status = 'declined', resolved_at = NOW()
    WHERE kind = 'schedule' AND status = 'pending';

ALTER TABLE ci.task_pending_changes
    ADD CONSTRAINT task_pending_changes_kind_check
        CHECK (kind IN ('mutate', 'complete', 'event_revise'));
