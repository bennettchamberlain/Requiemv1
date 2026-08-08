-- migrate:up
-- Move writer-less / rarely-used analytics columns off the hot events table.
CREATE TABLE ci.event_analytics (
  event_id UUID PRIMARY KEY REFERENCES ci.events(event_id) ON DELETE CASCADE,
  salience DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  access_count INTEGER NOT NULL DEFAULT 0,
  prediction_model TEXT,
  productivity_impact DOUBLE PRECISION,
  related_event_ids UUID[],
  supersedes_event_id UUID,
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO ci.event_analytics (
  event_id, salience, access_count, prediction_model, productivity_impact,
  related_event_ids, supersedes_event_id, last_synced_at
)
SELECT
  event_id, salience, access_count, prediction_model, productivity_impact,
  related_event_ids, supersedes_event_id, last_synced_at
FROM ci.events;

ALTER TABLE ci.events
  DROP COLUMN IF EXISTS salience,
  DROP COLUMN IF EXISTS access_count,
  DROP COLUMN IF EXISTS prediction_model,
  DROP COLUMN IF EXISTS productivity_impact,
  DROP COLUMN IF EXISTS related_event_ids,
  DROP COLUMN IF EXISTS supersedes_event_id,
  DROP COLUMN IF EXISTS last_synced_at;

-- migrate:down
ALTER TABLE ci.events
  ADD COLUMN IF NOT EXISTS salience DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS access_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS prediction_model TEXT,
  ADD COLUMN IF NOT EXISTS productivity_impact DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS related_event_ids UUID[],
  ADD COLUMN IF NOT EXISTS supersedes_event_id UUID,
  ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ;

UPDATE ci.events e SET
  salience = a.salience,
  access_count = a.access_count,
  prediction_model = a.prediction_model,
  productivity_impact = a.productivity_impact,
  related_event_ids = a.related_event_ids,
  supersedes_event_id = a.supersedes_event_id,
  last_synced_at = a.last_synced_at
FROM ci.event_analytics a
WHERE e.event_id = a.event_id;

DROP TABLE IF EXISTS ci.event_analytics;
