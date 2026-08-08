-- migrate:up
-- Restore FK lost when replace_events_table CASCADE-dropped the old events table.
UPDATE ci.content
SET event_id = NULL
WHERE event_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM ci.events e WHERE e.event_id = content.event_id
  );

ALTER TABLE ci.content
  ADD CONSTRAINT content_event_id_fkey
  FOREIGN KEY (event_id) REFERENCES ci.events(event_id)
  ON DELETE SET NULL;

-- migrate:down
ALTER TABLE ci.content DROP CONSTRAINT IF EXISTS content_event_id_fkey;
