-- migrate:up
CREATE TABLE tags (
    id UUID PRIMARY KEY,
    label TEXT,
    user_id UUID REFERENCES users (id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE tags
ADD CONSTRAINT tags_label_user_id_unique UNIQUE (label, user_id);

-- migrate:down
DROP TABLE tags;
