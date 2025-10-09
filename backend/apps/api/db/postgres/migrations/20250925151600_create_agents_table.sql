-- migrate:up
-- =================================================================
-- AI AGENT COORDINATION SYSTEM
-- =================================================================
-- Agent registry for AI agent coordination and management

CREATE TABLE agents (
    agent_id UUID PRIMARY KEY DEFAULT gen_uuid_v7(),
    agent_entity_id UUID, -- Agent entity in knowledge graph
    
    -- Agent identification
    agent_name TEXT NOT NULL UNIQUE,
    agent_type agent_type NOT NULL,
    version TEXT DEFAULT '1.0.0',
    
    -- Configuration
    configuration JSONB NOT NULL, -- n8n JSON, Python code, or LLM config
    environment_variables JSONB DEFAULT '{}', -- Required env vars
    
    -- Documentation
    description TEXT,
    example_use_case TEXT,
    documentation_url TEXT,
    
    -- Performance metrics
    usage_count INTEGER DEFAULT 0,
    success_count INTEGER DEFAULT 0,
    failure_count INTEGER DEFAULT 0,
    success_rate DOUBLE PRECISION GENERATED ALWAYS AS (
        CASE 
            WHEN usage_count > 0 THEN success_count::DOUBLE PRECISION / usage_count::DOUBLE PRECISION
            ELSE 1.0
        END
    ) STORED,
    avg_execution_time_ms INTEGER,
    p95_execution_time_ms INTEGER,
    
    -- Schema definitions
    input_schema JSONB, -- JSON Schema for expected inputs
    output_schema JSONB, -- JSON Schema for outputs
    required_tools JSONB, -- External tools/APIs this agent needs
    required_permissions JSONB, -- System permissions needed
    
    -- AI/ML features
    agent_embedding vector(768), -- For semantic agent selection
    
    -- Lifecycle
    is_active BOOLEAN DEFAULT TRUE,
    is_deprecated BOOLEAN DEFAULT FALSE,
    deprecation_message TEXT,
    
    -- Audit
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID REFERENCES users(id), -- Note: references users(id)
    last_modified_by UUID REFERENCES users(id), -- Note: references users(id)
    usage_frequency INTEGER DEFAULT 86400,
    
    -- Constraints
    CONSTRAINT valid_version CHECK (version ~ '^\d+\.\d+\.\d+$')
);

-- Add FK constraint to entities table
ALTER TABLE agents 
    ADD CONSTRAINT agents_entity_fk 
    FOREIGN KEY (agent_entity_id) REFERENCES entities(entity_id) ON DELETE SET NULL;

-- Indexes for performance
CREATE INDEX agents_type_idx ON agents(agent_type);
CREATE INDEX agents_active_idx ON agents(is_active) WHERE is_active = TRUE;
CREATE INDEX agents_deprecated_idx ON agents(is_deprecated) WHERE is_deprecated = TRUE;
CREATE INDEX agents_entity_idx ON agents(agent_entity_id) WHERE agent_entity_id IS NOT NULL;
CREATE INDEX agents_created_by_idx ON agents(created_by) WHERE created_by IS NOT NULL;
CREATE INDEX agents_success_rate_idx ON agents(success_rate) WHERE usage_count > 0;

-- migrate:down
-- Drop the table and all related constraints
DROP TABLE IF EXISTS agents;
