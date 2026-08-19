-- migrate:up
-- Backfill: thread the iMessage rows that
-- 20260819000746_backfill_communications_thread_id_from_import_staging could
-- not — the ones whose message has no `chat_message_join` row — onto their
-- correspondent, but ONLY where that handle is already a 1:1 conversation in
-- this same user's own data.
--
-- ## The residual hole
--
-- imessage.ts resolves the conversation from chat / chat_message_join /
-- chat_handle_join. 45,280 of the 432,173 imported iMessage rows have no chat
-- at all — the message row exists, but nothing links it to a conversation — so
-- there is no `ChatId` in staging to recover and the previous migration leaves
-- them NULL. Their shape:
--
--   28,582 inbound with a sender handle
--   16,325 outbound with neither recipients nor a partner handle
--      373 inbound with no sender either
--
-- Only the first group has anything to work with, and even there the handle
-- alone does not prove a 1:1 conversation: an orphaned GROUP message would be
-- filed into that one participant's private thread, silently merging two
-- different conversations. A wrong merge is worse than an empty column.
--
-- ## The predicate, and why it is evidence rather than a guess
--
-- For a 1:1 iMessage chat, `chat.chat_identifier` IS the other party's handle
-- — that is how Apple names them, and it is exactly the value the previous
-- migration already wrote as `thread_id` for those chats. So a handle that
-- appears as a thread_id whose every message involves nobody but that same
-- handle is, on this user's own data, a 1:1 conversation with them.
--
-- This migration therefore fills a chat-less row only when:
--
--   1. the row has exactly ONE participant across
--      participants_metadata->>'from' and ->'to' (so it is 1:1-shaped), and
--   2. that participant is already a thread_id for this user, and
--   3. every row in that thread involves nobody but that same handle (so the
--      thread is genuinely 1:1, not a group whose id happens to look like a
--      handle), and at least one of them names a participant at all (so a
--      thread of participant-less rows cannot qualify vacuously).
--
-- The message then joins a conversation that demonstrably exists, under the
-- key its siblings already use. Anything failing the test keeps thread_id
-- NULL: an unplaceable message is recorded honestly rather than filed under a
-- conversation nobody can show exists.
--
-- ## Verified against a real appliance database before writing this migration
--
--   -- Chat-less iMessage rows, and how many the predicate can place
--   -- (simulating the previous migration's result):
--   -- still NULL after 20260819000746: 45280
--   -- of those, recoverable under this predicate: 8099
--   --
--   -- The looser "just use the sender" rule would have touched all 28,582
--   -- inbound rows — 20,483 of them on a handle that is NOT a 1:1 chat
--   -- identifier anywhere in this user's data. Those 20,483 are exactly the
--   -- fabrications this predicate refuses to make.
--
-- Narrow: scoped to `source_system = 'imessage'` and `thread_id IS NULL`, so
-- no row that already has a thread — from any source — is read or written.
--
-- Idempotent: every row it touches ends with a non-NULL thread_id and is
-- excluded by the `thread_id IS NULL` predicate on a second run. The
-- `one_to_one` set is computed from rows that already had a thread and is
-- unaffected by this UPDATE's own writes: a row it fills has exactly one
-- participant, equal to its new thread_id, so it satisfies the same
-- subset-of-{thread_id} condition its thread already satisfied and cannot
-- turn a 1:1 thread into a non-qualifying one.
WITH participants AS (
  SELECT c.id,
         c.user_id,
         c.thread_id,
         (
           SELECT array_agg(DISTINCT handle)
             FROM (
               SELECT c.participants_metadata ->> 'from' AS handle
                UNION ALL
               SELECT jsonb_array_elements_text(COALESCE(c.participants_metadata -> 'to', '[]'::jsonb))
             ) AS handles
            WHERE handle IS NOT NULL AND handle <> ''
         ) AS handles
    FROM ci.communications AS c
   WHERE c.source_system = 'imessage'
),
one_to_one AS (
  SELECT user_id, thread_id
    FROM participants
   WHERE thread_id IS NOT NULL
   GROUP BY user_id, thread_id
  HAVING bool_and(handles IS NULL OR handles <@ ARRAY[thread_id])
     AND bool_or(handles IS NOT NULL)
)
UPDATE ci.communications AS c
   SET thread_id = p.handles[1]
  FROM participants AS p
  JOIN one_to_one AS o
    ON o.user_id = p.user_id AND o.thread_id = p.handles[1]
 WHERE c.id = p.id
   AND p.thread_id IS NULL
   AND array_length(p.handles, 1) = 1;

-- ## Post-migration verification
--
-- iMessage rows still unthreaded — expected ~37,181, all of them messages with
-- no chat AND no usable correspondent (outbound with no partner handle, or a
-- correspondent this user has no 1:1 chat with):
--   SELECT count(*) FROM ci.communications
--    WHERE source_system = 'imessage' AND thread_id IS NULL;
--
-- Nothing this migration wrote should be a brand-new thread — every value it
-- sets must already have existed as a thread_id, so the distinct-thread count
-- for iMessage is unchanged by it:
--   SELECT count(DISTINCT thread_id) FROM ci.communications
--    WHERE source_system = 'imessage';

-- migrate:down
-- No-op: irreversible data backfill, same reasoning as
-- 20260819000746_backfill_communications_thread_id_from_import_staging and
-- 20260818212254_backfill_position_coordinate_names — nothing records which
-- rows this filled versus which already carried the same thread_id, so
-- clearing them again would destroy correct data.
