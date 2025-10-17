-- migrate:up
-- =================================================================
-- Link documents and voice recordings to files table
-- =================================================================

-- Ensure indexes depending on redundant columns are removed before dropping them
DROP INDEX IF EXISTS documents_hash_idx;
DROP INDEX IF EXISTS voice_recordings_hash_idx;

-- Documents now reference files for storage metadata
ALTER TABLE documents
    ADD COLUMN file_id UUID,
    DROP COLUMN file_path,
    DROP COLUMN file_hash,
    DROP COLUMN file_size_bytes;

ALTER TABLE documents
    ADD CONSTRAINT documents_file_fk FOREIGN KEY (file_id) REFERENCES files(file_id) ON DELETE CASCADE;

CREATE INDEX documents_file_id_idx ON documents(file_id) WHERE file_id IS NOT NULL;

-- Voice recordings also reference files
ALTER TABLE voice_recordings
    ADD COLUMN file_id UUID,
    DROP COLUMN audio_file_path,
    DROP COLUMN audio_format,
    DROP COLUMN file_size_bytes,
    DROP COLUMN audio_hash;

ALTER TABLE voice_recordings
    ADD CONSTRAINT voice_recordings_file_fk FOREIGN KEY (file_id) REFERENCES files(file_id) ON DELETE CASCADE;

CREATE INDEX voice_recordings_file_id_idx ON voice_recordings(file_id) WHERE file_id IS NOT NULL;

-- migrate:down
-- Revert documents and voice recordings to standalone storage fields
DROP INDEX IF EXISTS voice_recordings_file_id_idx;
DROP INDEX IF EXISTS documents_file_id_idx;

ALTER TABLE voice_recordings
    DROP CONSTRAINT IF EXISTS voice_recordings_file_fk;

ALTER TABLE documents
    DROP CONSTRAINT IF EXISTS documents_file_fk;

ALTER TABLE voice_recordings
    DROP COLUMN IF EXISTS file_id,
    ADD COLUMN audio_file_path TEXT,
    ADD COLUMN audio_format TEXT NOT NULL DEFAULT 'wav',
    ADD COLUMN file_size_bytes BIGINT,
    ADD COLUMN audio_hash TEXT;

ALTER TABLE voice_recordings
    ALTER COLUMN audio_format DROP DEFAULT;

ALTER TABLE documents
    DROP COLUMN IF EXISTS file_id,
    ADD COLUMN file_path TEXT,
    ADD COLUMN file_hash TEXT,
    ADD COLUMN file_size_bytes BIGINT CHECK (file_size_bytes > 0);

CREATE INDEX voice_recordings_hash_idx ON voice_recordings(audio_hash) WHERE audio_hash IS NOT NULL;
CREATE INDEX documents_hash_idx ON documents(file_hash) WHERE file_hash IS NOT NULL;
