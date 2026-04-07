-- migrate:up
ALTER TABLE ci.providers ADD COLUMN auth_type TEXT;

-- migrate:down
ALTER TABLE ci.providers DROP COLUMN auth_type;

