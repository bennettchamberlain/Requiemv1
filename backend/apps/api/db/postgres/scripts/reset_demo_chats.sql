DELETE FROM messages
WHERE message_id IN (
  WITH NumberedMessages AS (
    SELECT
      message_id,
      thread_id,
      role,
      ROW_NUMBER() OVER(PARTITION BY thread_id ORDER BY created_at ASC) as rn
    FROM messages
    WHERE user_id = 'b3b8c7e2-1c2d-4e5f-8a6b-9c0d1e2f3a4b'
  ),
  ThreadsToExclude AS (
    SELECT thread_id
    FROM NumberedMessages
    WHERE rn = 1 AND role = 'user'
  )
  SELECT message_id
  FROM NumberedMessages
  WHERE rn > 1
  AND thread_id NOT IN (SELECT thread_id FROM ThreadsToExclude)
);
