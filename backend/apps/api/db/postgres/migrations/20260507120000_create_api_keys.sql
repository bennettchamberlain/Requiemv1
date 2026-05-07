-- migrate:up
CREATE TABLE ci.api_keys (
    id UUID PRIMARY KEY,
    name TEXT NOT NULL,
    prefix TEXT NOT NULL,
    hashed_key TEXT NOT NULL,
    scopes TEXT[] NOT NULL DEFAULT '{}',
    expires_at TIMESTAMPTZ,
    last_used_at TIMESTAMPTZ,
    user_id UUID NOT NULL REFERENCES ci.users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_api_keys_user_id ON ci.api_keys(user_id);
CREATE INDEX idx_api_keys_prefix ON ci.api_keys(prefix);

-- migrate:down
DROP TABLE IF EXISTS ci.api_keys;
