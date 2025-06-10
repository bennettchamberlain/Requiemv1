-- migrate:up
CREATE TABLE tags (
    id UUID PRIMARY KEY,

    label TEXT,

    user_id UUID REFERENCES users(id),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- migrate:down
DROP TABLE tags;
