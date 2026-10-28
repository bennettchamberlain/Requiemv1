select SyncCursor {
  id,
  platform,
  endpoint,
  cursor,
  last_synced_at,
  last_error,
  updated_at,
}
filter .owner = global current_person
order by .platform then .endpoint;
