-- migrate:up
ALTER TABLE ci.files
  ADD COLUMN parent_id UUID REFERENCES ci.files(file_id) ON DELETE CASCADE,
  ADD COLUMN variant VARCHAR(50) DEFAULT 'ORIGINAL' NOT NULL;

-- migrate:down
ALTER TABLE ci.files DROP COLUMN variant;
ALTER TABLE ci.files DROP COLUMN parent_id;
