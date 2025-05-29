-- migrate:up
CREATE TABLE IF NOT EXISTS users (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    external_id UUID,
    name TEXT,
    email TEXT UNIQUE,
    password TEXT
);

CREATE INDEX IF NOT EXISTS idx_users_external_id ON users (external_id);

-- migrate:down
DROP INDEX IF EXISTS idx_users_external_id;
DROP TABLE users;
