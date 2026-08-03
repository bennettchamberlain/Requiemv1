-- migrate:up
-- #1810 Better representation of People. Three schema moves:
--
-- 1. ci.entity_identifiers grows from a bare normalized-lookup into a real
--    contact-method table: the original raw value, a user-facing label
--    (work/home/mobile), a primary flag, per-identifier provenance and a
--    verification timestamp. (owner_user_id, kind, value_normalized) stays the
--    resolution key — nothing about matching changes.
--
-- 2. Merge machinery: the same human imported from different sources (a
--    contacts import, a communications-participant stub, a face tag) lands as
--    separate ci.entities rows with no way to converge. merged_into_entity_id
--    turns the loser into a tombstone that points at the canonical row, and
--    ci.entity_merges is the audit log a merge (or future unmerge) reads.
--    Re-pointing of dependent rows (identifiers, communications, events,
--    relationships) is done in-service at merge time.
--
-- 3. Missing index: ci.communications.to_entity_ids has a GIN index but
--    ci.events.participant_entity_ids never got one, so "events with person X"
--    is a seq scan. Also drops ci.users.person_entity_id — a dead duplicate of
--    ci.users.entity_id from 20250925144200_enhance_users that no code reads.

ALTER TABLE ci.entity_identifiers
  ADD COLUMN IF NOT EXISTS raw_value TEXT,
  ADD COLUMN IF NOT EXISTS label TEXT,
  ADD COLUMN IF NOT EXISTS is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS source TEXT,
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;

COMMENT ON COLUMN ci.entity_identifiers.raw_value IS
  'Original identifier as asserted by the source (pre-normalization), e.g. "Dana Q. <dana@x.com>". Nullable: rows created before this column, or callers that only had the normalized form.';
COMMENT ON COLUMN ci.entity_identifiers.label IS
  'User-facing label for the contact method (work, home, mobile, ...). Free text.';
COMMENT ON COLUMN ci.entity_identifiers.is_primary IS
  'Preferred contact method of this kind for the entity. At most one per (entity_id, kind) is enforced in-service, not by constraint.';
COMMENT ON COLUMN ci.entity_identifiers.source IS
  'Provenance of the assertion, linked_table-style (import:google, import:communications:participant, user).';
COMMENT ON COLUMN ci.entity_identifiers.verified_at IS
  'When the user explicitly confirmed this identifier belongs to this entity. NULL = unverified (machine-asserted).';

-- 2. Merge pointer + audit log ---------------------------------------------

ALTER TABLE ci.entities
  ADD COLUMN IF NOT EXISTS merged_into_entity_id UUID
    REFERENCES ci.entities(entity_id) ON DELETE SET NULL;

COMMENT ON COLUMN ci.entities.merged_into_entity_id IS
  'Non-NULL marks this row as a merge tombstone: reads should follow the pointer to the canonical entity. Set by the person/place merge flow together with is_active = FALSE.';

CREATE INDEX IF NOT EXISTS entities_merged_into_idx
  ON ci.entities (merged_into_entity_id)
  WHERE merged_into_entity_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS ci.entity_merges (
    merge_id         UUID PRIMARY KEY DEFAULT ci.gen_uuid_v7(),
    owner_user_id    UUID NOT NULL REFERENCES ci.users(id) ON DELETE CASCADE,
    -- No FKs on the entity columns: the graph tables are deliberately FK-less
    -- (20260127185821) and the log must survive a later hard-delete of either row.
    source_entity_id UUID NOT NULL,
    target_entity_id UUID NOT NULL,
    entity_type      TEXT NOT NULL,
    -- Counts of re-pointed rows per dependent table, the surviving identifier
    -- set, and anything else a future unmerge would need.
    details          JSONB NOT NULL DEFAULT '{}',
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS entity_merges_owner_idx
  ON ci.entity_merges (owner_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS entity_merges_target_idx
  ON ci.entity_merges (target_entity_id);

-- 3. Missing person-link index + dead column -------------------------------

CREATE INDEX IF NOT EXISTS events_participants_gin_idx
  ON ci.events USING GIN (participant_entity_ids)
  WHERE participant_entity_ids IS NOT NULL;

ALTER TABLE ci.users
  DROP COLUMN IF EXISTS person_entity_id;

-- migrate:down
ALTER TABLE ci.users
  ADD COLUMN IF NOT EXISTS person_entity_id UUID;

DROP INDEX IF EXISTS ci.events_participants_gin_idx;

DROP INDEX IF EXISTS ci.entity_merges_target_idx;
DROP INDEX IF EXISTS ci.entity_merges_owner_idx;
DROP TABLE IF EXISTS ci.entity_merges;

DROP INDEX IF EXISTS ci.entities_merged_into_idx;
ALTER TABLE ci.entities
  DROP COLUMN IF EXISTS merged_into_entity_id;

ALTER TABLE ci.entity_identifiers
  DROP COLUMN IF EXISTS verified_at,
  DROP COLUMN IF EXISTS source,
  DROP COLUMN IF EXISTS is_primary,
  DROP COLUMN IF EXISTS label,
  DROP COLUMN IF EXISTS raw_value;
