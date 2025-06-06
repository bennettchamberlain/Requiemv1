-- migrate:up
CREATE TABLE sessions (
    id UUID PRIMARY KEY,

    token TEXT,
    ip TEXT,
    user_agent TEXT,
    expires_at TIMESTAMPTZ NOT NULL,

    user_id UUID REFERENCES users(id),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sessions_user_ip_agent ON sessions(user_id, ip, user_agent);
CREATE INDEX idx_expires_at ON sessions(expires_at);

-- migrate:down
DROP TABLE sessions;
