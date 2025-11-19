-- migrate:up
CREATE SCHEMA IF NOT EXISTS ci_core;

-- migrate:down
DROP SCHEMA IF EXISTS ci_core CASCADE;
