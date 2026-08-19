-- migrate:up
-- Standing consent for the ask path. Replaces reliance on the single
-- saved_searches.is_public boolean: a grant says "grantee may ask owner about
-- query_type/data_class, within scope", with `mode` selecting the three-state
-- posture from the Grant Manager UX — auto (answer without review), review (ask
-- me first, the default), or block (deny). Grants are revocable (revoked_at).
-- `purpose` carries a DPV purpose URI (ECOSYSTEM.md Δ2). CI-Server #1711 → #1712.
CREATE TABLE ci.ask_grants (
    id UUID PRIMARY KEY DEFAULT gen_uuid_v7(),
    owner_user_id UUID NOT NULL REFERENCES ci.users(id) ON DELETE CASCADE,
    grantee_user_id UUID NOT NULL REFERENCES ci.users(id) ON DELETE CASCADE,
    query_type TEXT NOT NULL,
    data_class TEXT,
    scope JSONB,
    mode TEXT NOT NULL DEFAULT 'review'
        CHECK (mode IN ('auto', 'review', 'block')),
    purpose TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at TIMESTAMPTZ
);

-- Grant evaluation lookup: active grants from a given grantee to a given owner.
CREATE INDEX ask_grants_owner_grantee_idx
    ON ci.ask_grants (owner_user_id, grantee_user_id)
    WHERE revoked_at IS NULL;

-- migrate:down
DROP TABLE IF EXISTS ci.ask_grants;
