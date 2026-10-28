# Messages of one chat in order.
# variables: $session (uuid), $limit (int64)
select ChatMessage {
  id,
  role,
  content,
  tool_calls,
  model,
  seq,
  created_at,
}
filter .session.id = <uuid>$session
order by .seq asc
limit <int64>$limit;
