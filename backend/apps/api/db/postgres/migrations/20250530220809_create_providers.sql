-- migrate:up
CREATE TABLE providers (
    id UUID PRIMARY KEY,

    coming_soon BOOLEAN,
    enabled BOOLEAN,
    login BOOLEAN,
    name TEXT,
    oauth_app UUID,
    remote_map_id UUID,
    sources JSONB,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE connections (
    id UUID PRIMARY KEY,

    auth_status TEXT,
    redirect_url TEXT,
    enabled BOOLEAN,

    name TEXT,
    oauth_app_name TEXT,
    permissions JSONB,

    user_id UUID REFERENCES users(id),
    provider_id UUID REFERENCES providers(id),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- migrate:down
DROP TABLE providers;
DROP TABLE connections;
