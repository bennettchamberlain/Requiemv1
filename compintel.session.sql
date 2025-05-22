DO $$ DECLARE
    r RECORD;
BEGIN
    -- Drop all tables in the current schema
    FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = current_schema()) LOOP
        EXECUTE 'DROP TABLE IF EXISTS "' || r.tablename || '" CASCADE;';
    END LOOP;
    -- Drop all enum types in the current schema
    FOR r IN (SELECT typname FROM pg_type WHERE typcategory = 'E' AND typnamespace = (SELECT oid FROM pg_namespace WHERE nspname = current_schema())) LOOP
        EXECUTE 'DROP TYPE IF EXISTS "' || r.typname || '" CASCADE;';
    END LOOP;
END $$;
