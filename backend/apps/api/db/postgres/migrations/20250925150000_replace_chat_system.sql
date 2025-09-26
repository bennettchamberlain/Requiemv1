-- migrate:up
-- =================================================================
-- SAFELY REPLACE CHAT SYSTEM WITH COMPREHENSIVE CONVERSATIONS/MESSAGES
-- =================================================================
-- Handle all dependencies before dropping threads/messages

-- Step 1: Drop thread_file table first (it references both threads and files)
DROP TABLE IF EXISTS thread_file;

-- Step 2: Update actions table to reference conversations instead of threads
-- First add the new column
ALTER TABLE actions ADD COLUMN conversation_id UUID;
-- Copy any existing thread_id data to conversation_id (if needed for data preservation)
-- UPDATE actions SET conversation_id = thread_id WHERE thread_id IS NOT NULL;
-- Drop the old thread_id column
ALTER TABLE actions DROP COLUMN IF EXISTS thread_id;

-- Step 3: Now safely drop existing chat tables
DROP TABLE IF EXISTS messages;
DROP TABLE IF EXISTS threads;

-- Step 4: Create comprehensive conversations table from CI-Database
CREATE TABLE conversations (
    conversation_id UUID PRIMARY KEY DEFAULT gen_uuid_v7(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- Conversation metadata
    title TEXT, -- Auto-generated or user-set conversation title
    summary TEXT, -- AI-generated summary of conversation topics
    
    -- Temporal tracking
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    last_message_at TIMESTAMPTZ,
    
    -- Conversation state
    status conversation_status DEFAULT 'active',
    is_archived BOOLEAN DEFAULT FALSE,
    
    -- Context and intelligence - this should be all AI generated, provides better history
    main_topics TEXT[], -- Extracted main discussion topics
    mentioned_entities TEXT[], -- People, places, concepts mentioned
    context_embedding embedding768, -- Vector embedding of conversation context
    
    -- Conversation settings
    model_config JSONB DEFAULT '{}', -- Model settings for this conversation
    temperature DOUBLE PRECISION,
    max_tokens INTEGER,
    system_prompt TEXT,
    
    -- Conversation statistics
    message_count INTEGER DEFAULT 0,
    total_tokens_used INTEGER DEFAULT 0,
    avg_response_time_ms INTEGER,
    
    -- Branching and forking
    parent_conversation_id UUID REFERENCES conversations(conversation_id),
    fork_point_message_id UUID, -- Which message this conversation forked from
    
    -- Privacy and sharing
    is_private BOOLEAN DEFAULT TRUE,
    sharing_permissions JSONB DEFAULT '{}'
);

-- Step 5: Create comprehensive messages table from CI-Database  
CREATE TABLE messages (
    message_id UUID PRIMARY KEY DEFAULT gen_uuid_v7(),
    conversation_id UUID NOT NULL REFERENCES conversations(conversation_id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- Message ordering and hierarchy
    parent_message_id UUID REFERENCES messages(message_id), -- For branching conversations
    depth INTEGER DEFAULT 0, -- Depth in conversation tree
    sequence_number INTEGER,
    
    -- Message content and type
    role message_role NOT NULL,
    content TEXT NOT NULL,
    content_type TEXT DEFAULT 'text/plain', -- text/plain, text/markdown, application/json, etc.
    
    -- AI model information (for assistant messages)
    model_name TEXT, -- gpt-4, claude-3, etc.
    model_version TEXT,
    temperature DOUBLE PRECISION,
    
    -- Token and cost tracking
    input_tokens INTEGER DEFAULT 0,
    output_tokens INTEGER DEFAULT 0,
    total_tokens INTEGER GENERATED ALWAYS AS (input_tokens + output_tokens) STORED,
    estimated_cost DECIMAL(10,6), -- Estimated API cost for this message
    
    -- Processing metadata
    processing_time_ms INTEGER, -- How long the model took to respond
    finish_reason TEXT, -- stop, length, content_filter, etc.
    
    -- Message state
    is_edited BOOLEAN DEFAULT FALSE,
    is_deleted BOOLEAN DEFAULT FALSE,
    edit_history JSONB DEFAULT '[]', -- Previous versions of edited content
    
    -- Tool usage (for assistant messages with function calls)
    tool_calls JSONB DEFAULT '[]', -- Function calls made by the assistant
    tool_call_results JSONB DEFAULT '[]', -- Results from tool calls
    
    -- Semantic analysis
    message_embedding embedding768, -- Vector representation for similarity search
    extracted_entities TEXT[], -- People, places, concepts mentioned
    sentiment_score DOUBLE PRECISION CHECK (sentiment_score >= -1 AND sentiment_score <= 1),
    intent_categories TEXT[], -- Categorized user intents
    
    -- User feedback and ratings
    user_rating INTEGER CHECK (user_rating >= 1 AND user_rating <= 5),
    user_feedback TEXT,
    flagged_for_review BOOLEAN DEFAULT FALSE,
    flag_reason TEXT,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT valid_sequence_per_conversation UNIQUE (conversation_id, sequence_number),
    CONSTRAINT content_not_empty CHECK (LENGTH(TRIM(content)) > 0)
);

-- Step 6: Add FK constraint back to actions table
ALTER TABLE actions ADD CONSTRAINT actions_conversation_fk 
    FOREIGN KEY (conversation_id) REFERENCES conversations(conversation_id);

-- migrate:down
-- Revert all changes
ALTER TABLE actions DROP CONSTRAINT IF EXISTS actions_conversation_fk;
ALTER TABLE actions DROP COLUMN IF EXISTS conversation_id;

DROP TABLE IF EXISTS messages;
DROP TABLE IF EXISTS conversations;

-- Recreate original threads table
CREATE TABLE threads (
    id UUID PRIMARY KEY,
    name TEXT,
    user_id UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Recreate original messages table
CREATE TABLE messages (
    id UUID PRIMARY KEY,
    model TEXT,
    text TEXT,
    mimetype TEXT,
    prompt BOOLEAN,
    canceled BOOLEAN,
    user_id UUID REFERENCES users(id),
    thread_id UUID REFERENCES threads(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Recreate actions thread_id column
ALTER TABLE actions ADD COLUMN thread_id UUID REFERENCES threads(id);

-- Recreate thread_file table
CREATE TABLE thread_file (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    thread_id UUID REFERENCES threads(id) NOT NULL,
    file_id UUID REFERENCES files(id) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
