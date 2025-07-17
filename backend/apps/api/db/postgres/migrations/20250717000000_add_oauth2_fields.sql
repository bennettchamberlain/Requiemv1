-- migrate:up
-- Add OAuth2 token fields to connections table
ALTER TABLE connections ADD COLUMN access_token TEXT;
ALTER TABLE connections ADD COLUMN refresh_token TEXT;
ALTER TABLE connections ADD COLUMN token_expiry TIMESTAMPTZ;

-- Add OAuth2 configuration fields to providers table
ALTER TABLE providers ADD COLUMN token_host TEXT;
ALTER TABLE providers ADD COLUMN token_path TEXT;
ALTER TABLE providers ADD COLUMN authorize_path TEXT;
ALTER TABLE providers ADD COLUMN api_base_url TEXT;
ALTER TABLE providers ADD COLUMN scopes TEXT;

-- migrate:down
-- Remove OAuth2 token fields from connections table
ALTER TABLE connections DROP COLUMN access_token;
ALTER TABLE connections DROP COLUMN refresh_token;
ALTER TABLE connections DROP COLUMN token_expiry;

-- Remove OAuth2 configuration fields from providers table
ALTER TABLE providers DROP COLUMN token_host;
ALTER TABLE providers DROP COLUMN token_path;
ALTER TABLE providers DROP COLUMN authorize_path;
ALTER TABLE providers DROP COLUMN api_base_url;
ALTER TABLE providers DROP COLUMN scopes;
