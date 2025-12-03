-- migrate:up
CREATE TABLE users (
    id UUID PRIMARY KEY,

    name TEXT,
    email TEXT UNIQUE,
    password TEXT,
    some_field TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- migrate:down
DROP TABLE users;
