-- migrate:up
ALTER TABLE actions
  ADD COLUMN priority INT;

-- migrate:down
ALTER TABLE actions
  DROP COLUMN priority;
