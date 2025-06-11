-- migrate:up
CREATE TABLE embeddings (
    id UUID PRIMARY KEY,

    model TEXT,
    raw_input TEXT,
    raw_input_hash TEXT,
    entity_type TEXT,
    data_path TEXT,
    entity_id UUID,
    embedding_vector VECTOR (768),

    user_id UUID REFERENCES users(id),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_model_hash ON embeddings (model, raw_input_hash);
CREATE INDEX idx_entity_type_data_path_entity_id ON embeddings (entity_type, data_path, entity_id);

-- migrate:down
DROP TABLE embeddings;
