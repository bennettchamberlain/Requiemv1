-- migrate:up

-- The live-source claim becomes GLOBAL rather than per-user.
--
-- `staged_sources_active_path_uq` was `(user_id, source_path)`, which reads as
-- the obviously-correct scoping and is wrong for the thing it guards. The
-- import INBOX is ONE folder on the appliance, shared by every account: two
-- users looking at `/var/lib/ci-import/inbox` see the same archives, because
-- there is only one of each. Keying the claim by user let both of them claim
-- the same unit at the same time, and `UnpackStage` acquires BY RENAME — so the
-- first run to reach the move took the bytes into its own scratch tree and
-- imported another person's export into its own account, while the second run
-- found nothing where its claim said there was something.
--
-- Scoped-by-user is right for a resource each user has their own copy of.
-- `source_path` is not one: it is a path on a shared filesystem, and at most
-- one run may hold it whoever started that run. Uploads are unaffected —
-- their `source_path` is `<uploadsDir>/<uuidv7 dropId>/<file>`, already unique
-- across users by construction.
--
-- Recreated CONCURRENTLY-free (this schema is small and the appliance takes the
-- brief lock at migrate time) and with the same partial predicate, so
-- consumed/released/expired rows still free the path for a later source with
-- the same name.
DROP INDEX IF EXISTS ci_import.staged_sources_active_path_uq;

CREATE UNIQUE INDEX IF NOT EXISTS staged_sources_active_path_uq
    ON ci_import.staged_sources (source_path)
    WHERE status IN ('claimed', 'moved');

COMMENT ON INDEX ci_import.staged_sources_active_path_uq IS
  'THE claim: at most one live run per path, appliance-wide. NOT scoped by user — the inbox is one shared folder, so a per-user claim let two accounts claim (and rename away) the same archive.';

-- migrate:down

-- Refuses rather than silently narrowing: rolling back while two users hold the
-- same path would fail the index build with a bare uniqueness error naming
-- neither the rows nor the reason.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
          FROM ci_import.staged_sources
         WHERE status IN ('claimed', 'moved')
         GROUP BY source_path
        HAVING count(DISTINCT user_id) > 1
    ) THEN
        RAISE EXCEPTION
            'ci_import.staged_sources holds one path claimed by more than one user; resolve those claims before rolling back';
    END IF;
END
$$;

DROP INDEX IF EXISTS ci_import.staged_sources_active_path_uq;

CREATE UNIQUE INDEX IF NOT EXISTS staged_sources_active_path_uq
    ON ci_import.staged_sources (user_id, source_path)
    WHERE status IN ('claimed', 'moved');
