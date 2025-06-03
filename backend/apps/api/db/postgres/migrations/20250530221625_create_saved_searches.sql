-- migrate:up
CREATE TABLE saved_searches (
    id UUID PRIMARY KEY,

    count integer,
    favorited BOOLEAN,
    filters_data JSONB,
    filters_name TEXT,
    filters_type TEXT,
    hash TEXT,
    icon_color TEXT,
    last_run TIMESTAMPTZ,
    name TEXT,
    query TEXT,

    user_id UUID REFERENCES users(id),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- migrate:down
DROP TABLE IF EXISTS saved_searchs;
