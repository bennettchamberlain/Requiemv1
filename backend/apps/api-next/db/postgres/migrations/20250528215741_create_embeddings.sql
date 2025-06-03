-- migrate:up
CREATE TABLE embeddings (
    id UUID PRIMARY KEY,

    model TEXT,
    raw_input TEXT,
    embedding_vector VECTOR (768),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- migrate:down
DROP TABLE embeddings;
