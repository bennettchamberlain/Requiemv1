-- migrate:up

-- Which services a run actually turned out to contain.
--
-- The run list only ever had the uploaded archive's filename to show, so a run
-- read as "All Data Categories.zip" rather than as Audible, Prime Video and
-- Kindle. CI-Import-Tools knew the service because the user picked its card
-- before uploading; here a single archive legitimately spans several parsers
-- (that one stages `amazon`, `audible`, `prime_video`, `kindle_reading`,
-- `amazon_music`, `notion` and `generic` together), so the service is DETECTED
-- rather than declared — which is strictly better information, and there can be
-- more than one.
--
-- Written by the parse stage, ordered most rows first, so the list can name a
-- run without joining its stages or reading their JSON detail.
--
-- Empty rather than null for a run that has not parsed yet, so readers do not
-- have to distinguish "no services" from "not known yet" — the run's status
-- already says which.
ALTER TABLE ci_import.import_runs
  ADD COLUMN data_sources TEXT[] NOT NULL DEFAULT '{}';

-- migrate:down

ALTER TABLE ci_import.import_runs
  DROP COLUMN data_sources;
