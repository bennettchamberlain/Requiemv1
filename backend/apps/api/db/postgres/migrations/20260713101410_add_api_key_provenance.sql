-- migrate:up
-- Record WHO created an api key, instead of inferring it from the key's name.
--
-- Connect keys are named `app:<appName>:<store>`, and the server treated that
-- prefix as proof the Hub owns the key: `isHubManagedKey` matched on it, and revoke
-- and rotate resolved keys by it. But key names are free-form — a user can create
-- `app:home-assistant` by hand — so provenance was a guess about a value the user
-- controls. Two consequences:
--
--   1. Machinery meant for a connect key operated on a user's key. The previous
--      release's re-scoping migration rewrote EVERY `app:%` key that was not
--      openclaw/hermes to an empty scope set, which under deny-by-default means
--      FULL ACCESS — silently widening a key its owner had deliberately confined.
--   2. The victim could not repair it: `isHubManagedKey` also matched, so the API
--      refused to re-scope the key ("managed by Companion Hub"). The only remedy
--      was to delete it.
--
-- `managed_by` makes ownership explicit and unforgeable. NULL = the user made it,
-- and it stays theirs to rename and re-scope; 'connect' = minted by the Companion
-- Memory consent flow, and the Hub owns its lifecycle.
ALTER TABLE ci.api_keys ADD COLUMN IF NOT EXISTS managed_by TEXT;

COMMENT ON COLUMN ci.api_keys.managed_by IS
  'Who owns this key''s lifecycle: NULL = user-created; ''connect'' = minted by the Companion Memory consent flow.';

-- Backfill. The consent flow is the only producer of the full `app:<appName>:<store>`
-- shape — three colon-separated parts, since an AppUrn is `<appName>:<store>` — so
-- that, and only that, identifies an existing connect key. A hand-made `app:foo` has
-- two parts and is deliberately left NULL: that keeps it out of the Hub's
-- revoke/rotate paths and restores its owner's ability to re-scope it.
UPDATE ci.api_keys SET managed_by = 'connect'
  WHERE name LIKE 'app:%' AND split_part(name, ':', 3) <> '';

-- Revoke and rotate look a connect key up by name; this is the access path for both.
CREATE INDEX IF NOT EXISTS idx_api_keys_managed_by_name
  ON ci.api_keys (managed_by, name)
  WHERE managed_by IS NOT NULL;

-- migrate:down
DROP INDEX IF EXISTS ci.idx_api_keys_managed_by_name;
ALTER TABLE ci.api_keys DROP COLUMN IF EXISTS managed_by;
