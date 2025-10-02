-- migrate:up
ALTER TABLE connections
  DROP COLUMN clientid,
  DROP COLUMN clientkey,
  DROP COLUMN clientsecret,
  DROP COLUMN clienttoken;

ALTER TABLE providers
  DROP COLUMN token_host,
  DROP COLUMN token_path,
  DROP COLUMN authorize_path,
  DROP COLUMN api_base_url,
  DROP COLUMN scopes;

-- migrate:down
ALTER TABLE connections
  ADD COLUMN clientid text,
  ADD COLUMN clientkey text,
  ADD COLUMN clientsecret text,
  ADD COLUMN clienttoken text;

ALTER TABLE providers
  ADD COLUMN token_host text,
  ADD COLUMN token_path text,
  ADD COLUMN authorize_path text,
  ADD COLUMN api_base_url text,
  ADD COLUMN scopes text;
