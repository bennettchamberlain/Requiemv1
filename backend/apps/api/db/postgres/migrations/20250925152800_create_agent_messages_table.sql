-- migrate:up
-- =================================================================
-- AGENT MESSAGE QUEUE AND EXECUTION TRACKING
-- =================================================================
-- Task queue and execution state for AI agents

CREATE TABLE agent_messages (
    message_id UUID PRIMARY KEY DEFAULT gen_uuid_v7(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, -- Note: references users(id)
    agent_id UUID NOT NULL REFERENCES agents(agent_id),
    
    -- Task hierarchy
    parent_message_id UUID REFERENCES agent_messages(message_id),
    root_message_id UUID, -- Top-level task in a chain
    conversation_id UUID REFERENCES conversations(conversation_id), -- Groups related messages
    
    -- Temporal attributes
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    scheduled_for TIMESTAMPTZ, -- For delayed execution
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    
    -- Queue management
    priority INTEGER DEFAULT 5 CHECK (priority >= 1 AND priority <= 10),
    status agent_status NOT NULL DEFAULT 'queued',
    queue_position INTEGER, -- Current position in queue
    
    -- Execution payload
    input_payload JSONB NOT NULL,
    output_payload JSONB,
    execution_context JSONB DEFAULT '{}', -- Runtime context
    execution_state JSONB DEFAULT '{}', -- For pause/resume
    
    -- Goal tracking
    goal_description TEXT,
    success_criteria JSONB,
    completion_percentage DOUBLE PRECISION DEFAULT 0 CHECK (completion_percentage >= 0 AND completion_percentage <= 100),
    
    -- Interruption handling
    is_interruptible BOOLEAN DEFAULT TRUE,
    hiatus_reason TEXT,
    interrupted_by UUID REFERENCES agent_messages(message_id),
    can_resume BOOLEAN DEFAULT TRUE,
    
    -- Error handling
    error_message TEXT,
    error_details JSONB,
    retry_count INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 3,
    retry_after TIMESTAMPTZ,
    
    -- Semantic matching
    task_embedding embedding768, -- For finding similar tasks
    
    -- Resource usage
    tokens_used INTEGER,
    compute_seconds DOUBLE PRECISION,
    memory_mb_used INTEGER,
    
    -- Audit trail
    execution_log JSONB DEFAULT '[]', -- Array of execution events
    
    -- Constraints
    CONSTRAINT valid_retry CHECK (retry_count <= max_retries),
    CONSTRAINT valid_completion CHECK (
        (status = 'completed' AND completed_at IS NOT NULL) OR
        (status != 'completed' AND completed_at IS NULL)
    )
);

-- Indexes for efficient queue processing
CREATE INDEX agent_messages_queue_idx ON agent_messages (status, priority, created_at) 
    WHERE status IN ('queued', 'paused');
CREATE INDEX agent_messages_user_active_idx ON agent_messages (user_id, status, created_at)
    WHERE status NOT IN ('completed', 'failed', 'cancelled');
CREATE INDEX agent_messages_scheduled_idx ON agent_messages (scheduled_for)
    WHERE scheduled_for IS NOT NULL AND status = 'queued';
CREATE INDEX agent_messages_conversation_idx ON agent_messages (conversation_id, created_at)
    WHERE conversation_id IS NOT NULL;
CREATE INDEX agent_messages_agent_idx ON agent_messages (agent_id, status, created_at);
CREATE INDEX agent_messages_parent_idx ON agent_messages (parent_message_id) WHERE parent_message_id IS NOT NULL;
CREATE INDEX agent_messages_retry_idx ON agent_messages (retry_after) WHERE retry_after IS NOT NULL;

-- migrate:down
-- Drop indexes and table
DROP INDEX IF EXISTS agent_messages_retry_idx;
DROP INDEX IF EXISTS agent_messages_parent_idx;
DROP INDEX IF EXISTS agent_messages_agent_idx;
DROP INDEX IF EXISTS agent_messages_conversation_idx;
DROP INDEX IF EXISTS agent_messages_scheduled_idx;
DROP INDEX IF EXISTS agent_messages_user_active_idx;
DROP INDEX IF EXISTS agent_messages_queue_idx;

DROP TABLE IF EXISTS agent_messages;
