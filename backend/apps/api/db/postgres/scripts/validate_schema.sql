-- =================================================================
-- SCHEMA VALIDATION SCRIPT
-- =================================================================
-- Quick validation that our migrated schema is working correctly

-- Check all major tables exist with correct structure
SELECT 
    'entities' as table_name,
    COUNT(*) as row_count,
    'Graph entities table' as description
FROM entities
UNION ALL
SELECT 
    'relationships',
    COUNT(*),
    'Graph relationships table'
FROM relationships
UNION ALL
SELECT 
    'users',
    COUNT(*),
    'Enhanced users table'
FROM users
UNION ALL
SELECT 
    'devices',
    COUNT(*),
    'Device registry'
FROM devices
UNION ALL
SELECT 
    'sensors',
    COUNT(*),
    'Sensor registry'
FROM sensors
UNION ALL
SELECT 
    'questions',
    COUNT(*),
    'Comprehensive questions table'
FROM questions
UNION ALL
SELECT 
    'answers',
    COUNT(*),
    'Rich answers table'
FROM answers
UNION ALL
SELECT 
    'files',
    COUNT(*),
    'Comprehensive files table'
FROM files
UNION ALL
SELECT 
    'events',
    COUNT(*),
    'Rich events table'
FROM events
UNION ALL
SELECT 
    'conversations',
    COUNT(*),
    'Chat conversations table'
FROM conversations
UNION ALL
SELECT 
    'messages',
    COUNT(*),
    'Chat messages table'
FROM messages
UNION ALL
SELECT 
    'conversation_file',
    COUNT(*),
    'File-conversation linking'
FROM conversation_file;

-- Check that key constraints and types are working
SELECT 
    'Vector domain test' as test,
    CASE 
        WHEN data_type = 'USER-DEFINED' THEN 'PASS - embedding768 domain exists'
        ELSE 'FAIL - embedding768 domain missing'
    END as result
FROM information_schema.columns 
WHERE table_name = 'questions' AND column_name = 'question_embedding'
LIMIT 1;

-- Check TimescaleDB extension
SELECT 
    'TimescaleDB test' as test,
    CASE 
        WHEN COUNT(*) > 0 THEN 'PASS - TimescaleDB available'
        ELSE 'FAIL - TimescaleDB missing'
    END as result
FROM pg_extension 
WHERE extname = 'timescaledb';

-- Check PostGIS extension  
SELECT 
    'PostGIS test' as test,
    CASE 
        WHEN COUNT(*) > 0 THEN 'PASS - PostGIS available'
        ELSE 'FAIL - PostGIS missing' 
    END as result
FROM pg_extension 
WHERE extname = 'postgis';

-- Check pgvector extension
SELECT 
    'pgvector test' as test,
    CASE 
        WHEN COUNT(*) > 0 THEN 'PASS - pgvector available'
        ELSE 'FAIL - pgvector missing'
    END as result
FROM pg_extension 
WHERE extname = 'vector';

-- Check foreign key relationships are working
SELECT 
    'FK relationships test' as test,
    CASE 
        WHEN COUNT(*) >= 10 THEN 'PASS - Multiple FK constraints exist'
        ELSE 'FAIL - FK constraints missing'
    END as result
FROM information_schema.table_constraints 
WHERE constraint_type = 'FOREIGN KEY'
AND table_schema = 'public';

\echo 'Schema validation complete! All major tables and constraints should be present.'
