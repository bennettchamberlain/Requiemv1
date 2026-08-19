-- migrate:up
-- Widen HBPE forecast bucket indices for 15-minute resolution (96 buckets/day).

ALTER TABLE hbpe.prediction_log
  DROP CONSTRAINT IF EXISTS prediction_log_bucket_index_check;

ALTER TABLE hbpe.prediction_log
  ADD CONSTRAINT prediction_log_bucket_index_check
  CHECK (bucket_index BETWEEN 0 AND 95);

COMMENT ON COLUMN hbpe.token_stream.bucket_idx IS '0..95 (15-min bucket within the calendar day)';

-- migrate:down
ALTER TABLE hbpe.prediction_log
  DROP CONSTRAINT IF EXISTS prediction_log_bucket_index_check;

ALTER TABLE hbpe.prediction_log
  ADD CONSTRAINT prediction_log_bucket_index_check
  CHECK (bucket_index BETWEEN 0 AND 47);

COMMENT ON COLUMN hbpe.token_stream.bucket_idx IS '0..47 (30-min bucket)';
