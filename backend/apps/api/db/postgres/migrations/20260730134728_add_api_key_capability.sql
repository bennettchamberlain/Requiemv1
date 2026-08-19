-- migrate:up
-- A key's `scopes` say WHICH surfaces it opens; `capability` says WHAT it may do there
-- ('read' | 'write' | 'full'). Two orthogonal axes: overloading the scope array with verbs
-- would collide with the grandfathered "empty scopes = full authority" rule, which would
-- then have to mean full surface AND full capability, with no way to express one without
-- the other.
--
-- Existing rows default to 'write': every tool except the destructive ones. That is what
-- every key could already do, so no key in the field loses access on upgrade — MCP tools
-- have never been gated on read/write here, only on scope.
ALTER TABLE ci.api_keys
  ADD COLUMN IF NOT EXISTS capability text NOT NULL DEFAULT 'write';

-- Refuse an unreadable authority level at the door. The application coerces an unrecognised
-- value to the strictest level on read, but a constraint means it can never be written in the
-- first place — a typo'd capability is a key whose powers nobody can state.
--
-- Dropped first so the whole file is re-runnable, matching the column's own IF NOT EXISTS and the
-- pattern the other migrations here use. An `ADD CONSTRAINT` that throws on a second run turns a
-- partially-applied migration — one recovered by hand, or replayed against a restored database —
-- into a manual repair, and it would do so at exactly the moment someone is already recovering.
ALTER TABLE ci.api_keys
  DROP CONSTRAINT IF EXISTS api_keys_capability_check;
ALTER TABLE ci.api_keys
  ADD CONSTRAINT api_keys_capability_check CHECK (capability IN ('read', 'write', 'full'));

-- migrate:down
ALTER TABLE ci.api_keys DROP CONSTRAINT IF EXISTS api_keys_capability_check;
ALTER TABLE ci.api_keys DROP COLUMN IF EXISTS capability;
