-- migrate:up
-- =================================================================
-- CREATE CONVERSATION_FILE TABLE
-- =================================================================
-- Create conversation_file table to link files with conversations
-- (thread_file table was already dropped in previous migration)

CREATE TABLE conversation_file (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    conversation_id UUID REFERENCES conversations(conversation_id) NOT NULL,
    file_id UUID REFERENCES files(file_id) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Ensure unique conversation-file relationships
    CONSTRAINT conversation_file_unique UNIQUE (conversation_id, file_id)
);

-- Index for performance
CREATE INDEX conversation_file_conversation_idx ON conversation_file(conversation_id);
CREATE INDEX conversation_file_file_idx ON conversation_file(file_id);

-- migrate:down
-- Revert to original thread_file structure
DROP TABLE IF EXISTS conversation_file;

-- Note: thread_file table would be recreated by the rollback of previous migration
