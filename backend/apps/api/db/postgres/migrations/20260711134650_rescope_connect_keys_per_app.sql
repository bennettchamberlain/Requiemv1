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
--
-- Both statements are guarded so they touch ONLY rows the connect flow minted:
--
--   1. the full `app:<appName>:<store>` shape — `split_part(name,':',3) <> ''`.
--      The `app:` prefix alone is NOT proof of provenance: key names are free-form,
--      so a user could have hand-created `app:home-assistant` (two parts). Connect
--      keys are always `app:` + an AppUrn (`<appName>:<store>`), hence three.
--   2. `scopes = '{memory}'` — the ONLY value the previous release minted.
--
-- Both matter, and neither alone is enough. Without them the catch-all below would
-- rewrite a user's key to `{}`, and under deny-by-default an EMPTY scope set means
-- FULL ACCESS — the hardening migration would silently widen a key its owner had
-- deliberately confined. (`ApiKeyController` now also reserves the `app:` prefix,
-- so no new collisions can be created; these guards cover keys predating that.)
UPDATE ci.api_keys SET scopes = '{memory,intents,mcp}'
  WHERE name LIKE 'app:%'
    AND split_part(name, ':', 3) <> ''
    AND scopes = '{memory}'
    AND split_part(name, ':', 2) IN ('ci-openclaw', 'ci-hermes');

-- Everything else (ci-import-tools AND any other/unknown connect app) → full
-- access. A CATCH-ALL over app names, not a named list, so it mirrors scopesForApp's
-- default exactly and never strands an un-analyzed app's existing key at `{memory}`
-- (which deny-by-default would then 403 outside /memory/*).
UPDATE ci.api_keys SET scopes = '{}'
  WHERE name LIKE 'app:%'
    AND split_part(name, ':', 3) <> ''
    AND scopes = '{memory}'
    AND split_part(name, ':', 2) NOT IN ('ci-openclaw', 'ci-hermes');

-- migrate:down
-- Restore the uniform `{memory}` the previous release minted — but ONLY for the
-- rows this migration widened to the chat-agent scope set. The keys it set to
-- `{}` are deliberately left alone: an empty scope set is full access under BOTH
-- the old (grandfathered) and new (deny-by-default) enforcement, so reverting
-- them to `{memory}` would be actively harmful — it would 403 CI-Import-Tools on
-- graphql/ingest/files/maintenance if the DB were rolled back while this
-- release's code was still running.
UPDATE ci.api_keys SET scopes = '{memory}'
  WHERE name LIKE 'app:%'
    AND split_part(name, ':', 3) <> ''
    AND scopes = '{memory,intents,mcp}';
