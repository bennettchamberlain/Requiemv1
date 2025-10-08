-- migrate:up
CREATE TABLE IF NOT EXISTS message_files (
    message_id UUID NOT NULL REFERENCES messages(message_id) ON DELETE CASCADE,
    file_id UUID NOT NULL REFERENCES files(file_id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (message_id, file_id)
);

INSERT INTO message_files (message_id, file_id, created_at)
SELECT message_id, file_id, COALESCE(updated_at, NOW())
FROM files
WHERE message_id IS NOT NULL
ON CONFLICT DO NOTHING;

ALTER TABLE files DROP COLUMN IF EXISTS message_id;

-- migrate:down
ALTER TABLE files
    ADD COLUMN message_id UUID REFERENCES messages(message_id) ON DELETE SET NULL;

UPDATE files AS f
SET message_id = mf.message_id
FROM message_files AS mf
WHERE f.file_id = mf.file_id;

DROP TABLE IF EXISTS message_files;
