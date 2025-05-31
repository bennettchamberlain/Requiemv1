-- migrate:up
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY,

    name TEXT,
    email TEXT UNIQUE,
    password TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- migrate:down
DROP TABLE users;
