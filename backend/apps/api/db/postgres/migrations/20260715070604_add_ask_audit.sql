-- migrate:up
-- Per-ask audit: who asked what of whom, on what consent basis, with what
-- outcome, and which of the owner's entities were disclosed. One row per
-- terminal outcome (answered / auto_answered / declined / expired). Declines are
-- logged too — the gate working is the point. Feeds Disclosure History (UX.md)
-- and, later, ISO 27560 consent receipts (ECOSYSTEM.md Δ1). CI-Server #1711 → #1712.
CREATE TABLE ci.ask_audit (
    id UUID PRIMARY KEY DEFAULT gen_uuid_v7(),
    ask_id UUID NOT NULL REFERENCES ci.asks(id) ON DELETE CASCADE,
    asker_user_id UUID NOT NULL,
    responder_user_id UUID NOT NULL,
    query JSONB NOT NULL,
    consent_basis TEXT,
    outcome TEXT NOT NULL
        CHECK (outcome IN ('answered', 'auto_answered', 'declined', 'expired')),
    disclosed_entities JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Responder's disclosure history, newest first.
CREATE INDEX ask_audit_responder_idx ON ci.ask_audit (responder_user_id, created_at DESC);
CREATE INDEX ask_audit_ask_idx ON ci.ask_audit (ask_id);

-- migrate:down
DROP TABLE IF EXISTS ci.ask_audit;
