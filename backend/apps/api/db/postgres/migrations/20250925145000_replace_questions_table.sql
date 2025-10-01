-- migrate:up
-- =================================================================
-- REPLACE SIMPLE QUESTIONS TABLE WITH COMPREHENSIVE VERSION  
-- =================================================================
-- Handle dependencies properly before dropping questions table

-- First, drop dependent objects that reference questions.id
DROP TABLE IF EXISTS question_tag CASCADE;

-- Drop the existing answers table (will be recreated by later migration)
DROP TABLE IF EXISTS answers CASCADE;

-- Now we can safely drop the existing simple questions table
DROP TABLE IF EXISTS questions CASCADE;

-- Create comprehensive questions table from CI-Database
CREATE TABLE questions (
    question_id UUID PRIMARY KEY DEFAULT gen_uuid_v7(),

    
    -- Question content
    question_text TEXT NOT NULL,
    question_category TEXT, -- 'philosophical', 'practical', 'personal', 'behavioral', etc.
    question_type TEXT CHECK (question_type IN ('open_ended', 'yes_no', 'scale', 'multiple_choice')),
    
    -- Question relationships - flexible approach for now
    parent_question_id UUID REFERENCES questions(question_id) ON DELETE SET NULL,
    related_questions UUID[], -- Array of related question UUIDs for discovery
    question_thread TEXT, -- Optional grouping identifier for question chains
    is_about UUID[], -- Entities or topics this question is about (references entities table)
    is_private_to UUID REFERENCES users(id), -- If set, only this user can see/answer

    -- Context and metadata
    context_tags TEXT[], -- Topics this question relates to: 'family', 'work', 'health', etc.
    difficulty_level INTEGER CHECK (difficulty_level >= 1 AND difficulty_level <= 5),
    frequency_recommendation TEXT CHECK (frequency_recommendation IN ('daily', 'weekly', 'monthly', 'quarterly', 'annually', 'one_time')),
    
    -- Semantic representation for similarity and discovery
    question_embedding vector(768), -- Full question text embedding
    secondary_embedding vector(768), -- Intent/purpose embedding
    
    -- Question lifecycle
    is_seed_question BOOLEAN DEFAULT FALSE, -- Part of initial question set
    is_active BOOLEAN DEFAULT TRUE,
    created_by_llm BOOLEAN DEFAULT TRUE,
    
    -- Generation context (if created by LLM)
    generation_context JSONB DEFAULT '{}', -- What prompted this question
    generation_model TEXT, -- Which LLM model generated this
    
    -- Usage statistics
    times_asked INTEGER DEFAULT 0,
    times_answered INTEGER DEFAULT 0,
    avg_answer_quality_score DOUBLE PRECISION, -- Based on user feedback or LLM assessment
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    last_asked_at TIMESTAMPTZ,
    
    -- Constraints
    CONSTRAINT question_text_not_empty CHECK (LENGTH(TRIM(question_text)) > 0),
    CONSTRAINT related_questions_not_self_reference CHECK (
        question_id != ALL(COALESCE(related_questions, '{}'))
    )
);

-- Add basic indexes
CREATE INDEX questions_category_idx ON questions(question_category) WHERE is_active = TRUE;
CREATE INDEX questions_type_idx ON questions(question_type);
CREATE INDEX questions_parent_idx ON questions(parent_question_id) WHERE parent_question_id IS NOT NULL;
CREATE INDEX questions_tags_gin_idx ON questions USING GIN(context_tags);
CREATE INDEX questions_active_idx ON questions(is_active);

-- migrate:down
-- Revert back to simple questions table
DROP TABLE IF EXISTS questions CASCADE;

CREATE TABLE questions (
    id UUID PRIMARY KEY,
    category TEXT,
    text TEXT,
    example_answer_1 TEXT,
    example_answer_2 TEXT,
    example_answer_3 TEXT,
    user_id UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE question_tag (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    question_id UUID REFERENCES questions(id) NOT NULL,
    tag_id UUID REFERENCES tags(id) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE answers (
    id UUID PRIMARY KEY,
    question_id UUID REFERENCES questions(id),
    content TEXT NOT NULL,
    user_id UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
