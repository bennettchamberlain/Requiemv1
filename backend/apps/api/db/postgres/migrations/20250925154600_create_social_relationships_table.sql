-- migrate:up
-- =================================================================
-- SOCIAL RELATIONSHIPS AND CONNECTIONS TABLE
-- =================================================================
-- Track relationships with other people (who may or may not be system users)
-- Note: Named social_relationships to avoid conflict with graph relationships table

CREATE TABLE social_relationships (
    relationship_id UUID PRIMARY KEY DEFAULT gen_uuid_v7(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, -- Note: references users(id)
    
    -- The other person (might be a user or just a contact)
    related_user_id UUID REFERENCES users(id), -- If they're also a system user
    person_entity_id UUID REFERENCES entities(entity_id), -- Person entity in our graph
    
    -- Contact information (cached from entity for performance)
    contact_name TEXT NOT NULL,
    contact_email TEXT,
    contact_phone TEXT,
    contact_address TEXT,
    
    -- Relationship details
    relationship_type TEXT CHECK (relationship_type IN ('family', 'friend', 'colleague', 'acquaintance', 'professional', 'romantic_partner')),
    relationship_subtype TEXT, -- 'parent', 'sibling', 'spouse', 'manager', etc.
    
    -- Relationship strength metrics
    closeness_score DOUBLE PRECISION DEFAULT 0.5 CHECK (closeness_score >= 0 AND closeness_score <= 1),
    trust_level DOUBLE PRECISION DEFAULT 0.5 CHECK (trust_level >= 0 AND trust_level <= 1),
    interaction_frequency TEXT CHECK (interaction_frequency IN ('daily', 'weekly', 'monthly', 'quarterly', 'yearly', 'rare')),
    
    -- Temporal aspects
    relationship_started DATE,
    relationship_ended DATE,
    last_interaction TIMESTAMPTZ,
    last_in_person_interaction TIMESTAMPTZ,
    
    -- Context
    how_met TEXT,
    where_met TEXT,
    shared_interests TEXT[],
    shared_activities TEXT[],
    
    -- Communication preferences
    preferred_communication_method TEXT,
    do_not_contact BOOLEAN DEFAULT FALSE,
    contact_notes TEXT,
    
    -- Important dates
    birthday DATE,
    anniversary DATE,
    important_dates JSONB DEFAULT '{}', -- Other important dates
    
    -- AI insights
    relationship_embedding embedding768,
    interaction_patterns JSONB DEFAULT '{}', -- When/how they typically interact
    conversation_topics TEXT[], -- Common topics discussed
    sentiment_history JSONB DEFAULT '[]', -- Historical sentiment scores
    
    -- Privacy
    is_private BOOLEAN DEFAULT FALSE,
    notes TEXT,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Ensure unique relationship per person
    UNIQUE(user_id, person_entity_id)
);

-- Indexes for social relationship management
CREATE INDEX social_relationships_user_idx ON social_relationships(user_id, relationship_type);
CREATE INDEX social_relationships_related_user_idx ON social_relationships(related_user_id) WHERE related_user_id IS NOT NULL;
CREATE INDEX social_relationships_entity_idx ON social_relationships(person_entity_id) WHERE person_entity_id IS NOT NULL;
CREATE INDEX social_relationships_type_idx ON social_relationships(relationship_type, relationship_subtype);
CREATE INDEX social_relationships_frequency_idx ON social_relationships(interaction_frequency, last_interaction);
CREATE INDEX social_relationships_closeness_idx ON social_relationships(closeness_score DESC);
CREATE INDEX social_relationships_birthday_idx ON social_relationships(birthday) WHERE birthday IS NOT NULL;
CREATE INDEX social_relationships_contact_idx ON social_relationships(do_not_contact) WHERE do_not_contact = FALSE;

-- migrate:down
-- Drop indexes and table
DROP INDEX IF EXISTS social_relationships_contact_idx;
DROP INDEX IF EXISTS social_relationships_birthday_idx;
DROP INDEX IF EXISTS social_relationships_closeness_idx;
DROP INDEX IF EXISTS social_relationships_frequency_idx;
DROP INDEX IF EXISTS social_relationships_type_idx;
DROP INDEX IF EXISTS social_relationships_entity_idx;
DROP INDEX IF EXISTS social_relationships_related_user_idx;
DROP INDEX IF EXISTS social_relationships_user_idx;

DROP TABLE IF EXISTS social_relationships;
