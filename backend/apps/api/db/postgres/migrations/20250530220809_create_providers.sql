-- migrate:up
CREATE TABLE providers (
    id UUID PRIMARY KEY,

    name TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE connections (
    id UUID PRIMARY KEY,

    name TEXT,

    user_id UUID REFERENCES users(id),
    provider_id UUID REFERENCES providers(id),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- migrate:down
DROP TABLE providers;
DROP TABLE connections;
