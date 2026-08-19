-- migrate:up
-- The disclosure-filtered ANSWER produced for an ask (Phase 1). Distinct from
-- ci.answers (descriptive self-analytics): here the answer is what one person's
-- Companion discloses to another. It carries only entity id+type REFERENCES
-- (never raw node content or forwardable signed media URLs), a form discriminator,
-- a redaction-aware disclosed/withheld split, and a templated summary (LLM
-- synthesis via the answer-inference path is a follow-up). One answer per ask.
--
-- Unlike ci.ask_audit (the durable "who disclosed what to whom" record, which
-- outlives the ask), this is the answer PAYLOAD and is tied to the ask lifecycle,
-- so ask_id is ON DELETE CASCADE. CI-Server #1711 → epic #1712, Phase 1.
CREATE TABLE ci.ask_answers (
    id UUID PRIMARY KEY DEFAULT gen_uuid_v7(),
    ask_id UUID NOT NULL REFERENCES ci.asks(id) ON DELETE CASCADE,
    form TEXT NOT NULL
        CHECK (form IN ('boolean', 'existence', 'attribute', 'retrieval', 'identity')),
    answer_source TEXT NOT NULL DEFAULT 'peer'
        CHECK (answer_source IN ('self', 'peer')),
    summary TEXT,
    -- [{ id, type }] entity references only — never raw content.
    disclosed_entities JSONB NOT NULL DEFAULT '[]'::jsonb,
    disclosed_count INTEGER NOT NULL DEFAULT 0,
    -- Matched but redacted by the owner ("deny all but X"); counted, never itemized.
    withheld_count INTEGER NOT NULL DEFAULT 0,
    consent_basis TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One answer per ask.
CREATE UNIQUE INDEX ask_answers_ask_uniq ON ci.ask_answers (ask_id);

-- migrate:down
DROP TABLE IF EXISTS ci.ask_answers;
