-- migrate:up
-- The Ask: an interpersonal question A directs at B's memory. Distinct from
-- ci.questions (descriptive self-analytics) — here the asker is NOT the record
-- owner. `query` is the bounded, asker-supplied request (Phase 2 formalizes it
-- as a DCQL subset); `consent_basis` records which grant (or explicit owner
-- review) authorized any answer. Phase 0 of the federated ask / decentralized
-- trust graph — CI-Server #1711 → epic #1712.
CREATE TABLE ci.asks (
    id UUID PRIMARY KEY DEFAULT gen_uuid_v7(),
    asker_user_id UUID NOT NULL REFERENCES ci.users(id) ON DELETE CASCADE,
    responder_user_id UUID NOT NULL REFERENCES ci.users(id) ON DELETE CASCADE,
    query JSONB NOT NULL,
    status TEXT NOT NULL DEFAULT 'sent'
        CHECK (status IN ('sent', 'delivered', 'under_review', 'answering', 'answered', 'declined', 'expired')),
    consent_basis TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ
);

-- Responder's review inbox: pending asks addressed to me, newest first.
CREATE INDEX asks_responder_status_idx ON ci.asks (responder_user_id, status, created_at DESC);

-- Asker's outbox / status polling.
CREATE INDEX asks_asker_idx ON ci.asks (asker_user_id, created_at DESC);

-- migrate:down
DROP TABLE IF EXISTS ci.asks;
