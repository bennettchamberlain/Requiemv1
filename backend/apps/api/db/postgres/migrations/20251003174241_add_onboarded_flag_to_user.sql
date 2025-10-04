-- migrate:up
ALTER TABLE users
ADD COLUMN onboarded BOOLEAN DEFAULT FALSE;

-- migrate:down
ALTER TABLE users
DROP COLUMN onboarded;
