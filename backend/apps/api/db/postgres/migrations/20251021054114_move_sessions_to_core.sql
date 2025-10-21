-- migrate:up
ALTER TABLE public.sessions SET SCHEMA ci_core;

-- migrate:down
ALTER TABLE ci_core.sessions SET SCHEMA public;
