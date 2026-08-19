-- migrate:up
-- Account deletion, as required by App Store Guideline 5.1.1(v) and Google Play's
-- Data Deletion policy: an app that lets you create an account in-app must let you
-- delete it in-app. Companion's SignupPage is a real in-app registration flow, so
-- neither store exempts us, and self-hosting does not either — Apple requires the
-- *initiation* path to live in the app even though the data sits on the user's own
-- appliance.
--
-- Why soft-delete instead of `DELETE FROM ci.users`:
--
--   1. It cannot work today. 33 tables reference users(id) with NO `ON DELETE`
--      clause, which Postgres defaults to NO ACTION — events, content, files,
--      threads, messages, notes, embeddings, tags, sessions, questions, answers and
--      the whole hbpe.* schema among them. A hard delete raises a foreign-key
--      violation for any account that has ever stored anything. (UserService.remove()
--      has always had this bug; it simply has no callers, so nobody hit it.)
--   2. Even with cascades it would be a bad idea. Several user-scoped tables are
--      TimescaleDB hypertables (communications, browser_activity, position,
--      screen_captures, voice_recordings, activities, hbpe.prediction_log) holding
--      ~1M+ rows on a real appliance. One synchronous cascading delete means a long
--      lock and a plausible statement timeout on a live box.
--
-- So: revoke access instantly, purge in the background. `deleted_at` is the access
-- gate — the moment it is set the account authenticates nowhere (enforced in
-- UserService via TypeORM's @DeleteDateColumn, which filters every repository read,
-- so no auth path can forget the check). `purge_after` is the promise: the hard
-- purge job may not run before it.
ALTER TABLE ci.users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE ci.users ADD COLUMN IF NOT EXISTS purge_after TIMESTAMPTZ;

COMMENT ON COLUMN ci.users.deleted_at IS
  'When the user requested deletion. Non-NULL = access revoked immediately: the account authenticates nowhere and resolves as not-found. NULL = live account.';

-- `purge_after` is pinned at request time rather than derived from config by the
-- purge job, deliberately. It is a commitment made to the user ("your data is gone
-- by <date>") and to the stores' data-deletion disclosures; if the job computed it
-- from a config value, editing that config would retroactively rewrite a promise
-- already made to someone who has already left.
COMMENT ON COLUMN ci.users.purge_after IS
  'Earliest time the background purge may hard-delete this account''s data. Pinned when deletion is requested so later config changes cannot extend a promise already made.';

-- The purge job's only access path: find due, deleted accounts. Partial, because
-- live accounts (the overwhelming majority) are never of interest to it.
CREATE INDEX IF NOT EXISTS idx_users_purge_after
  ON ci.users (purge_after)
  WHERE deleted_at IS NOT NULL;

-- NOTE (known trade-off, deliberate): ci.users.email stays UNIQUE across soft-deleted
-- rows, so a deleted address cannot be re-registered until the purge completes. That
-- is the correct default here — releasing the address at soft-delete time would mean
-- either anonymising it (destroying the audit trail of who asked for deletion, before
-- we have honoured the request) or allowing a new account to collide with the old
-- one's not-yet-purged, still-FK-referenced rows. On a single-user appliance the
-- owner can re-provision; revisit if multi-tenant signup ever needs same-email reuse.

-- migrate:down
DROP INDEX IF EXISTS ci.idx_users_purge_after;
ALTER TABLE ci.users DROP COLUMN IF EXISTS purge_after;
ALTER TABLE ci.users DROP COLUMN IF EXISTS deleted_at;
