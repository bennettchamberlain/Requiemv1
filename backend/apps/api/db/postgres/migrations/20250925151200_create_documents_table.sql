-- migrate:up
-- =================================================================
-- DOCUMENTS MANAGEMENT SYSTEM
-- =================================================================
-- Document storage and management for RAG system and knowledge base

CREATE TABLE documents (
    document_id UUID PRIMARY KEY DEFAULT gen_uuid_v7(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, -- Note: references users(id)
    document_entity_id UUID, -- Document entity in knowledge graph
    
    -- Document metadata
    title TEXT NOT NULL,
    content_type document_content_type NOT NULL,
    file_path TEXT, -- Local file system path
    file_hash TEXT, -- For deduplication
    file_size_bytes BIGINT CHECK (file_size_bytes > 0),
    
    -- Content
    content TEXT, -- Extracted text content
    content_language TEXT DEFAULT 'en',
    
    -- Metadata and properties
    metadata JSONB DEFAULT '{}', -- Author, creation date, tags, etc.
    source_url TEXT, -- If downloaded from web
    tags TEXT[],
    
    -- Vector embeddings for RAG
    title_embedding embedding768,
    content_embedding embedding768, -- Full document embedding
    summary_embedding embedding768, -- Summary embedding
    
    -- AI-generated
    summary TEXT,
    key_topics TEXT[],
    entities_extracted JSONB DEFAULT '{}', -- Named entities found
    
    -- Access control
    access_level access_level DEFAULT 'private',
    shared_with_users UUID[], -- Array of user_ids
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    indexed_at TIMESTAMPTZ,
    last_accessed_at TIMESTAMPTZ,
    
    -- Version control
    version INTEGER DEFAULT 1,
    previous_version_id UUID REFERENCES documents(document_id)
);

-- Add FK constraint to entities table
ALTER TABLE documents 
    ADD CONSTRAINT documents_entity_fk 
    FOREIGN KEY (document_entity_id) REFERENCES entities(entity_id) ON DELETE SET NULL;

-- Indexes for performance
CREATE INDEX documents_user_idx ON documents(user_id);
CREATE INDEX documents_content_type_idx ON documents(content_type);
CREATE INDEX documents_hash_idx ON documents(file_hash) WHERE file_hash IS NOT NULL;
CREATE INDEX documents_tags_idx ON documents USING GIN (tags) WHERE tags IS NOT NULL;
CREATE INDEX documents_access_idx ON documents(access_level);
CREATE INDEX documents_entity_idx ON documents(document_entity_id) WHERE document_entity_id IS NOT NULL;
CREATE INDEX documents_version_idx ON documents(previous_version_id) WHERE previous_version_id IS NOT NULL;

-- Full-text search
CREATE INDEX documents_content_fts_idx ON documents USING GIN (to_tsvector('english', title || ' ' || COALESCE(content, '')));

-- migrate:down
-- Drop the table and all related constraints
DROP TABLE IF EXISTS documents;
