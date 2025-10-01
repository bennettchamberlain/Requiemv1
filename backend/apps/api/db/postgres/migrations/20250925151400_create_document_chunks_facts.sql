-- migrate:up
-- =================================================================
-- DOCUMENT CHUNKS AND FACTS SYSTEM
-- =================================================================
-- Vector chunks for RAG and facts storage for knowledge management

-- Document chunks for large documents and RAG system
CREATE TABLE document_chunks (
    chunk_id UUID PRIMARY KEY DEFAULT gen_uuid_v7(),
    document_id UUID NOT NULL REFERENCES documents(document_id) ON DELETE CASCADE,
    
    -- Chunk position
    chunk_index INTEGER NOT NULL CHECK (chunk_index >= 0),
    start_char INTEGER NOT NULL CHECK (start_char >= 0),
    end_char INTEGER NOT NULL CHECK (end_char > start_char),
    
    -- Content
    content TEXT NOT NULL, -- If it is an image, use a VLM to describe the image
    is_derived BOOLEAN DEFAULT FALSE,
    chunk_embedding vector(768) NOT NULL,
    
    -- Metadata
    section_title TEXT, -- If chunk belongs to a specific section
    page_number INTEGER, -- For PDFs
    
    -- Semantic search optimization
    relevance_score DOUBLE PRECISION, -- Pre-computed relevance for common queries
    
    UNIQUE(document_id, chunk_index)
);

-- Facts table for derived knowledge and pruned entity data
CREATE TABLE facts (
    fact_id UUID PRIMARY KEY DEFAULT gen_uuid_v7(),
    fact_owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, -- Note: references users(id)
    
    -- Fact content
    fact_statement JSONB NOT NULL, -- Structured fact data
    fact_type TEXT NOT NULL, -- 'entity', 'relationship', 'event', 'rule', 'preference'
    
    -- Entity reference (for cold storage of entities)
    original_entity_id UUID, -- Original entity ID before archiving
    preserved_relationships JSONB DEFAULT '{}', -- Preserved relationship data for re-integration
    
    -- Semantic representation
    fact_embedding vector(768),
    
    -- Metadata
    source TEXT NOT NULL, -- Where this fact came from
    confidence_score DOUBLE PRECISION DEFAULT 1.0 CHECK (confidence_score >= 0 AND confidence_score <= 1),
    
    -- Temporal aspects
    learned_at TIMESTAMPTZ DEFAULT NOW(),
    valid_from TIMESTAMPTZ,
    valid_until TIMESTAMPTZ,
    archived_at TIMESTAMPTZ, -- When moved from active entities to facts
    last_verified_at TIMESTAMPTZ,
    
    -- Access control
    access_level access_level DEFAULT 'private',
    
    -- Versioning
    supersedes_fact_id UUID REFERENCES facts(fact_id),
    is_current BOOLEAN DEFAULT TRUE
);

-- Add FK constraint to entities table for facts
ALTER TABLE facts 
    ADD CONSTRAINT facts_entity_fk 
    FOREIGN KEY (original_entity_id) REFERENCES entities(entity_id) ON DELETE SET NULL;

-- Indexes for document chunks
CREATE INDEX document_chunks_document_idx ON document_chunks(document_id);
CREATE INDEX document_chunks_page_idx ON document_chunks(page_number) WHERE page_number IS NOT NULL;
CREATE INDEX document_chunks_section_idx ON document_chunks(section_title) WHERE section_title IS NOT NULL;

-- Indexes for facts  
CREATE INDEX facts_owner_idx ON facts(fact_owner_id);
CREATE INDEX facts_current_idx ON facts(is_current) WHERE is_current = TRUE;
CREATE INDEX facts_type_idx ON facts(fact_type);
CREATE INDEX facts_source_idx ON facts(source);
CREATE INDEX facts_archived_idx ON facts(archived_at) WHERE archived_at IS NOT NULL;
CREATE INDEX facts_entity_ref_idx ON facts(original_entity_id) WHERE original_entity_id IS NOT NULL;
CREATE INDEX facts_supersedes_idx ON facts(supersedes_fact_id) WHERE supersedes_fact_id IS NOT NULL;

-- migrate:down
-- Drop the tables and all related constraints
DROP TABLE IF EXISTS facts;
DROP TABLE IF EXISTS document_chunks;
