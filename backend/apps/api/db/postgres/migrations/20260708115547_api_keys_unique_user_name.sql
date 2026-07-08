-- migrate:up
-- Enforce one api key per (user, name). The connect flow mints keys named
-- `app:<urn>` and rotates in place; a unique constraint makes that idempotent
-- and race-safe (a concurrent double-provision fails the second insert rather
-- than silently accumulating duplicate rows).
--
-- Pre-existing duplicates (older data minted before this constraint) are
-- de-duplicated first, keeping the most recently created row per (user, name).
DELETE FROM ci.api_keys a
USING ci.api_keys b
WHERE a.user_id = b.user_id
  AND a.name = b.name
  AND a.created_at < b.created_at;

CREATE UNIQUE INDEX idx_api_keys_user_id_name ON ci.api_keys(user_id, name);

-- migrate:down
DROP INDEX IF EXISTS ci.idx_api_keys_user_id_name;
