# One memory by id. Returns nothing the caller cannot see.
# variables: $id (uuid)
select MemoryItem {
  id,
  kind,
  title,
  body,
  occurred_at,
  source,
  source_id,
  created_at,
  updated_at,
  embedded_at,
  owner: { id, handle, display_name },
  place: { id, name, city, region, country, lat, lng },
}
filter .id = <uuid>$id;
