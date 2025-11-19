-- migrate:up
ALTER TABLE public.signup_code SET SCHEMA ci_core;

-- migrate:down
ALTER TABLE ci_core.signup_code SET SCHEMA public;
