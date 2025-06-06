-- migrate:up
CREATE EXTENSION vector;

-- migrate:down
DROP EXTENSION vector;
