-- migrate:up
-- =================================================================
-- ADD FULL-TEXT SEARCH TO MESSAGES TABLE
-- =================================================================
-- Add tsvector column and trigger for messages search

-- Add tsvector column to messages for full-text search
ALTER TABLE messages ADD COLUMN search_vector tsvector;

-- Create function to update search_vector
CREATE OR REPLACE FUNCTION messages_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector := to_tsvector('english',
    coalesce(NEW.content, '') || ' ' ||
    coalesce(array_to_string(NEW.extracted_entities, ' '), '') || ' ' ||
    coalesce(array_to_string(NEW.intent_categories, ' '), '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Create trigger to automatically update search_vector
CREATE TRIGGER messages_search_vector_trigger
  BEFORE INSERT OR UPDATE OF content, extracted_entities, intent_categories
  ON messages
  FOR EACH ROW
  EXECUTE FUNCTION messages_search_vector_update();

-- Backfill existing messages
UPDATE messages SET search_vector = to_tsvector('english',
  coalesce(content, '') || ' ' ||
  coalesce(array_to_string(extracted_entities, ' '), '') || ' ' ||
  coalesce(array_to_string(intent_categories, ' '), '')
);

-- Create GIN index for fast FTS on messages
CREATE INDEX messages_fts_idx ON messages USING GIN(search_vector);

-- migrate:down
-- Remove the search functionality
DROP TRIGGER IF EXISTS messages_search_vector_trigger ON messages;
DROP FUNCTION IF EXISTS messages_search_vector_update();
DROP INDEX IF EXISTS messages_fts_idx;
ALTER TABLE messages DROP COLUMN IF EXISTS search_vector;
