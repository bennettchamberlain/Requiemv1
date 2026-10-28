# Jobs the caller can see, newest first. scoria-api inserts the record at
# enqueue; the worker updates it by pgboss_id as it runs.
# variables: $states (array<str>, optional), $limit (int64)
with states := <optional array<str>>$states
select JobRecord {
  id,
  name,
  state,
  attempt,
  created_at,
  started_at,
  completed_at,
  error,
  subject: { id, data_class },
}
filter (not exists states) or (<str>.state in array_unpack(states))
order by .created_at desc
limit <int64>$limit;
