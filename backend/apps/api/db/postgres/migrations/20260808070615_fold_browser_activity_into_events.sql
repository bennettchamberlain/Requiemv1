-- migrate:up
-- Fold historical browser_activity into the timeline (ci.events + ci.content).
-- The browser_activity table remains for dual-read until a later drop wave.

COMMENT ON TABLE ci.browser_activity IS
  'deprecated: folded into ci.events+ci.content; dual-read until drop';

-- (1) Timeline events: one 'view' per browser_activity row. Provenance mirrors
-- the activity triple when present; otherwise a synthetic fold key keyed on
-- browser_activity.id keeps the insert idempotent.
INSERT INTO ci.events (
  event_id,
  user_id,
  title,
  description,
  event_type,
  category,
  start_time,
  end_time,
  source_type,
  source_system,
  source_id,
  metadata
)
SELECT
  ci.gen_uuid_v7(),
  ba.user_id,
  COALESCE(NULLIF(btrim(ba.title), ''), ba.url, 'Browser activity'),
  ba.page_summary,
  'view',
  ba.category,
  ba.time,
  CASE
    WHEN ba.duration_seconds IS NOT NULL AND ba.duration_seconds > 0
      THEN ba.time + make_interval(secs => ba.duration_seconds)
    ELSE NULL
  END,
  COALESCE(ba.source_type, 'browser_activity'),
  COALESCE(ba.source_system, 'fold'),
  COALESCE(ba.source_id, ba.id::text),
  jsonb_strip_nulls(
    jsonb_build_object(
      'browser_activity_id', ba.id,
      'url', ba.url,
      'action_type', ba.action_type,
      'duration_seconds', ba.duration_seconds,
      'scroll_depth_percent', ba.scroll_depth_percent,
      'category', ba.category,
      'productivity_score', ba.productivity_score,
      'is_incognito', ba.is_incognito,
      'contains_sensitive', ba.contains_sensitive,
      'device_id', ba.device_id,
      'properties', COALESCE(ba.properties, '{}'::jsonb)
    )
  )
FROM ci.browser_activity ba
ON CONFLICT (user_id, source_type, source_system, source_id)
  WHERE source_id IS NOT NULL
  DO NOTHING;

-- (2) web-page content linked to the matching event (same provenance triple).
INSERT INTO ci.content (
  id,
  type,
  title,
  text,
  url,
  source_url,
  source_data,
  user_id,
  event_id,
  source_type,
  source_system,
  source_id
)
SELECT
  ci.gen_uuid_v7(),
  'web-page',
  COALESCE(NULLIF(btrim(ba.title), ''), ba.url),
  ba.page_summary,
  ba.url,
  ba.url,
  jsonb_build_object('browser_activity_id', ba.id),
  ba.user_id,
  e.event_id,
  COALESCE(ba.source_type, 'browser_activity'),
  COALESCE(ba.source_system, 'fold'),
  COALESCE(ba.source_id, ba.id::text)
FROM ci.browser_activity ba
JOIN ci.events e
  ON e.user_id = ba.user_id
 AND e.source_type = COALESCE(ba.source_type, 'browser_activity')
 AND e.source_system = COALESCE(ba.source_system, 'fold')
 AND e.source_id = COALESCE(ba.source_id, ba.id::text)
ON CONFLICT (user_id, source_type, source_system, source_id)
  WHERE source_id IS NOT NULL
  DO NOTHING;

-- migrate:down
DELETE FROM ci.content
WHERE type = 'web-page'
  AND source_data ? 'browser_activity_id';

DELETE FROM ci.events
WHERE event_type = 'view'
  AND metadata ? 'browser_activity_id';

COMMENT ON TABLE ci.browser_activity IS NULL;
