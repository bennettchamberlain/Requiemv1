-- migrate:up
ALTER TABLE public.providers SET SCHEMA ci_core;
ALTER TABLE public.connections SET SCHEMA ci_core;

-- migrate:down
ALTER TABLE ci_core.connections SET SCHEMA public;
ALTER TABLE ci_core.providers SET SCHEMA public;
