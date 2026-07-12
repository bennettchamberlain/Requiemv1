-- migrate:up
-- Two-tier connect-key scopes (ships with deny-by-default api-key enforcement).
--
-- Before this release every connect key was minted with the single `memory`
-- scope, but scopes were not enforced outside the memory endpoints. Now a
-- scope-limited key is confined to routes that grant one of its scopes, so an
-- already-connected app whose key still says `{memory}` would be 403'd on the
-- endpoints it actually uses. Re-scope existing connect keys to match
-- `scopesForApp` (ConnectService) so live connections keep working on deploy:
--   - Chat agents (CI-OpenClaw, CI-Hermes) use memory + the intent catalog +
--     the MCP endpoint                               -> {memory,intents,mcp}
--   - CI-Import-Tools is a bulk importer (graphql/ingest/files/maintenance)
--     and any other/unknown app                      -> {} (full access)
--
-- Connect keys are named `app:<appName>:<store>` (e.g.
-- `app:ci-openclaw:ci-marketplace`); `split_part(name,':',2)` is the app name,
-- exactly mirroring `appUrn.split(':')[0]` in scopesForApp.
UPDATE ci.api_keys SET scopes = '{memory,intents,mcp}'
  WHERE name LIKE 'app:%' AND split_part(name, ':', 2) IN ('ci-openclaw', 'ci-hermes');

-- Everything else (ci-import-tools AND any other/unknown connect app) → full
-- access. This is a CATCH-ALL, not a named list, so it mirrors scopesForApp's
-- default exactly and never strands an un-analyzed app's existing key at
-- `{memory}` (which deny-by-default would then 403 outside /memory/*).
UPDATE ci.api_keys SET scopes = '{}'
  WHERE name LIKE 'app:%' AND split_part(name, ':', 2) NOT IN ('ci-openclaw', 'ci-hermes');

-- migrate:down
-- Before this release every connect key was minted with the single `memory`
-- scope, so restoring that uniform value is the correct rollback for all of them.
UPDATE ci.api_keys SET scopes = '{memory}' WHERE name LIKE 'app:%';
