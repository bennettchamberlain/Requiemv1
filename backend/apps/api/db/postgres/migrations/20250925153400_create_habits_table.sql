-- migrate:up
-- =================================================================
-- HABITS AND ROUTINES TABLE
-- =================================================================
-- Habit definitions and tracking parameters

CREATE TABLE habits (
    habit_id UUID PRIMARY KEY DEFAULT gen_uuid_v7(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, -- Note: references users(id)
    goal_id UUID REFERENCES goals(goal_id) ON DELETE SET NULL,
    
    -- Habit details
    habit_name TEXT NOT NULL,
    description TEXT,
    category TEXT CHECK (category IN ('health', 'productivity', 'wellness', 'learning', 'social', 'mindfulness')),
    
    -- Tracking parameters
    target_frequency TEXT NOT NULL CHECK (target_frequency IN ('daily', 'weekly', 'monthly', 'custom')),
    custom_frequency JSONB, -- If custom, define the pattern
    target_value DOUBLE PRECISION,
    units TEXT,
    
    -- Time preferences
    preferred_time_of_day TIME,
    preferred_days_of_week INTEGER[], -- 0=Sunday, 6=Saturday
    duration_minutes INTEGER,
    
    -- Automation
    auto_detection_rules JSONB DEFAULT '{}', -- How to automatically detect this habit
    trigger_conditions JSONB DEFAULT '{}', -- What triggers this habit
    data_sources TEXT[], -- Which data sources can detect this
    
    -- Semantic representation
    habit_embedding embedding768,
    
    -- Status
    is_active BOOLEAN DEFAULT TRUE,
    started_at DATE DEFAULT CURRENT_DATE,
    paused_at DATE,
    
    -- Streaks and statistics
    current_streak INTEGER DEFAULT 0,
    longest_streak INTEGER DEFAULT 0,
    total_completions INTEGER DEFAULT 0,
    completion_rate DOUBLE PRECISION DEFAULT 0,
    
    -- Reminders
    reminder_enabled BOOLEAN DEFAULT FALSE,
    reminder_time TIME,
    reminder_message TEXT,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for habit management
CREATE INDEX habits_user_idx ON habits(user_id, is_active);
CREATE INDEX habits_goal_idx ON habits(goal_id) WHERE goal_id IS NOT NULL;
CREATE INDEX habits_category_idx ON habits(category, is_active) WHERE category IS NOT NULL;
CREATE INDEX habits_frequency_idx ON habits(target_frequency, is_active);
CREATE INDEX habits_reminder_idx ON habits(reminder_enabled, reminder_time) WHERE reminder_enabled = TRUE;
CREATE INDEX habits_streak_idx ON habits(current_streak DESC) WHERE is_active = TRUE;

-- migrate:down
-- Drop indexes and table
DROP INDEX IF EXISTS habits_streak_idx;
DROP INDEX IF EXISTS habits_reminder_idx;
DROP INDEX IF EXISTS habits_frequency_idx;
DROP INDEX IF EXISTS habits_category_idx;
DROP INDEX IF EXISTS habits_goal_idx;
DROP INDEX IF EXISTS habits_user_idx;

DROP TABLE IF EXISTS habits;
