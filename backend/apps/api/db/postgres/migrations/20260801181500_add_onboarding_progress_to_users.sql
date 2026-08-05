-- migrate:up
-- Resumable FTUE wizard state: stable stepKey + partial form draft, cleared on onboard.
-- Owned by the onboarding domain; nullable until the user starts onboarding.
ALTER TABLE ci.users
  ADD COLUMN IF NOT EXISTS onboarding_progress JSONB;

-- migrate:down
ALTER TABLE ci.users
  DROP COLUMN IF EXISTS onboarding_progress;
