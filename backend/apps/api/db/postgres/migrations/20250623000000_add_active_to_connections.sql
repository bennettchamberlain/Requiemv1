-- migrate:up
ALTER TABLE connections ADD COLUMN active BOOLEAN DEFAULT true;

-- migrate:down
ALTER TABLE connections DROP COLUMN active;
