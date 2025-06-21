-- migrate:up
CREATE TABLE threads (
    id UUID PRIMARY KEY,

    name TEXT,
    model TEXT,
    description TEXT,

    user_id UUID REFERENCES users(id),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE TABLE messages (
    id UUID PRIMARY KEY,

    model TEXT,
    text TEXT,
    mimetype TEXT, -- Piggybacking off the mimetype concept, e.g. text/markdown
    prompt BOOLEAN, -- True if a "prompt" message from the user or system False if a response from the LLM
    canceled BOOLEAN, -- True if a response was canceled before it could finish

    user_id UUID REFERENCES users(id),
    thread_id UUID REFERENCES threads(id),
    prompt_message_id UUID REFERENCES messages(id) ON DELETE SET NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

-- migrate:down
DROP TABLE messages;
DROP TABLE threads;
