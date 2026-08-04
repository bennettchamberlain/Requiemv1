-- migrate:up
-- Timestamp for when the user finished FTUE. Used to defer actions-system
-- initialization until ~24h after setup (once sync has had time to land data).
ALTER TABLE ci.users
  ADD COLUMN IF NOT EXISTS onboarded_at TIMESTAMPTZ;

-- Existing onboarded users: treat completion as their last update so the
-- deferred initializer can decide eligibility from a real timestamp.
UPDATE ci.users
SET onboarded_at = COALESCE(updated_at, created_at)
WHERE onboarded = TRUE
  AND onboarded_at IS NULL;

CREATE INDEX IF NOT EXISTS users_onboarded_at_idx
  ON ci.users (onboarded_at)
  WHERE onboarded = TRUE AND onboarded_at IS NOT NULL;

-- migrate:down
DROP INDEX IF EXISTS ci.users_onboarded_at_idx;

ALTER TABLE ci.users
  DROP COLUMN IF EXISTS onboarded_at;
