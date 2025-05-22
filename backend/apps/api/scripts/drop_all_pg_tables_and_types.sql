-- Drop all tables and types in the public schema only (safer for most dev setups)
DO $$ DECLARE
    r RECORD;
BEGIN
    -- Drop all tables in public schema
    FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
        EXECUTE 'DROP TABLE IF EXISTS "' || r.tablename || '" CASCADE';
    END LOOP;
    -- Drop all enum types in public schema (must drop dependent tables first)
    FOR r IN (SELECT typname FROM pg_type WHERE typcategory = 'E' AND typnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')) LOOP
        BEGIN
            EXECUTE 'DROP TYPE IF EXISTS "' || r.typname || '" CASCADE';
        EXCEPTION WHEN others THEN
            -- Ignore errors if type is still in use (shouldn't happen if tables dropped first)
            NULL;
        END;
    END LOOP;
END $$;
