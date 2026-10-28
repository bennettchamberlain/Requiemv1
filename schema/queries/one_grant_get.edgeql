# The caller's One Connect grant, if any.
select OneGrant {
  id,
  one_user_id,
  space_id,
  platforms,
  connected_at,
  revoked_at,
  created_at,
  updated_at,
}
filter .owner = global current_person
limit 1;
