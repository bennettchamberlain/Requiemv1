-- migrate:up

-- The importers the USER said this run was for — recorded when an upload comes
-- through a wizard service card (the card's importer, or every member importer
-- for a bundle card). NULL means nothing was declared (inbox imports, CLI, API
-- callers, and every run from before this column existed).
--
-- Why: `data_sources` records what the parsers DETECTED, and detection is
-- greedy — a lone readme.md inside an Amazon archive detects as `notion`, a
-- name/email CSV as `contact_list` — so "which services has this user
-- imported?" cannot be answered from detection alone. The picker credits a
-- service from declared ∩ detected when a declaration exists, and only from
-- the dominant detected source when one does not.
ALTER TABLE ci_import.import_runs
  ADD COLUMN declared_sources text[];

-- migrate:down

ALTER TABLE ci_import.import_runs
  DROP COLUMN declared_sources;
