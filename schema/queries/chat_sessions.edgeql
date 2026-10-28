# The caller's chats, newest activity first.
# variables: $limit (int64)
select ChatSession {
  id,
  title,
  agent_session_key,
  created_at,
  last_message_at,
  message_count := count(.messages),
}
order by .last_message_at desc empty last then .created_at desc
limit <int64>$limit;
