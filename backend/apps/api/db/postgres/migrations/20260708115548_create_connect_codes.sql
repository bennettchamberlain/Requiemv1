-- migrate:up
-- Short-lived, single-use authorization codes for the app-connect flow.
--
-- When a user consents (on ci-memory) to connect an app to their Companion
-- Memory, the server mints a scoped api key and hands the browser a one-time
-- `code`. CI-Hub then exchanges that code server-to-server for the raw key.
-- The raw key never transits the browser or a URL — it lives here encrypted
-- (AES-256-GCM, field-level) until the single exchange consumes the row.
CREATE TABLE ci.connect_codes (
    id UUID PRIMARY KEY,

    -- SHA-256 of the raw code; the raw code is only ever in the redirect URL.
    hashed_code TEXT NOT NULL,
    -- The minted api key, field-encrypted (enc:v1:...). Returned once on exchange.
    encrypted_key TEXT NOT NULL,

    -- Binds the code to the identity + app it was minted for, so the exchange
    -- (and any audit) can assert who/what it belongs to.
    user_id UUID NOT NULL REFERENCES ci.users(id) ON DELETE CASCADE,
    app_urn TEXT NOT NULL,

    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_connect_codes_hashed_code ON ci.connect_codes(hashed_code);
-- Supports the sweep of expired/consumed codes.
CREATE INDEX idx_connect_codes_expires_at ON ci.connect_codes(expires_at);

-- migrate:down
DROP TABLE IF EXISTS ci.connect_codes;
