-- migrate:up
-- =====================================================================
-- Thicker daily metrics (#53 leftovers) + home identity question
-- =====================================================================
-- Shared schema for feat/3-and-4. Post-ingest enrichment (#51) adds no DDL:
-- coalesce is a delayed pg-boss singleton; GPS reverse and inventory FK
-- already have columns. Findings tables store metric names as text.
--
-- Coverage, not zero-fill: every new metric column is NULLABLE. NULL means
-- "no underlying data that day" (no calendar / no sleep / no confirmed home).

ALTER TABLE ci_derived.daily_metrics
    ADD COLUMN IF NOT EXISTS time_at_home DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS meeting_minutes DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS sleep_minutes DOUBLE PRECISION;

-- Durable Q&A row so selector / action answers land on ci.answers immediately.
-- Stable UUID: HomeConfirmQuestionId in daily-metrics / personalization code.
INSERT INTO ci.questions (
    question_id,
    question_text,
    question_category,
    question_type,
    is_seed_question,
    is_active,
    created_by_llm,
    frequency_recommendation
) VALUES (
    'a1b0c0de-1111-4111-8111-000000000051',
    'Which of these places is home?',
    'Home',
    'multiple_choice',
    TRUE,
    TRUE,
    FALSE,
    'one_time'
) ON CONFLICT (question_id) DO NOTHING;

-- migrate:down
DELETE FROM ci.questions WHERE question_id = 'a1b0c0de-1111-4111-8111-000000000051';

ALTER TABLE ci_derived.daily_metrics
    DROP COLUMN IF EXISTS sleep_minutes,
    DROP COLUMN IF EXISTS meeting_minutes,
    DROP COLUMN IF EXISTS time_at_home;
