-- migrate:up
-- =====================================================================
-- ci.identifier_claims — THE EVIDENCE BEHIND EVERY PERSON LINK
-- =====================================================================
-- Phase 4 of `docs/jobs-system-rebuild-plan.md` (§5.6, §6.2). The table
-- `enrich.person_link` writes, and the reason that stage can exist at all.
--
-- ── The separation this table is for ──────────────────────────────────
--
-- Today a person link is a bare uuid in a column: `ci.communications
-- .from_entity_id`, `.to_entity_ids`, `ci.events.organizer_entity_id`,
-- `.participant_entity_ids`. Four columns that record an ANSWER and nothing
-- about how it was reached. Three consequences, all of them live in this repo:
--
--  1. **A wrong match cannot be corrected, only overwritten.** Nothing records
--     that `dana@example.com` was what caused the row to point at Dana, so
--     re-pointing it destroys the only trace of why it ever pointed anywhere.
--  2. **A LOSING claim is discarded.** `ci.entity_identifiers` is
--     `ON CONFLICT DO NOTHING` on `(owner_user_id, kind, value_normalized)`, so
--     when a second Person turns up carrying an address the first already
--     claimed, the second claim evaporates. That discard is precisely why
--     `PersonDuplicateService` has to `unnest` `properties->'emails'` JSONB
--     arrays instead of grouping the identifier index — the evidence it needs
--     was thrown away at ingest, and its workaround breaks for any writer that
--     populates the index without also writing the redundant JSONB copy.
--  3. **An identifier that resolved to NOBODY leaves no trace at all.** The old
--     backfills simply left the column NULL, which is indistinguishable from
--     "never looked". "5,208 addresses in your corpus belong to no contact" is
--     not a number the appliance can currently produce.
--
-- So: **a claim is EVIDENCE, the column is a PROJECTION of it.** Every
-- identifier the stage observes on a row gets a claim — winning, losing and
-- unresolved alike — and `from_entity_id` / `to_entity_ids` /
-- `organizer_entity_id` / `participant_entity_ids` are recomputed FROM the
-- claims. Correcting a match is then a disposition on a claim, and the
-- observation that caused it survives.
--
-- ── What "append-only" means here, precisely ──────────────────────────
--
-- The set of OBSERVATIONS is append-only. The unique key is
-- `(owner_user_id, subject_type, subject_id, role, kind, value_normalized)` —
-- an observation is identified by what was seen, on which row, in which role.
-- Re-running the stage over a row it has already seen refreshes only the
-- RESOLUTION columns (`entity_id`, `confidence`, `method`, `spec_version`,
-- `stage`), because the identifier index may have gained an entry since.
--
-- Note what that makes free: `value_normalized` is IN the key, so changing the
-- normalisation rule does not rewrite history — the new spelling is a new row
-- and the old row stays exactly as the old spec left it, with the old
-- `spec_version` still on it. That is the whole reason `spec_version` is a
-- column and not part of the key: it records which rule produced a row, and the
-- rule changing already mints a different row whenever it matters.
--
-- `disposition` is the ONE column a human writes and no stage ever does. A
-- rejected claim keeps its row: rejecting a match must not delete the
-- observation that caused it, or the next sweep simply re-derives it.
--
-- ── No auto-merge ─────────────────────────────────────────────────────
--
-- Two entities claiming one identifier is a merge CANDIDATE and never a merge.
-- The candidate query is one GROUP BY over this table (plan §7.1); the merge
-- itself is `ci.entity_merges` and a human. Nothing that writes here may
-- collapse two person rows on its own.
--
-- ── FK policy ─────────────────────────────────────────────────────────
--
-- `owner_user_id` REFERENCES ci.users, like `ci.entity_merges` — this is user
-- data and it should go when the user does. `subject_id` and `entity_id`
-- deliberately have NO foreign key: the graph tables have been FK-less since
-- 20260127185821, and evidence must outlive a hard-deleted row (a claim that
-- named a row someone deleted is exactly the record worth keeping).

CREATE TABLE IF NOT EXISTS ci.identifier_claims (
    claim_id         UUID PRIMARY KEY DEFAULT ci.gen_uuid_v7(),
    owner_user_id    UUID NOT NULL REFERENCES ci.users(id) ON DELETE CASCADE,

    -- WHERE the identifier was observed. `subject_type` uses the same
    -- vocabulary as ci.pipeline_state.entity_type on purpose ('communication',
    -- 'event'), so a claim and the ledger row that produced it are joinable
    -- without a translation table. 'person' is also valid and is what a contact
    -- importer asserts: the entity claiming its OWN identifier, which is the
    -- shape plan §7.1's duplicate-detection GROUP BY reads.
    subject_type     TEXT NOT NULL,
    subject_id       UUID NOT NULL,

    -- Which slot of the subject row the identifier sat in: 'from', 'to', 'cc',
    -- 'bcc', 'organizer', 'participant', 'self'. In the unique key because one
    -- row legitimately carries the same address twice in different roles —
    -- Google Calendar lists the organizer among the attendees on essentially
    -- every event — and collapsing those would lose the fact that makes
    -- organizer_entity_id projectable at all.
    role             TEXT NOT NULL,

    -- WHAT was observed. 'handle' is new in this migration: social identities
    -- (`x:@alice`, `instagram:@bob`) used to classify as 'name', which put a
    -- platform handle into the same namespace as a human display name.
    kind             TEXT NOT NULL
                       CHECK (kind IN ('email', 'phone', 'handle', 'name')),
    -- THE SHARED JOIN KEY, byte-identical to
    -- `ci.entity_identifiers.value_normalized` and to what
    -- `classifyParticipant` computes at every lookup in this repo AND in
    -- CI-Import-Tools. Redefining it here would break people-linking in both
    -- repos silently — no error, no dead letter, just matches that stop
    -- happening — so the widened phone form goes in its own column below.
    value_normalized TEXT NOT NULL,
    -- Strict international form of a phone, when the raw value STATED a
    -- country (`+44…`, `0044…`, `1NXXNXXXXXX`); NULL otherwise, never guessed.
    --
    -- This is the phone widening, and it earns its column by catching a false
    -- identity the shared key cannot: `normalizePhone` keeps the last ten
    -- digits, so UK `+44 20 7946 0958` and US `(207) 946-0958` both normalise
    -- to `2079460958` and become one person. Two claims agreeing on
    -- `value_normalized` and DISAGREEING on `value_e164` are provably different
    -- numbers — one query, and `enrich.person_link` refuses the match outright
    -- (`method = 'phone_country_conflict'`).
    value_e164       TEXT,
    -- What the source actually said, when it differs. Never indexed; this is
    -- for the review UI and for reconstructing a normalisation bug.
    raw_value        TEXT,

    -- WHO it resolves to. NULL is a first-class answer: the identifier was
    -- observed and normalised and matched no person. Those rows are the entire
    -- point of writing losing evidence — they are the triage queue, and they
    -- are what turns "the column stayed NULL" into a countable reason.
    entity_id        UUID,

    -- (0, 1], and NULL exactly when unresolved. Matched to StageResult
    -- .confidence's range so a stage never has to translate. Graded by METHOD,
    -- never invented: an exact email hit is not a display-name hit, and a
    -- fabricated number teaches promotion to prefer a worse answer over a
    -- measured one.
    confidence       REAL,
    -- The rule that DECIDED this claim's resolution — including one that
    -- refused a match: 'email_exact', 'phone_e164', 'phone_last10',
    -- 'phone_country_conflict', 'handle_exact', 'name_exact'. NULL when nothing
    -- in the index came close enough to decide anything. This is what makes
    -- `confidence` auditable rather than a bare float: a later change to the
    -- numbers can find every row a given rule produced.
    method           TEXT,

    -- Provenance. `stage` is the pipeline stage id that wrote the row
    -- ('enrich.person_link'); `source` is the looser linked_table-style
    -- provenance ci.entity_identifiers already uses ('import:google', 'user').
    stage            TEXT,
    source           TEXT,

    -- The normalisation + matching rule generation that produced the
    -- resolution, so a recompute leg can find stale rows with
    -- `WHERE spec_version < $current` — the same shape
    -- domains/identity/types.ts uses for OBJECT identity, which is a different
    -- spec over different inputs and deliberately not shared with this one.
    -- DEFAULT 0, never 1: 0 means "written before the spec was versioned", so
    -- any legacy row is below every live spec and re-qualifies automatically.
    -- Same load-bearing zero as ci.pipeline_state.stage_version.
    spec_version     INTEGER NOT NULL DEFAULT 0,

    -- A HUMAN's verdict, and the only column a stage must never write.
    -- NULL = proposed. CLEAN proposes; a person disposes. A 'rejected' claim is
    -- excluded from the projection but KEEPS its row, so the rejection survives
    -- the next sweep instead of being silently re-derived.
    disposition      TEXT
                       CHECK (disposition IN ('confirmed', 'rejected')),
    disposed_at      TIMESTAMPTZ,

    observed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Confidence is a statement ABOUT a resolution, so it exists exactly when
    -- one does. Enforced rather than commented: a resolved claim with no
    -- confidence would rank below every unresolved one in any ORDER BY, and an
    -- unresolved claim carrying a confidence is a number about nothing.
    CONSTRAINT identifier_claims_confidence_iff_resolved
      CHECK ((entity_id IS NULL) = (confidence IS NULL)),
    CONSTRAINT identifier_claims_confidence_range
      CHECK (confidence IS NULL OR (confidence > 0 AND confidence <= 1)),
    -- A disposition is a human act and must carry its instant, or "when was
    -- this decided, and had they seen the current evidence?" is unanswerable.
    CONSTRAINT identifier_claims_disposed_at_iff_disposed
      CHECK ((disposition IS NULL) = (disposed_at IS NULL))
);

COMMENT ON TABLE ci.identifier_claims IS
  'Every identifier observed on a row, normalised, and what it resolved to. Evidence: the person links on ci.communications / ci.events are a PROJECTION of these rows. Losing and unresolved claims are kept, which is what makes a wrong match correctable and a duplicate detectable.';
COMMENT ON COLUMN ci.identifier_claims.subject_type IS
  'Where the identifier was observed. Shares ci.pipeline_state.entity_type''s vocabulary (communication, event); ''person'' is an entity asserting its own identifier, the shape the duplicate-detection GROUP BY reads.';
COMMENT ON COLUMN ci.identifier_claims.role IS
  'Slot on the subject row: from | to | cc | bcc | organizer | participant | self. In the unique key because an organizer is routinely also an attendee.';
COMMENT ON COLUMN ci.identifier_claims.entity_id IS
  'The person this identifier resolved to, or NULL when it resolved to nobody. A NULL row is not a failure - it is the observation that makes an unlinkable participant countable instead of invisible.';
COMMENT ON COLUMN ci.identifier_claims.value_normalized IS
  'The shared join key, byte-identical to ci.entity_identifiers.value_normalized and to what classifyParticipant computes in this repo and in CI-Import-Tools. Never redefine it here.';
COMMENT ON COLUMN ci.identifier_claims.value_e164 IS
  'Strict international phone form when the raw value stated a country, else NULL — never guessed. Two claims sharing value_normalized but disagreeing here are provably different numbers, which is the false identity the last-ten-digits key cannot see.';
COMMENT ON COLUMN ci.identifier_claims.confidence IS
  'Graded by method, in (0, 1], NULL exactly when unresolved. An exact email match is not a display-name match; never fabricate one.';
COMMENT ON COLUMN ci.identifier_claims.method IS
  'The rule that decided the resolution, including one that REFUSED a match (phone_country_conflict). What makes confidence auditable instead of a bare float.';
COMMENT ON COLUMN ci.identifier_claims.spec_version IS
  'Normalisation + matching rule generation behind the resolution. 0 = predates spec versioning, so it is below every live spec and re-qualifies. Not part of the unique key: value_normalized already is, so a rule change that matters mints a new row by itself.';
COMMENT ON COLUMN ci.identifier_claims.disposition IS
  'A human verdict: confirmed | rejected | NULL (proposed). The one column no stage writes. A rejected claim keeps its row so the rejection is not re-derived away on the next sweep.';

-- Identity of an OBSERVATION, and the ON CONFLICT target the stage upserts
-- against. Ordered subject-first because the projection reads "every claim on
-- this row" — that is the query the stage runs on every slice, and it is an
-- index lookup only if the leading columns are the ones it binds.
CREATE UNIQUE INDEX IF NOT EXISTS identifier_claims_observation_uniq
    ON ci.identifier_claims (owner_user_id, subject_type, subject_id, role, kind, value_normalized);

-- Plan §7.1's duplicate-detection GROUP BY, and the "who is this address?"
-- lookup behind the review UI. One identifier resolving to more than one entity
-- IS the merge candidate; this index is what makes finding them one scan.
CREATE INDEX IF NOT EXISTS identifier_claims_lookup_idx
    ON ci.identifier_claims (owner_user_id, kind, value_normalized);

-- The reverse: every piece of evidence behind one person. Partial, so it holds
-- only resolved claims — which on a fresh corpus is the minority.
CREATE INDEX IF NOT EXISTS identifier_claims_entity_idx
    ON ci.identifier_claims (entity_id)
    WHERE entity_id IS NOT NULL;

-- The triage queue: identifiers that belong to nobody. Partial and therefore
-- self-shrinking as contacts arrive, exactly like the pipeline's unreplayed
-- dead-letter index. This is the index behind the number the appliance has
-- never been able to give.
CREATE INDEX IF NOT EXISTS identifier_claims_unresolved_idx
    ON ci.identifier_claims (owner_user_id, kind, value_normalized)
    WHERE entity_id IS NULL;

-- ---------------------------------------------------------------------
-- ci.entity_identifiers — confidence, spec_version, and 'handle'
-- ---------------------------------------------------------------------
-- The index that answers "which person owns this address?" has never recorded
-- how sure it is or which rule produced the value it stores. Both are needed
-- now that a claim carries them: without `confidence` the index cannot say
-- whether a row came from a user's own assertion or a display-name guess, and
-- without `spec_version` a normalisation change has no way to find the rows it
-- invalidated — the same defect `ci.pipeline_state.stage_version` fixed for
-- stages.

ALTER TABLE ci.entity_identifiers
  ADD COLUMN IF NOT EXISTS confidence   REAL,
  ADD COLUMN IF NOT EXISTS spec_version INTEGER NOT NULL DEFAULT 0;

-- Deliberately NOT backfilled. Existing rows were written by a path that never
-- measured a confidence, and stamping them with a plausible-looking number
-- would be exactly the fabrication the pipeline's StageResult.confidence
-- forbids: an invented 0.9 outranks a genuinely-measured 0.8 forever. NULL
-- means unstated, and `spec_version = 0` means "below every live spec", so the
-- recompute leg picks them up on its own.
ALTER TABLE ci.entity_identifiers
  DROP CONSTRAINT IF EXISTS entity_identifiers_confidence_range;
ALTER TABLE ci.entity_identifiers
  ADD CONSTRAINT entity_identifiers_confidence_range
    CHECK (confidence IS NULL OR (confidence > 0 AND confidence <= 1));

COMMENT ON COLUMN ci.entity_identifiers.confidence IS
  'How sure the writer was, in (0, 1]. NULL = unstated, which is what every row written before this column carries. Never backfilled with a guess.';
COMMENT ON COLUMN ci.entity_identifiers.spec_version IS
  'Normalisation rule generation behind value_normalized. 0 = predates spec versioning, so `spec_version < $current` re-opens the row for recompute. Same load-bearing zero as ci.pipeline_state.stage_version.';

-- 'handle' joins the kind vocabulary. `classifyParticipant` routes an @handle
-- to 'name' today, so an Instagram/X/Reddit identity lands in the same
-- namespace as a human display name and two unrelated people who both go by
-- "alex" collide with each other AND with the handle. Widened here rather than
-- in the claims table alone, because a handle that can be claimed but never
-- indexed is a handle nothing can ever resolve.
--
-- Same shape as 20260707120000_entity_identifiers_allow_name_kind, which had to
-- widen this CHECK for 'name' after every such write had been silently failing
-- the constraint for months.
ALTER TABLE ci.entity_identifiers
  DROP CONSTRAINT IF EXISTS entity_identifiers_kind_check;
ALTER TABLE ci.entity_identifiers
  ADD CONSTRAINT entity_identifiers_kind_check
    CHECK (kind IN ('email', 'phone', 'handle', 'name'));

-- migrate:down
-- Restoring the narrower CHECK requires removing the rows it would reject —
-- the same trade 20260707120000 made for 'name'.
DELETE FROM ci.entity_identifiers WHERE kind = 'handle';
ALTER TABLE ci.entity_identifiers
  DROP CONSTRAINT IF EXISTS entity_identifiers_kind_check;
ALTER TABLE ci.entity_identifiers
  ADD CONSTRAINT entity_identifiers_kind_check
    CHECK (kind IN ('email', 'phone', 'name'));

ALTER TABLE ci.entity_identifiers
  DROP CONSTRAINT IF EXISTS entity_identifiers_confidence_range;
ALTER TABLE ci.entity_identifiers
  DROP COLUMN IF EXISTS spec_version,
  DROP COLUMN IF EXISTS confidence;

DROP INDEX IF EXISTS ci.identifier_claims_unresolved_idx;
DROP INDEX IF EXISTS ci.identifier_claims_entity_idx;
DROP INDEX IF EXISTS ci.identifier_claims_lookup_idx;
DROP INDEX IF EXISTS ci.identifier_claims_observation_uniq;
DROP TABLE IF EXISTS ci.identifier_claims;
