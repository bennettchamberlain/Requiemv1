-- migrate:up
-- =====================================================================
-- ci_import — STAGING SCHEMA FOR THE ARCHIVE IMPORTER
-- =====================================================================
-- The importer ported from CI-Import-Tools keeps its two-phase shape:
--
--   unpack → parse (writes staged_*) → push (fans out into ci.*)
--
-- Upstream, phase one wrote a local SQLite file and phase two shipped it to
-- CI-Server over HTTP. Here both phases are PGBoss jobs in this process, so the
-- staging store becomes these tables and the push calls the ingest services
-- in-process. The split is worth keeping anyway: parsing a 40GB Google Takeout
-- is slow and re-runnable, pushing is transactional and resumable, and a run
-- that dies between them resumes from staged rows instead of re-reading the
-- archive.
--
-- STAGING IS RUN-SCOPED. Every staged_* row belongs to exactly one import_runs
-- row and dies with it (ON DELETE CASCADE). These tables are a scratchpad for
-- one run, not a second copy of the user's data — cross-run and cross-source
-- deduplication is ci.*'s job (content_sha256, identifier claims, entity
-- resolution), and duplicating that logic here is how the two would drift.
-- What IS enforced here is WITHIN-run dedup, which is a parser contract: a
-- photo library replicates the same file into every album folder it belongs
-- to, and those must collapse to one staged item.
--
-- NO POSTGRES ENUMS in this schema, and no cross-schema foreign keys to
-- ci.users. Enums: the connection runs with `search_path=ci,public`
-- (application.ts) and TypeORM emits user-defined types UNqualified in casts,
-- so a `ci_import.*` enum type would not resolve at runtime — TEXT + CHECK
-- instead. FKs to ci.users: same reasoning as the pipeline control plane
-- (20260809032723) — an import must stay writable for a user row that is mid-
-- repair, and ci_etl already set this precedent.

CREATE SCHEMA IF NOT EXISTS ci_import;

COMMENT ON SCHEMA ci_import IS
  'Staging tables for the archive importer. Run-scoped scratch space between parsing an export and pushing it into ci.*; holds no durable user data of its own.';

-- ---------------------------------------------------------------------
-- ci_import.import_runs — one user-initiated import.
-- ---------------------------------------------------------------------
-- The run/stage spine is deliberately SEPARATE from pg-boss and from ci.
-- pipeline_runs. pg-boss holds the work; /jobs renders pg-boss for an operator.
-- This pair is the user-facing "your Google Takeout is 60% imported" surface,
-- with a stage vocabulary that means something to the person who uploaded the
-- file. Merging the two surfaces has been considered and rejected — they answer
-- different questions for different audiences.
CREATE TABLE IF NOT EXISTS ci_import.import_runs (
    id               UUID PRIMARY KEY DEFAULT ci.gen_uuid_v7(),
    user_id          UUID NOT NULL,

    -- Human label for the run list, e.g. the uploaded archive's filename.
    label            TEXT,

    -- Which surface started it. 'wizard' is the import UI, 'mcp' the
    -- import_path tool, 'api' a direct POST.
    source           TEXT NOT NULL DEFAULT 'wizard'
                       CHECK (source IN ('wizard', 'api', 'mcp')),

    -- Rollup CACHE over import_stages, not the source of truth. 'partial' is a
    -- real terminal state and not a synonym for failure: an export that holds
    -- six sources where one parser choked still imported the other five, and
    -- reporting that as 'failed' is what teaches people to re-run the whole
    -- 40GB archive.
    status           TEXT NOT NULL DEFAULT 'queued'
                       CHECK (status IN ('queued', 'running', 'completed', 'failed', 'partial', 'cancelled')),

    -- Weighted rollup cache, 0..100. Cached because the honest computation
    -- joins every stage and the run list renders dozens of rows at a time.
    percent          SMALLINT NOT NULL DEFAULT 0
                       CHECK (percent BETWEEN 0 AND 100),

    -- The stage kinds this run intends to execute, in order. Recorded up front
    -- so the UI can draw the whole stage bar (including not-yet-created
    -- stages) on the first poll rather than growing it a box at a time.
    requested_stages TEXT[] NOT NULL DEFAULT '{}',

    error            TEXT,

    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at       TIMESTAMPTZ,
    finished_at      TIMESTAMPTZ
);

COMMENT ON TABLE ci_import.import_runs IS
  'One user-initiated import. The user-facing progress surface; pg-boss (and /jobs) remain the operator-facing worker layer.';
COMMENT ON COLUMN ci_import.import_runs.status IS
  'queued | running | completed | failed | partial | cancelled. A derived cache over import_stages. partial = some stages succeeded and some did not, which is a normal outcome for a multi-source export.';
COMMENT ON COLUMN ci_import.import_runs.percent IS
  'Weighted rollup cache 0..100, maintained by the stage runners. Never compute a ratio from a single stage''s counters for the run as a whole.';
COMMENT ON COLUMN ci_import.import_runs.requested_stages IS
  'Stage kinds this run intends to execute, in order, so the UI can draw the full stage bar before the later stages exist as rows.';

-- Run list: this user's imports, newest first.
CREATE INDEX IF NOT EXISTS import_runs_user_created_idx
    ON ci_import.import_runs (user_id, created_at DESC);

-- "Is anything importing right now?" — polled by the UI on every tick, so it
-- gets a partial index that holds only live runs rather than the whole history.
CREATE INDEX IF NOT EXISTS import_runs_active_idx
    ON ci_import.import_runs (user_id)
    WHERE finished_at IS NULL;

-- ---------------------------------------------------------------------
-- ci_import.import_stages — the steps of a run.
-- ---------------------------------------------------------------------
-- `processed` has ONE meaning across every kind: units of this stage's own work
-- finished so far, with `total` as the denominator. Upstream this was read off
-- the worker's item counter, which silently changed meaning per stage and made
-- the progress bar jump backwards between them.
CREATE TABLE IF NOT EXISTS ci_import.import_stages (
    id            UUID PRIMARY KEY DEFAULT ci.gen_uuid_v7(),
    run_id        UUID NOT NULL REFERENCES ci_import.import_runs(id) ON DELETE CASCADE,

    -- Deterministic display order within the run.
    seq           SMALLINT NOT NULL,

    -- CHECKed because this vocabulary is closed by construction: it is the
    -- importer's own three-step pipeline, and the stage bar in the UI draws one
    -- box per value. Everything downstream of the push (graph extraction,
    -- search indexing) belongs to ci-server's own pipeline control plane and is
    -- deliberately NOT re-modelled here.
    kind          TEXT NOT NULL
                    CHECK (kind IN ('unpack', 'parse', 'push')),

    status        TEXT NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued', 'running', 'completed', 'failed', 'skipped', 'cancelled')),

    -- Sub-label within a stage ('parsing', 'hashing', 'uploading', …). Free
    -- TEXT, unlike kind: it is a cosmetic detail line that will grow with every
    -- new datasource, and a CHECK on it buys nothing but migrations.
    phase         TEXT,

    processed     BIGINT NOT NULL DEFAULT 0,
    -- NULL denominator means "not countable yet" and the UI must render an
    -- indeterminate bar. Not 0 — a 0/0 bar reads as a finished stage.
    total         BIGINT,

    -- Relative cost of this stage in the run's weighted percent rollup. Parsing
    -- a mailbox and unpacking the zip that held it are not the same size of job.
    weight        SMALLINT NOT NULL DEFAULT 0,

    items_per_sec DOUBLE PRECISION,
    eta_seconds   INTEGER,
    duration_ms   BIGINT,

    -- Per-kind typed breakout: counts by datasource, the drop ledger
    -- ({"dedup": 12, "unsupported_variant": 4}), destination tallies.
    detail        JSONB NOT NULL DEFAULT '{}',
    error         TEXT,

    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at    TIMESTAMPTZ,
    finished_at   TIMESTAMPTZ,

    -- Identity of a stage within its run, and the ON CONFLICT target that makes
    -- materializing a run's stages idempotent after a restart.
    UNIQUE (run_id, seq)
);

COMMENT ON TABLE ci_import.import_stages IS
  'One step of an import run (unpack | parse | push). The row the progress UI renders; the pg-boss job that does the work points back at it.';
COMMENT ON COLUMN ci_import.import_stages.processed IS
  'Units of THIS stage''s work completed. One consistent meaning across kinds, with total as the denominator — never mix in a worker''s own item counter.';
COMMENT ON COLUMN ci_import.import_stages.total IS
  'Denominator, or NULL when not yet countable. NULL must render as an indeterminate bar; 0 would render as a completed one.';
COMMENT ON COLUMN ci_import.import_stages.detail IS
  'Typed per-kind JSON: counts by datasource, the drop ledger keyed by reason slug, destination tallies for the push.';

-- ---------------------------------------------------------------------
-- ci_import.staged_items — parsed records awaiting push.
-- ---------------------------------------------------------------------
-- One row per Item emitted by a datasource parser. Column-for-column this is
-- the upstream SQLite `items` table, with `timestamp` renamed to `occurred_at`
-- (the original collides with the type name and needs quoting everywhere) and
-- the TEXT primary key demoted to `content_hash`.
CREATE TABLE IF NOT EXISTS ci_import.staged_items (
    id                    UUID PRIMARY KEY DEFAULT ci.gen_uuid_v7(),
    run_id                UUID NOT NULL REFERENCES ci_import.import_runs(id) ON DELETE CASCADE,
    -- Denormalized from the run so the push can filter without a join, and so a
    -- stray row is still attributable if its run is gone.
    user_id               UUID NOT NULL,

    data_source           TEXT NOT NULL,
    classification        TEXT,

    -- The parser's own id for the record when it assigned one (a Gmail message
    -- id), otherwise a sha1 over CONTENT-DERIVED fields only — never the file
    -- path. Hashing the path is what made one photo replicated across three
    -- album folders persist as three items and reach the server as three
    -- events; see timeline/persistence hashItem upstream.
    content_hash          TEXT NOT NULL,

    occurred_at           TIMESTAMPTZ,
    timespan_end          TIMESTAMPTZ,

    -- Plain doubles rather than a PostGIS geography: staging is dumb, and the
    -- push converts on the way into ci.positions. The range CHECKs catch a
    -- lat/lon swap at the door, where the offending parser is still obvious.
    latitude              DOUBLE PRECISION CHECK (latitude BETWEEN -90 AND 90),
    longitude             DOUBLE PRECISION CHECK (longitude BETWEEN -180 AND 180),

    filename              TEXT,
    media_type            TEXT,
    -- Where the record came from at the source (a URL, a mailbox path) versus
    -- where its bytes currently sit in the unpacked archive on local disk.
    original_location     TEXT,
    intermediate_location TEXT,

    metadata              JSONB NOT NULL DEFAULT '{}',

    -- Fingerprint of the item's bytes, computed at parse time when the file is
    -- on disk. NULL for records that carry no file at all (a transaction, a
    -- calendar entry).
    content_sha256        TEXT,
    size_bytes            BIGINT,

    -- ── push state ──────────────────────────────────────────────────────
    -- Per-row rather than a cursor into the table. A cursor assumes rows push
    -- in a fixed order and that a failure is fatal to everything after it;
    -- per-row state lets one poisoned record be marked 'failed' while the rest
    -- of the run completes, and makes a resumed push cost O(remaining).
    push_status           TEXT NOT NULL DEFAULT 'pending'
                            CHECK (push_status IN ('pending', 'pushed', 'skipped', 'failed')),
    push_error            TEXT,
    pushed_at             TIMESTAMPTZ,
    -- What the push created downstream, e.g. {"kind": "content", "id": "…"}.
    -- The item-side counterpart of entity_mappings: an item↔item edge can only
    -- be written into ci.* once BOTH endpoints have server ids.
    pushed_ref            JSONB,

    created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE ci_import.staged_items IS
  'One parsed record awaiting push, scoped to its run. Deleted with the run — cross-run dedup belongs to ci.*, not here.';
COMMENT ON COLUMN ci_import.staged_items.content_hash IS
  'Parser-assigned record id, or a sha1 over content-derived fields (never the file path, so album-replicated copies of one photo collapse). Unique per (run, data_source).';
COMMENT ON COLUMN ci_import.staged_items.intermediate_location IS
  'Current path of the bytes in the unpacked archive on local disk. original_location is the record''s address at the SOURCE and is not a local path.';
COMMENT ON COLUMN ci_import.staged_items.push_status IS
  'pending | pushed | skipped | failed, per row. Lets a resumed push skip finished rows and quarantine a poisoned one instead of stalling the run behind it.';
COMMENT ON COLUMN ci_import.staged_items.pushed_ref IS
  'The ci.* record this item became. Needed to wire item-to-item edges, which can only be written once both endpoints have server ids.';

-- WITHIN-run dedup, the parser contract described in the schema header. Scoped
-- to (run, data_source) and not to the user: the same photo arriving from two
-- different sources is two legitimate staged rows, and it is ci.*'s
-- content_sha256 handling that decides whether they are one thing.
CREATE UNIQUE INDEX IF NOT EXISTS staged_items_run_source_hash_uniq
    ON ci_import.staged_items (run_id, data_source, content_hash);

-- The push queue. Partial, so it shrinks to nothing as the run drains rather
-- than staying the size of the whole import.
CREATE INDEX IF NOT EXISTS staged_items_pending_push_idx
    ON ci_import.staged_items (run_id, id)
    WHERE push_status = 'pending';

-- Cross-source byte-identity lookup within a run: "does another datasource in
-- this same archive already hold these exact bytes?". Partial because most
-- records carry no file and hashing nothing is not a match.
CREATE INDEX IF NOT EXISTS staged_items_sha256_idx
    ON ci_import.staged_items (run_id, content_sha256)
    WHERE content_sha256 IS NOT NULL;

-- ---------------------------------------------------------------------
-- ci_import.staged_entities — people, places and things the parsers saw.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ci_import.staged_entities (
    id            UUID PRIMARY KEY DEFAULT ci.gen_uuid_v7(),
    run_id        UUID NOT NULL REFERENCES ci_import.import_runs(id) ON DELETE CASCADE,
    user_id       UUID NOT NULL,

    type          TEXT,
    name          TEXT,
    metadata      JSONB NOT NULL DEFAULT '{}',

    -- The normalized handle this entity is known by: lower-cased email, or the
    -- last ten digits of a phone number. Identity has to key on WHO someone is,
    -- because the display name drifts across sources — "Alice", "Alice Smith"
    -- and the bare address are one person and must not become three contacts.
    -- NULL for entities that have no handle at all (threads, places).
    identity_key  TEXT,

    -- Set when an already-staged entity's metadata GREW after a later sighting
    -- (see the accumulate[] contract on Entity). The push resumes from a
    -- high-water mark, so without this flag a row that changed after it was
    -- already sent would never be revisited.
    graph_dirty   BOOLEAN NOT NULL DEFAULT false,

    push_status   TEXT NOT NULL DEFAULT 'pending'
                    CHECK (push_status IN ('pending', 'pushed', 'skipped', 'failed')),
    push_error    TEXT,
    pushed_at     TIMESTAMPTZ,

    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE ci_import.staged_entities IS
  'Entities emitted by the parsers during one run, deduped on identity_key where the entity has a handle.';
COMMENT ON COLUMN ci_import.staged_entities.identity_key IS
  'Normalized email/phone handle. Dedup keys on this rather than the display name, which drifts across sources for one real person.';
COMMENT ON COLUMN ci_import.staged_entities.graph_dirty IS
  'Metadata grew after this row was already pushed. The push sweeps from a high-water mark, so a changed row is only revisited because of this flag.';

-- Identity dedup, and the ON CONFLICT target the parser upserts against.
-- Partial: handle-less entities (threads, places) all have a NULL key and must
-- not collapse into each other.
CREATE UNIQUE INDEX IF NOT EXISTS staged_entities_run_identity_uniq
    ON ci_import.staged_entities (run_id, identity_key)
    WHERE identity_key IS NOT NULL;

-- Fallback lookup for handle-less entities, matching upstream's
-- COALESCE(type,'') / COALESCE(name,'') probe. Deliberately NOT unique: the
-- upstream probe took the first match rather than enforcing one, and promoting
-- that to a constraint here would reject rows the parsers legitimately emit.
CREATE INDEX IF NOT EXISTS staged_entities_run_type_name_idx
    ON ci_import.staged_entities (run_id, type, name);

CREATE INDEX IF NOT EXISTS staged_entities_pending_push_idx
    ON ci_import.staged_entities (run_id, id)
    WHERE push_status = 'pending';

-- The dirty sweep. Partial and therefore empty in steady state.
CREATE INDEX IF NOT EXISTS staged_entities_dirty_idx
    ON ci_import.staged_entities (run_id)
    WHERE graph_dirty;

-- ---------------------------------------------------------------------
-- ci_import.staged_relationships — the edges.
-- ---------------------------------------------------------------------
-- A row carries EITHER entity_id (item→entity, e.g. email→sender) OR
-- related_item_id (item→item, e.g. email→attachment, photo→album), never both
-- and never neither. Upstream this was a convention that consumers had to know;
-- num_nonnulls makes it a constraint, and a query that joins on entity_id still
-- skips item↔item rows naturally.
CREATE TABLE IF NOT EXISTS ci_import.staged_relationships (
    id              UUID PRIMARY KEY DEFAULT ci.gen_uuid_v7(),
    run_id          UUID NOT NULL REFERENCES ci_import.import_runs(id) ON DELETE CASCADE,

    item_id         UUID NOT NULL REFERENCES ci_import.staged_items(id) ON DELETE CASCADE,
    entity_id       UUID REFERENCES ci_import.staged_entities(id) ON DELETE CASCADE,
    related_item_id UUID REFERENCES ci_import.staged_items(id) ON DELETE CASCADE,

    relation        TEXT,
    metadata        JSONB NOT NULL DEFAULT '{}',

    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT staged_relationships_one_target
        CHECK (num_nonnulls(entity_id, related_item_id) = 1)
);

COMMENT ON TABLE ci_import.staged_relationships IS
  'Edges from a staged item to either an entity or another item — exactly one of the two, enforced by staged_relationships_one_target.';

-- Idempotent edge writes. Upstream did a SELECT-then-INSERT with `relation IS ?`
-- so that a NULL relation matched its own prior row; NULLS NOT DISTINCT is that
-- semantic as a constraint, which also makes the write a plain ON CONFLICT.
-- Two partial indexes rather than one combined: a single index over both target
-- columns would see every item→item row as (item_id, NULL, relation) and
-- collapse edges that point at different items.
CREATE UNIQUE INDEX IF NOT EXISTS staged_relationships_item_entity_uniq
    ON ci_import.staged_relationships (item_id, entity_id, relation)
    NULLS NOT DISTINCT
    WHERE entity_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS staged_relationships_item_related_uniq
    ON ci_import.staged_relationships (item_id, related_item_id, relation)
    NULLS NOT DISTINCT
    WHERE related_item_id IS NOT NULL;

-- Reverse traversal: "everything this entity is attached to", which is how the
-- push assembles a communication's participants.
CREATE INDEX IF NOT EXISTS staged_relationships_entity_idx
    ON ci_import.staged_relationships (entity_id)
    WHERE entity_id IS NOT NULL;

-- ---------------------------------------------------------------------
-- ci_import.entity_mappings — staged entity → the ci.entities row it became.
-- ---------------------------------------------------------------------
-- Written by the push from the ingest service's answer, so later edges in the
-- same run can reference a server entity without re-sending it. No FK to
-- ci.entities: a merge on the resolution side can retire an entity id, and a
-- staging table must not be the thing that blocks it.
CREATE TABLE IF NOT EXISTS ci_import.entity_mappings (
    staged_entity_id UUID PRIMARY KEY REFERENCES ci_import.staged_entities(id) ON DELETE CASCADE,
    user_id          UUID NOT NULL,
    server_entity_id UUID NOT NULL,
    synced_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE ci_import.entity_mappings IS
  'Which ci.entities row each staged entity resolved to during the push. No FK to ci.entities — entity resolution may retire an id, and staging must not block that.';

CREATE INDEX IF NOT EXISTS entity_mappings_server_idx
    ON ci_import.entity_mappings (user_id, server_entity_id);

-- ---------------------------------------------------------------------
-- ci_import.staged_sources — every local source an import run can consume.
-- ---------------------------------------------------------------------
-- Two origins, one lifecycle. An UPLOAD is staged into the importer's own
-- uploads directory the moment it arrives and registered here, which is what
-- makes the upload→import gap survivable: a restart between the upload and
-- the import click no longer destroys a 40GB upload — which it did upstream,
-- where the purge just swept a directory. An INBOX unit is a file or
-- directory the user placed in the inbox folder; it gets a row only when a
-- run claims it, because the folder itself is the pending state.
--
-- Everything registered here is a COPY the importer owns. From `claimed` on,
-- the two origins behave identically: the unpack stage MOVES the path into
-- the run's scratch, and the bytes are deleted with the completed run.
CREATE TABLE IF NOT EXISTS ci_import.staged_sources (
    id                UUID PRIMARY KEY DEFAULT ci.gen_uuid_v7(),
    user_id           UUID NOT NULL,

    origin            TEXT NOT NULL
                        CHECK (origin IN ('upload', 'inbox')),
    -- Sanitized public handle, used in URLs and diagnostics. Uploads only:
    -- an inbox unit's handle is its path.
    drop_id           TEXT,
    -- Realpath of the staged bytes: <uploadsDir>/<dropId>/<filename> for
    -- uploads, the unit's inbox path for inbox rows. Mutation sites re-resolve
    -- it against the staging roots before every move or delete — a row edited
    -- to point elsewhere is refused where the deleting happens.
    source_path       TEXT NOT NULL,
    kind              TEXT NOT NULL
                        CHECK (kind IN ('file', 'directory')),

    original_filename TEXT,
    content_type      TEXT,
    -- Aggregate bytes for directories, file size for files. Advisory: feeds
    -- the copy-fallback free-disk preflight, may lag the truth.
    size_bytes        BIGINT,

    -- staged:   an upload awaiting its import decision (TTL applies)
    -- claimed:  bound to a run; bytes still at source_path
    -- moved:    the unpack stage moved the bytes into the run's scratch
    -- consumed: the run completed; the bytes were reclaimed with its scratch
    -- released: an INBOX claim freed before the move (the path is claimable
    --           again). Uploads never take this state: releasing an upload
    --           re-stages it, or a stranded file would outlive every sweep.
    -- expired:  an upload's TTL passed and its file was deleted. The row is
    --           kept so the user sees "expired", not a bare 404.
    status            TEXT NOT NULL DEFAULT 'staged'
                        CHECK (status IN ('staged', 'claimed', 'moved', 'consumed', 'released', 'expired')),

    -- The run consuming this source. SET NULL rather than CASCADE: deleting an
    -- import run must not silently orphan staged bytes by taking the registry
    -- row with it.
    run_id            UUID REFERENCES ci_import.import_runs(id) ON DELETE SET NULL,

    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Uploads only: when the TTL purge may reclaim a still-staged upload.
    expires_at        TIMESTAMPTZ,
    claimed_at        TIMESTAMPTZ,
    consumed_at       TIMESTAMPTZ,

    -- The handle and the TTL are what make an upload an upload.
    CHECK ((origin = 'upload') = (drop_id IS NOT NULL)),
    CHECK (origin <> 'upload' OR expires_at IS NOT NULL),
    CHECK (origin = 'inbox' OR status <> 'released')
);

COMMENT ON TABLE ci_import.staged_sources IS
  'Local sources import runs consume: staged uploads (TTL''d copies in the uploads dir) and claimed inbox units. One lifecycle from claimed on — moved into the run''s scratch, deleted with the completed run.';
COMMENT ON COLUMN ci_import.staged_sources.source_path IS
  'Realpath of the staged bytes. Every later move or delete re-resolves it against the staging roots before mutating — a row edited to point elsewhere is refused at the mutation site.';
COMMENT ON COLUMN ci_import.staged_sources.run_id IS
  'The run consuming this source, or NULL. ON DELETE SET NULL — deleting a run must not orphan staged bytes by taking their registry row with it. A claimed row whose run was deleted has no janitor; the uploads-dir orphan sweep is the backstop.';

-- THE claim: at most one live run per path, either origin. Partial so
-- consumed/released/expired rows free the path for a later source with the
-- same name.
CREATE UNIQUE INDEX IF NOT EXISTS staged_sources_active_path_uq
    ON ci_import.staged_sources (user_id, source_path)
    WHERE status IN ('claimed', 'moved');

-- One row per upload handle.
CREATE UNIQUE INDEX IF NOT EXISTS staged_sources_drop_uq
    ON ci_import.staged_sources (user_id, drop_id)
    WHERE drop_id IS NOT NULL;

-- The purge sweep: still-staged uploads past their TTL. Partial, so it holds
-- only the rows actually at risk of expiring.
CREATE INDEX IF NOT EXISTS staged_sources_expiry_idx
    ON ci_import.staged_sources (expires_at)
    WHERE status = 'staged';

CREATE INDEX IF NOT EXISTS staged_sources_run_idx
    ON ci_import.staged_sources (run_id);

-- migrate:down
DROP TABLE IF EXISTS ci_import.staged_sources;
DROP TABLE IF EXISTS ci_import.entity_mappings;
DROP TABLE IF EXISTS ci_import.staged_relationships;
DROP TABLE IF EXISTS ci_import.staged_entities;
DROP TABLE IF EXISTS ci_import.staged_items;
DROP TABLE IF EXISTS ci_import.import_stages;
DROP TABLE IF EXISTS ci_import.import_runs;

DROP SCHEMA IF EXISTS ci_import;
