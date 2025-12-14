DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN (
        SELECT schemaname, tablename
        FROM pg_tables
        WHERE schemaname IN ('ci', 'ci_search')
    ) LOOP
        EXECUTE 'TRUNCATE ' || quote_ident(r.schemaname) || '.' || quote_ident(r.tablename) || ' CASCADE;';
    END LOOP;

    DROP SCHEMA IF EXISTS pgboss CASCADE;
END $$;
