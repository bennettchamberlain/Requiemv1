-- migrate:up
ALTER TABLE public.users SET SCHEMA ci_core;

-- migrate:down
ALTER TABLE ci_core.users SET SCHEMA public;
