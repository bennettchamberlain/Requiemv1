-- migrate:up
INSERT INTO ci.providers (id, name, description, logo_url, endpoints, auth_type, local_only, app_setup_url)
VALUES (
  '019e3d77-c6e3-8f14-da06-2b5f7c0e1d19',
  'Signal',
  'Connect Signal via a local signal-cli REST API to sync messages and contacts.',
  '/branding/signal/logo.svg',
  '[
    { "name": "Messages", "description": "Sync incoming Signal messages via the receive endpoint.", "iterationType": "incremental", "TTL": null },
    { "name": "Contacts", "description": "Sync Signal contacts.", "iterationType": "historical", "TTL": 86400 }
  ]'::jsonb,
  'api_key',
  true,
  'https://github.com/bbernhard/signal-cli-rest-api'
)
ON CONFLICT (id) DO NOTHING;

-- migrate:down
DELETE FROM ci.providers WHERE id = '019e3d77-c6e3-8f14-da06-2b5f7c0e1d19';
