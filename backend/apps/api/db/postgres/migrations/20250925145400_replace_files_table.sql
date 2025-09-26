-- migrate:up
-- =================================================================
-- REPLACE FILES TABLE WITH COMPREHENSIVE VERSION
-- =================================================================
-- Drop existing simple files table and replace with CI-Database version

-- Drop dependent foreign keys first (find them)
-- Note: thread_file table may reference files
DROP TABLE IF EXISTS thread_file;

-- Drop the existing simple files table
DROP TABLE IF EXISTS files;

-- Create comprehensive files table from CI-Database (adapted for existing FK structure)
CREATE TABLE files (
    file_id UUID DEFAULT gen_uuid_v7(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, -- Note: references users(id)
    file_entity_id UUID, -- Reference to File entity in knowledge graph
    
    -- File identification and location
    file_path TEXT NOT NULL, -- Full path: /Users/Liam/docs/file.pdf, gs://bucket/file.pdf
    filename TEXT NOT NULL, -- Just the filename: file.pdf, IMG_001.jpg
    file_extension TEXT, -- pdf, jpg, docx, etc.
    original_filename TEXT, -- Original name if file was renamed
    -- for s3/minio stored files
    bucket TEXT,
    key UUID,
    
    -- Storage and device context
    storage_type TEXT NOT NULL, -- 'local', 'cloud', 'mobile'   
    storage_provider TEXT, -- 'google_drive', 'dropbox', 'icloud', 'local', 'iphone', 'android'
    device_id UUID REFERENCES devices(device_id), -- Which device this file is on
    cloud_file_id TEXT, -- Provider's file ID (Google Drive ID, etc.)
    storage_account TEXT, -- Which account/email owns this in cloud storage
    
    -- File properties and metadata
    file_size_bytes BIGINT,
    mime_type TEXT, -- application/pdf, image/jpeg, text/plain
    content_type TEXT, -- High-level: 'document', 'image', 'video', 'audio', 'code', 'data'
    file_hash TEXT, -- SHA-256 hash for deduplication and integrity
    
    -- Timestamps and versioning
    created_at_source TIMESTAMPTZ, -- When file was created (from file system)
    modified_at_source TIMESTAMPTZ NOT NULL, -- When file was last modified (from file system)
    accessed_at_source TIMESTAMPTZ, -- Last access time (if available)
    discovered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), -- When we first found this file
    last_scanned_at TIMESTAMPTZ DEFAULT NOW(), -- When we last analyzed this file
    version_number INTEGER DEFAULT 1, -- For tracking file versions
    
    -- Content analysis and understanding
    title TEXT, -- Extracted or inferred title
    summary TEXT, -- AI-generated summary of content
    content_preview TEXT, -- First few lines/preview of content
    extracted_text TEXT, -- Full text extracted from file (OCR, PDF text, etc.)
    language TEXT DEFAULT 'en', -- Detected language
    
    -- Semantic representation
    content_embedding embedding768, -- Semantic embedding of file content
    title_embedding embedding768, -- Embedding of title/filename for search
    
    -- Content categorization and tagging
    tags TEXT[], -- User or system generated tags
    categories TEXT[], -- 'work', 'personal', 'financial', 'health', 'family'
    topics TEXT[], -- Extracted topics: 'machine_learning', 'tax_documents', 'vacation_photos'
    mentions_people TEXT[], -- People mentioned in the content
    mentions_places TEXT[], -- Places mentioned in the content
    
    -- Media-specific metadata (for images, videos, audio)
    media_metadata JSONB DEFAULT '{}', -- Dimensions, duration, camera settings, GPS coords, etc.
    thumbnail_path TEXT, -- Path to generated thumbnail
    
    -- Document-specific metadata
    document_metadata JSONB DEFAULT '{}', -- Page count, author, creation app, word count, etc.
    
    -- Relationships and context
    parent_folder TEXT, -- Directory this file is in
    related_file_ids UUID[], -- Related files (versions, similar content)
    project_tags TEXT[], -- Which projects this file belongs to
    created_by_entity_id UUID, -- Person who created this (if different from user)
    
    -- Privacy and access control
    is_private BOOLEAN DEFAULT FALSE,
    is_sensitive BOOLEAN DEFAULT FALSE, -- Contains PII, passwords, etc.
    access_level access_level DEFAULT 'private',
    
    -- Sync and availability
    sync_status TEXT DEFAULT 'synced' CHECK (sync_status IN ('synced', 'pending', 'failed', 'offline', 'deleted_remote')),
    is_available BOOLEAN DEFAULT TRUE, -- Can we currently access this file?
    last_sync_at TIMESTAMPTZ,
    sync_error TEXT, -- Error message if sync failed
    
    -- Processing status
    content_extracted BOOLEAN DEFAULT FALSE,
    embedding_generated BOOLEAN DEFAULT FALSE,
    thumbnail_generated BOOLEAN DEFAULT FALSE,
    analysis_completed BOOLEAN DEFAULT FALSE,
    processing_error TEXT,
    
    -- File lifecycle
    is_deleted BOOLEAN DEFAULT FALSE, -- Soft delete
    is_archived BOOLEAN DEFAULT FALSE, -- Archived but not deleted
    deleted_at TIMESTAMPTZ,
    
    -- Search and indexing
    search_vector tsvector,
    
    -- Audit
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT valid_file_size CHECK (file_size_bytes >= 0),
    CONSTRAINT valid_version CHECK (version_number >= 1),
    PRIMARY KEY (file_id)
);

-- migrate:down
-- Revert back to simple files table
DROP TABLE IF EXISTS files;

CREATE TABLE files (
    id UUID PRIMARY KEY,
    bucket TEXT,
    key UUID,
    original_name TEXT,
    content_type TEXT,
    size BIGINT,
    user_id UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Recreate the thread_file table that was dropped
CREATE TABLE thread_file (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    thread_id UUID REFERENCES threads(id) NOT NULL,
    file_id UUID REFERENCES files(id) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
