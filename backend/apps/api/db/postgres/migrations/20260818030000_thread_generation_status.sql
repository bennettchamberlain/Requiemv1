-- migrate:up
-- Chat turns run as pg-boss jobs. The sidebar and re-attach path need to know
-- whether a thread is queued, streaming, or idle without scraping pgboss.job.

ALTER TABLE ci.threads
    ADD COLUMN IF NOT EXISTS generation_status TEXT NOT NULL DEFAULT 'idle';

-- migrate:down

ALTER TABLE ci.threads DROP COLUMN IF EXISTS generation_status;
