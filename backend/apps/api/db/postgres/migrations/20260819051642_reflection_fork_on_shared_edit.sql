-- migrate:up
-- Copy-on-write for the shared reflection catalogue.
--
-- WHY. `ci.questions` holds two very different kinds of row behind one table.
-- 1,273 of them are shipped seed content (`is_seed_question`, `is_private_to
-- IS NULL`) that EVERY user on the appliance is asked from; the rest are one
-- person's own reflections (`is_private_to = <user>`). Since the browsable
-- catalogue shipped, an ordinary authenticated user could PATCH any shared
-- row — rewording it, recategorising it, or retiring it with
-- `is_active = false` — and the change landed on the single shared row. On a
-- multi-user appliance that is one person silently editing what everybody
-- else gets asked, and "retire this, it is too personal" is exactly the edit
-- someone makes without meaning it for the household.
--
-- WHAT THIS ADDS. A shared row is now read-only. A user's edit mints a private
-- copy owned by them (`is_private_to = <user>`) that records what it came from
-- here, and the origin is filtered out of that one user's selections so they
-- see their copy rather than both. Nobody else's view changes at all.
--
-- ON DELETE SET NULL, not CASCADE: `ci.answers` and `ci.feed_queue` already
-- cascade from `ci.questions`, so a cascading fork edge would make deleting one
-- shared row destroy other people's forks AND the answers hanging off them.
-- Orphaning a fork into an ordinary private question loses nothing.

ALTER TABLE ci.questions
  ADD COLUMN IF NOT EXISTS forked_from_question_id UUID
    REFERENCES ci.questions(question_id) ON DELETE SET NULL;

COMMENT ON COLUMN ci.questions.forked_from_question_id IS
  'Set when this row is one user''s private copy of a shared catalogue row. The origin is hidden from that user''s selections so the copy replaces it.';

-- A fork with no owner would be a second public copy of a public row, which is
-- the duplicate this whole mechanism exists to avoid.
ALTER TABLE ci.questions
  DROP CONSTRAINT IF EXISTS questions_fork_is_owned;

ALTER TABLE ci.questions
  ADD CONSTRAINT questions_fork_is_owned
  CHECK (forked_from_question_id IS NULL OR is_private_to IS NOT NULL);

-- One fork per (origin, owner). The service reuses an existing fork on a second
-- edit rather than minting another; this makes that a database guarantee, and
-- it is the index the "has this caller forked this row" lookup rides on.
CREATE UNIQUE INDEX IF NOT EXISTS questions_fork_owner_uniq
  ON ci.questions (forked_from_question_id, is_private_to)
  WHERE forked_from_question_id IS NOT NULL;

-- migrate:down
-- Dropping the column leaves every existing fork behind as an ordinary private
-- question, which un-hides the shared row it replaced: those users see both
-- their copy and the original until one is deactivated. Nothing is destroyed —
-- no fork row, and no answer repointed onto one, is touched here.
DROP INDEX IF EXISTS ci.questions_fork_owner_uniq;

ALTER TABLE ci.questions
  DROP CONSTRAINT IF EXISTS questions_fork_is_owned;

ALTER TABLE ci.questions
  DROP COLUMN IF EXISTS forked_from_question_id;
