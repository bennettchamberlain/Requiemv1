-- migrate:up
-- =================================================================
-- DIGITAL FOOTPRINT TABLES - BROWSER AND SCREEN ACTIVITY
-- =================================================================

CREATE TABLE browser_activity (
    time TIMESTAMPTZ NOT NULL,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_id UUID NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,

    -- URL and page data
    url TEXT NOT NULL,
    domain TEXT GENERATED ALWAYS AS (
        CASE
            WHEN url ~ '^https?://' THEN split_part(split_part(url, '://', 2), '/', 1)
            ELSE NULL
        END
    ) STORED,
    title TEXT,

    -- Interaction data
    action_type TEXT, -- NOT NULL CHECK (action_type IN ('visit', 'reload', 'bookmark', 'search', 'download', 'form_submit')),
    duration_seconds INTEGER CHECK (duration_seconds >= 0),
    scroll_depth_percent DOUBLE PRECISION CHECK (scroll_depth_percent >= 0 AND scroll_depth_percent <= 100),

    -- AI-generated insights
    page_summary TEXT,
    page_embedding vector(768),
    category TEXT,
    productivity_score DOUBLE PRECISION CHECK (productivity_score >= 0 AND productivity_score <= 1),

    -- Privacy
    is_incognito BOOLEAN DEFAULT FALSE,
    contains_sensitive BOOLEAN DEFAULT FALSE,

    PRIMARY KEY (time, user_id, device_id)
);

SELECT create_hypertable('browser_activity', 'time', 'user_id', 4);


CREATE TABLE screen_captures (
    time TIMESTAMPTZ NOT NULL,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_id UUID NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,

    -- Image storage
    image_path TEXT NOT NULL,
    thumbnail_path TEXT,

    -- AI analysis results
    ocr_text TEXT,
    ui_elements JSONB DEFAULT '{}',
    applications JSONB DEFAULT '{}',
    activity_summary TEXT,

    -- Embeddings for similarity search
    visual_embedding vector(768),
    text_embedding vector(768),

    -- Classification
    primary_application TEXT,
    activity_category TEXT,

    -- Privacy and security
    contains_sensitive BOOLEAN DEFAULT FALSE,
    contains_pii BOOLEAN DEFAULT FALSE,
    redacted BOOLEAN DEFAULT FALSE,
    redaction_regions JSONB DEFAULT '[]',

    PRIMARY KEY (time, user_id, device_id)
);

SELECT create_hypertable('screen_captures', 'time', 'user_id', 4);

-- migrate:down
DROP TABLE IF EXISTS screen_captures;
DROP TABLE IF EXISTS browser_activity;
