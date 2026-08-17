-- migrate:up

ALTER TABLE ci.connections
    ADD COLUMN account_label TEXT;

-- migrate:down

ALTER TABLE ci.connections
    DROP COLUMN account_label;
