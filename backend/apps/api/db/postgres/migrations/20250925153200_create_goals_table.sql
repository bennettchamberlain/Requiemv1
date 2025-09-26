-- migrate:up
-- =================================================================
-- GOALS AND OBJECTIVES TABLE
-- =================================================================
-- Goal tracking and management system

CREATE TABLE goals (
    goal_id UUID PRIMARY KEY DEFAULT gen_uuid_v7(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, -- Note: references users(id)
    goal_entity_id UUID REFERENCES entities(entity_id), -- Goal entity in knowledge graph
    
    -- Goal definition
    title TEXT NOT NULL,
    description TEXT,
    category TEXT, -- 'health', 'career', 'personal', 'financial', 'education', 'social', 'spiritual'
    
    -- Goal hierarchy
    parent_goal_id UUID REFERENCES goals(goal_id) ON DELETE CASCADE,
    goal_level INTEGER DEFAULT 0, -- 0 = top level, increases with depth
    
    -- Measurement
    target_value DOUBLE PRECISION,
    current_value DOUBLE PRECISION DEFAULT 0,
    units TEXT,
    progress_percentage DOUBLE PRECISION GENERATED ALWAYS AS (
        CASE 
            WHEN target_value > 0 THEN (current_value / target_value * 100)
            ELSE 0
        END
    ) STORED,
    
    -- Temporal aspects
    created_at TIMESTAMPTZ DEFAULT NOW(),
    target_date TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    last_progress_update TIMESTAMPTZ,
    
    -- Status
    status TEXT DEFAULT 'active' CHECK (status IN ('draft', 'active', 'paused', 'completed', 'abandoned')),
    
    -- Success criteria
    success_criteria JSONB DEFAULT '{}',
    milestones JSONB DEFAULT '[]', -- Array of milestone objects
    
    -- Tracking automation
    auto_tracking_rules JSONB DEFAULT '{}', -- Rules for automatic progress updates
    data_sources TEXT[], -- Which data sources feed into this goal
    update_frequency TEXT, -- 'daily', 'weekly', 'monthly', 'manual'
    
    -- Semantic representation
    goal_embedding embedding768,
    
    -- Relationships
    related_goal_ids UUID[], -- Related but not parent/child goals
    dependent_goal_ids UUID[], -- Goals that must complete before this one
    blocking_goal_ids UUID[], -- Goals blocked by this one
    
    -- Motivation and context
    motivation TEXT,
    obstacles TEXT[],
    resources_needed TEXT[],
    accountability_partner_id UUID REFERENCES users(id),
    
    -- Privacy and sharing
    is_public BOOLEAN DEFAULT FALSE,
    shared_with_users UUID[],
    
    -- Reminders and notifications
    reminder_settings JSONB DEFAULT '{}',
    last_reminder_sent TIMESTAMPTZ,
    
    -- Analytics
    time_invested_hours DOUBLE PRECISION DEFAULT 0,
    resources_invested JSONB DEFAULT '{}',
    
    -- Constraints
    CONSTRAINT valid_progress CHECK (current_value <= target_value OR target_value IS NULL),
    CONSTRAINT valid_completion CHECK (
        (status = 'completed' AND completed_at IS NOT NULL) OR
        (status != 'completed' AND completed_at IS NULL)
    )
);

-- Indexes for goal management and queries
CREATE INDEX goals_user_idx ON goals(user_id, status, target_date);
CREATE INDEX goals_parent_idx ON goals(parent_goal_id) WHERE parent_goal_id IS NOT NULL;
CREATE INDEX goals_category_idx ON goals(category, status) WHERE category IS NOT NULL;
CREATE INDEX goals_target_date_idx ON goals(target_date) WHERE target_date IS NOT NULL AND status = 'active';
CREATE INDEX goals_progress_idx ON goals(progress_percentage DESC) WHERE status = 'active';
CREATE INDEX goals_entity_idx ON goals(goal_entity_id) WHERE goal_entity_id IS NOT NULL;
CREATE INDEX goals_accountability_idx ON goals(accountability_partner_id) WHERE accountability_partner_id IS NOT NULL;

-- migrate:down
-- Drop indexes and table
DROP INDEX IF EXISTS goals_accountability_idx;
DROP INDEX IF EXISTS goals_entity_idx;
DROP INDEX IF EXISTS goals_progress_idx;
DROP INDEX IF EXISTS goals_target_date_idx;
DROP INDEX IF EXISTS goals_category_idx;
DROP INDEX IF EXISTS goals_parent_idx;
DROP INDEX IF EXISTS goals_user_idx;

DROP TABLE IF EXISTS goals;
