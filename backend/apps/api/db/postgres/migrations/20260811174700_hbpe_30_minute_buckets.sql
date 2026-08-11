-- migrate:up
-- Restore HBPE forecast bucket indices to 30-minute resolution (48 buckets/day).
--
-- Rows written under the 15-minute regime (bucket indices 0..95) are not
-- semantically compatible with 30-minute indexing of the same numbers, so
-- clear forecast logs and token streams. Nightly serialize / bootstrap will
-- rebuild tokens; /histogram regenerates prediction_log.

DELETE FROM hbpe.prediction_log;
DELETE FROM hbpe.token_stream;

ALTER TABLE hbpe.prediction_log
  DROP CONSTRAINT IF EXISTS prediction_log_bucket_index_check;

ALTER TABLE hbpe.prediction_log
  ADD CONSTRAINT prediction_log_bucket_index_check
  CHECK (bucket_index BETWEEN 0 AND 47);

COMMENT ON COLUMN hbpe.prediction_log.bucket_index IS '0..47 (30-min bucket within the calendar day)';
COMMENT ON COLUMN hbpe.token_stream.bucket_idx IS '0..47 (30-min bucket within the calendar day)';

-- migrate:down
-- Re-widen for 15-minute resolution. Does not restore deleted rows.

ALTER TABLE hbpe.prediction_log
  DROP CONSTRAINT IF EXISTS prediction_log_bucket_index_check;

ALTER TABLE hbpe.prediction_log
  ADD CONSTRAINT prediction_log_bucket_index_check
  CHECK (bucket_index BETWEEN 0 AND 95);

COMMENT ON COLUMN hbpe.prediction_log.bucket_index IS '0..95 (15-min bucket within the calendar day)';
COMMENT ON COLUMN hbpe.token_stream.bucket_idx IS '0..95 (15-min bucket within the calendar day)';
