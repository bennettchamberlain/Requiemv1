-- migrate:up
-- =================================================================
-- CREATE COMPREHENSIVE ANSWERS TABLE
-- =================================================================
-- Create the full CI-Database answers table to work with questions
-- Note: answers table already dropped by questions migration

-- Create comprehensive answers table from CI-Database
CREATE TABLE answers (
    answer_id UUID PRIMARY KEY DEFAULT gen_uuid_v7(),
    question_id UUID NOT NULL REFERENCES questions(question_id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, -- Note: references users(id) not user_id
    
    -- Answer content
    answer_text TEXT NOT NULL,
    answer_confidence DOUBLE PRECISION CHECK (answer_confidence >= 0 AND answer_confidence <= 1),
    
    -- Answer metadata
    answer_source TEXT DEFAULT 'user_input' CHECK (answer_source IN ('user_input', 'inferred', 'observed', 'imported')),
    answer_method TEXT, -- 'chat', 'survey', 'voice', 'behavior_analysis', etc.
    
    -- Context when answered
    answered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    session_context JSONB DEFAULT '{}', -- Conversation or session context
    emotional_state TEXT, -- User's emotional state if detectable
    location_context TEXT, -- Where this was answered if relevant
    
    -- Answer analysis
    answer_embedding embedding768, -- For semantic analysis of responses
    extracted_entities TEXT[], -- People, places, concepts mentioned
    sentiment_score DOUBLE PRECISION CHECK (sentiment_score >= -1 AND sentiment_score <= 1),
    complexity_score DOUBLE PRECISION, -- How complex/detailed the answer is
    
    -- Quality and validation
    answer_completeness DOUBLE PRECISION CHECK (answer_completeness >= 0 AND answer_completeness <= 1),
    needs_followup BOOLEAN DEFAULT FALSE,
    followup_questions TEXT[], -- Suggested follow-up questions
    
    -- User feedback on the questioning process
    question_relevance_score INTEGER CHECK (question_relevance_score >= 1 AND question_relevance_score <= 5),
    question_clarity_score INTEGER CHECK (question_clarity_score >= 1 AND question_clarity_score <= 5),
    
    -- Answer evolution tracking
    is_update_to_previous BOOLEAN DEFAULT FALSE, -- Is this updating a previous answer?
    previous_answer_id UUID REFERENCES answers(answer_id), -- Links to previous version
    change_reason TEXT, -- Why the answer changed
    
    -- Privacy and sensitivity
    is_sensitive BOOLEAN DEFAULT FALSE,
    sharing_level TEXT DEFAULT 'private' CHECK (sharing_level IN ('private', 'family', 'trusted', 'anonymous_research')),
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT answer_text_not_empty CHECK (LENGTH(TRIM(answer_text)) > 0),
    CONSTRAINT no_self_reference_previous CHECK (answer_id != previous_answer_id)
);

-- Add basic indexes
CREATE INDEX answers_question_user_idx ON answers(question_id, user_id);
CREATE INDEX answers_user_answered_idx ON answers(user_id, answered_at DESC);
CREATE INDEX answers_question_answered_idx ON answers(question_id, answered_at DESC);
CREATE INDEX answers_source_method_idx ON answers(answer_source, answer_method);
CREATE INDEX answers_previous_chain_idx ON answers(previous_answer_id) WHERE previous_answer_id IS NOT NULL;

-- migrate:down
-- Revert to simple answers table structure
DROP TABLE IF EXISTS answers;

CREATE TABLE answers (
    id UUID PRIMARY KEY,
    question_id UUID REFERENCES questions(id) NOT NULL,
    content TEXT NOT NULL,
    user_id UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
