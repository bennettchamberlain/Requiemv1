-- Support for the three CLEAN stages.
--
-- The governing rule for this phase: a cleaner may not destroy data. Every
-- correction here is written ALONGSIDE what it corrects, never over it, because
-- a cleaner whose output cannot be undone is worse than the dirt it removed.
-- That is why `start_time_original` exists rather than a simple in-place UPDATE.

-- migrate:up

-- clean.temporal_repair -------------------------------------------------------
--
-- Two documented defects produce wrong times today. `TransformGoogleCalendar`
-- declares `start.timeZone` and never reads it, so a bare date becomes UTC
-- midnight and a floating date-time becomes HOST-local. And an undated record is
-- stamped with the import run's wall clock, which is why a handful of Google
-- Maps saved places sit at the top of the timeline dated the day of the import.
--
-- `time_source` records WHERE a timestamp came from and `time_precision` how
-- much of it to believe; `*_original` preserves what we replaced so the repair
-- is reversible and auditable. This is the stage most likely to surprise a user
-- — it MOVES DATES THEY HAVE ALREADY SEEN — so "which dates did we move?" has to
-- be answerable.
ALTER TABLE ci.events
  ADD COLUMN IF NOT EXISTS time_source         TEXT,
  ADD COLUMN IF NOT EXISTS time_precision      TEXT,
  ADD COLUMN IF NOT EXISTS start_time_original TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS end_time_original   TIMESTAMPTZ;

COMMENT ON COLUMN ci.events.time_source IS
  'Provenance of start_time: source (the export said so) | user | repaired (clean.temporal_repair) | ingest (stamped at import, i.e. not a real date).';
COMMENT ON COLUMN ci.events.start_time_original IS
  'The value clean.temporal_repair replaced. NULL means never repaired. Keeps the repair reversible.';

-- NOT VALID: validating would scan ci.events (324k rows on a live appliance)
-- while holding a lock, inside dbmate's transaction, with migrate-database
-- gating api startup. New and updated rows are still checked. Validate out of
-- band with ALTER TABLE ... VALIDATE CONSTRAINT when convenient.
ALTER TABLE ci.events
  ADD CONSTRAINT events_time_source_check
  CHECK (time_source IS NULL OR time_source IN ('source', 'user', 'repaired', 'ingest')) NOT VALID;

ALTER TABLE ci.events
  ADD CONSTRAINT events_time_precision_check
  CHECK (time_precision IS NULL OR time_precision IN ('second', 'minute', 'day', 'ambiguous', 'unknown')) NOT VALID;

-- Partial, and self-shrinking: it indexes only rows a repair actually touched,
-- so it costs nothing on a corpus with no repairs and answers "what did we move?"
-- directly.
CREATE INDEX IF NOT EXISTS events_time_repaired_idx
  ON ci.events (user_id, start_time)
  WHERE start_time_original IS NOT NULL;

-- clean.identifier_normalize --------------------------------------------------
--
-- The E.164 form lives ALONGSIDE the stored value rather than replacing it.
-- `value` is a join key that existing rows already point at; rewriting it in
-- place would silently break every reference for the sake of formatting.
ALTER TABLE ci.entity_identifiers
  ADD COLUMN IF NOT EXISTS value_e164 TEXT;

COMMENT ON COLUMN ci.entity_identifiers.value_e164 IS
  'Phone identifiers in E.164. Written beside value, never over it — value is a join key existing rows depend on.';

CREATE INDEX IF NOT EXISTS entity_identifiers_e164_idx
  ON ci.entity_identifiers (owner_user_id, value_e164)
  WHERE value_e164 IS NOT NULL;

-- clean.duplicate_detect ------------------------------------------------------
--
-- PROPOSALS, not merges. The decision on record is that CLEAN proposes and a
-- human disposes, so this table is the queue a person reviews — the stage never
-- collapses two entities on its own.
--
-- `entity_id_a < entity_id_b` plus the unique index make re-proposing the same
-- pair idempotent regardless of which order the detector encountered them, so a
-- re-run after a version bump rescores rather than duplicating. A pair a human
-- rejected stays rejected: the stage updates score and evidence, never status.
CREATE TABLE IF NOT EXISTS ci.merge_candidates (
    merge_candidate_id UUID PRIMARY KEY DEFAULT ci.gen_uuid_v7(),
    owner_user_id      UUID NOT NULL REFERENCES ci.users(id) ON DELETE CASCADE,
    entity_type        TEXT NOT NULL,
    entity_id_a        UUID NOT NULL,
    entity_id_b        UUID NOT NULL,
    score              DOUBLE PRECISION NOT NULL,
    evidence           JSONB NOT NULL DEFAULT '[]'::jsonb,
    status             TEXT NOT NULL DEFAULT 'pending',
    detected_by        TEXT NOT NULL,
    detector_version   INTEGER NOT NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT merge_candidates_ordered      CHECK (entity_id_a < entity_id_b),
    CONSTRAINT merge_candidates_status_check CHECK (status IN ('pending', 'accepted', 'rejected')),
    CONSTRAINT merge_candidates_score_check  CHECK (score > 0 AND score <= 1)
);

COMMENT ON TABLE ci.merge_candidates IS
  'Proposed duplicate entities awaiting human review. CLEAN proposes; it never merges. Ordered pair + unique index make re-proposal idempotent.';

CREATE UNIQUE INDEX IF NOT EXISTS merge_candidates_pair_uniq
  ON ci.merge_candidates (owner_user_id, entity_type, entity_id_a, entity_id_b);

CREATE INDEX IF NOT EXISTS merge_candidates_review_idx
  ON ci.merge_candidates (owner_user_id, status, score DESC);

-- migrate:down

DROP INDEX IF EXISTS ci.merge_candidates_review_idx;
DROP INDEX IF EXISTS ci.merge_candidates_pair_uniq;
DROP TABLE IF EXISTS ci.merge_candidates;

DROP INDEX IF EXISTS ci.entity_identifiers_e164_idx;
ALTER TABLE ci.entity_identifiers DROP COLUMN IF EXISTS value_e164;

DROP INDEX IF EXISTS ci.events_time_repaired_idx;
ALTER TABLE ci.events DROP CONSTRAINT IF EXISTS events_time_precision_check;
ALTER TABLE ci.events DROP CONSTRAINT IF EXISTS events_time_source_check;
ALTER TABLE ci.events
  DROP COLUMN IF EXISTS end_time_original,
  DROP COLUMN IF EXISTS start_time_original,
  DROP COLUMN IF EXISTS time_precision,
  DROP COLUMN IF EXISTS time_source;
