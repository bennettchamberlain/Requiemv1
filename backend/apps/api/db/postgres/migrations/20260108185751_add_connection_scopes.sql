-- migrate:up
ALTER TABLE ci.connections ADD COLUMN scopes JSONB DEFAULT '[]'::jsonb;

-- migrate:down
ALTER TABLE ci.connections DROP COLUMN scopes;
