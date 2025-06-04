-- migrate:up
CREATE TABLE files (
    id UUID PRIMARY KEY,

    bucket TEXT,
    key UUID,

    original_name TEXT,
    content_type TEXT,
    size BIGINT,

    user_id UUID REFERENCES users(id),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- migrate:down
DROP TABLE files;
