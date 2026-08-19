-- migrate:up
-- Backfill: recover ci.communications.thread_id for iMessage, Google Voice,
-- LinkedIn and Instagram rows from the import staging table, which still holds
-- the conversation identifier those pushes dropped on the way in.
--
-- ## The bug this recovers from
--
-- `toCommunicationInput` (backend/apps/api/src/domains/import/push/inputs.ts)
-- read only `metadata.ThreadId` / `.Thread` / `.MessageID` to populate
-- `thread_id`. The datasources that resolved a perfectly good per-conversation
-- identifier wrote it somewhere else:
--
--   * imessage.ts — `chat.chat_identifier`, resolved via chat /
--     chat_message_join / chat_handle_join, written to `ChatId`
--   * googlevoice.ts — the per-conversation export filename, written to
--     `Conversation`
--   * linkedin.ts / instagram.ts — the conversation title / id, also written
--     to `Conversation`
--
-- so every one of those rows landed with `thread_id` NULL. The forward fix
-- ships alongside this migration: `Conversation` joins the chain in inputs.ts,
-- and imessage.ts / googlevoice.ts stamp `ThreadId` explicitly.
--
-- ## Why staging is a trustworthy source
--
-- `ci_import.staged_items` keeps the parsed item exactly as the datasource
-- emitted it, keyed by `(run_id, data_source, content_hash)`, and
-- `ci.communications.source_id` IS that `content_hash` — the same provenance
-- triple `communications_source_triple_uniq` is built on. So this is not
-- inference: it reads back the value the push already had in hand and failed
-- to map. Staging rows for these runs are intact (verified below); had they
-- been purged, this migration would simply update zero rows.
--
-- `DISTINCT ON (user_id, data_source, content_hash) … ORDER BY … created_at
-- DESC` collapses the several runs that staged the same item down to the most
-- recent one, so a re-imported item resolves to one deterministic value.
--
-- ## The Google Voice value is derived from the FILENAME, not from staged
-- ## `Conversation`, on purpose
--
-- Google Voice names each conversation file "<contact> - <Type> - <ts>.html",
-- and the contact prefix is the thread. Two shapes need care:
--
--   * A file whose name carries no contact — "Group Conversation -
--     <ts>.html" — names nobody. Older parser runs stored the WHOLE basename
--     in `Conversation`, which is where 241 Person entities named after .html
--     files came from (fixed in 3e5956cb0); the current parser correctly
--     leaves `Conversation` undefined. Neither value is a usable thread key,
--     so those files get the synthetic, file-scoped
--     `googlevoice:file:<basename without extension>` — the same value
--     `threadKeyFor()` in googlevoice.ts now produces, so re-importing the
--     same export reproduces this exact thread id instead of minting a second
--     one. That is 12,962 items across 1,655 group files on the live database,
--     up to 265 messages each.
--   * MMS attachment items carry no `Conversation` at all. Their filename is
--     the parent conversation's with a per-message index appended
--     ("… - Text - <ts>-51-1.jpg"), so stripping that index recovers the
--     parent file and therefore the parent's thread. Deriving from the
--     attachment's own name unchanged would mint one thread per attachment.
--
-- Reading the filename covers all three cases with one expression, and it was
-- verified to reproduce staged `Conversation` EXACTLY wherever staging has a
-- real one — zero disagreements across all 309,689 Google Voice staged rows.
--
-- ## Claude is deliberately excluded
--
-- Its 4 NULL rows stay NULL. The forward fix threads Claude on the
-- conversation UUID (a claude.ai conversation can be renamed, and an untitled
-- one has no name at all), and staging carries only the conversation *name* —
-- writing the name here would create a thread id no re-import would ever
-- reproduce. Re-importing the export fixes those 4 rows properly.
--
-- WhatsApp needs nothing: all 5,160 rows already have a thread_id.
--
-- ## Verified against a real appliance database before writing this migration
--
--   SELECT source_system, count(*), count(thread_id) FROM ci.communications
--    GROUP BY 1 ORDER BY 2 DESC;
--   -- imessage 432173/0, google_voice 309689/0, gmail 14859/7714,
--   -- whatsapp 5160/5160, linkedin 4840/0, instagram 228/0, claude 4/0, …
--   -- i.e. 754,098 of 767,015 communications had no thread at all.
--
--   -- Staging survives for these runs, and carries the identifier:
--   SELECT data_source, count(*), count(metadata->>'ChatId'),
--          count(metadata->>'Conversation')
--     FROM ci_import.staged_items
--    WHERE data_source IN ('imessage','google_voice','linkedin','instagram')
--    GROUP BY 1;
--   -- imessage 432173 / 386893 ChatId; google_voice 309689 / 302262
--   -- Conversation; linkedin 6815 / 4840; instagram 538 / 456
--
--   -- The filename-derived Google Voice expression, checked BOTH ways against
--   -- staged `Conversation` (never loses a label staging has, never derives a
--   -- different one): 296461 rows resolve to a contact label, 13228 to the
--   -- file-scoped synthetic, 0 mismatches of either kind.
--
--   -- This exact UPDATE's reach, run as a SELECT:
--   -- imessage 386893 rows / 1299 threads; google_voice 309689 / 4802;
--   -- linkedin 4840 / 776; instagram 228 / 17 — 701,650 rows into 6,894
--   -- conversations.
--
-- Narrow: `c.thread_id IS NULL` means a row that already has a thread — every
-- WhatsApp, Messenger, Twitter, Reddit and Grok row, and the 7,714 Gmail rows
-- with a real Message-ID — is never touched. `r.thread` is required non-empty,
-- so nothing is overwritten with a blank.
--
-- Idempotent: every row this touches ends with a non-NULL thread_id, so the
-- `thread_id IS NULL` predicate excludes it on a second run and the second run
-- updates zero rows.
UPDATE ci.communications AS c
   SET thread_id = r.thread
  FROM (
    SELECT s.user_id,
           s.data_source,
           s.content_hash,
           CASE s.data_source
             WHEN 'imessage' THEN s.metadata ->> 'ChatId'
             WHEN 'google_voice' THEN gv.thread
             ELSE s.metadata ->> 'Conversation'
           END AS thread
      FROM (
        SELECT DISTINCT ON (user_id, data_source, content_hash)
               user_id, data_source, content_hash, metadata, filename
          FROM ci_import.staged_items
         WHERE data_source IN ('imessage', 'google_voice', 'linkedin', 'instagram')
         ORDER BY user_id, data_source, content_hash, created_at DESC
      ) AS s
      -- Google Voice only: strip an MMS attachment's "-<n>-<m>" index and the
      -- extension to get the conversation FILE, then take the contact prefix
      -- when the name has one and fall back to the file itself when it does
      -- not. Mirrors threadKeyFor() in googlevoice.ts exactly.
      LEFT JOIN LATERAL (
        SELECT CASE
                 WHEN labelled.label <> '' AND labelled.label <> labelled.stem THEN labelled.label
                 ELSE 'googlevoice:file:' || labelled.stem
               END AS thread
          FROM (
            SELECT stripped.stem,
                   btrim(
                     regexp_replace(
                       stripped.stem,
                       '\s*-\s*(Text|Received|Placed|Missed|Voicemail|Recorded|Group Conversation)\y.*$',
                       '',
                       'i'
                     )
                   ) AS label
              FROM (
                SELECT regexp_replace(s.filename, '(-[0-9]+-[0-9]+)?\.[^.]+$', '') AS stem
              ) AS stripped
          ) AS labelled
      ) AS gv ON s.data_source = 'google_voice'
  ) AS r
 WHERE c.thread_id IS NULL
   AND c.user_id = r.user_id
   AND c.source_system = r.data_source
   AND c.source_id = r.content_hash
   AND r.thread IS NOT NULL
   AND r.thread <> '';

-- ## Post-migration verification
--
-- Coverage per source. iMessage should retain ~45,280 NULLs — messages with no
-- chat_message_join row at all, which the follow-up migration
-- 20260819000941_backfill_imessage_thread_id_from_one_to_one_correspondent
-- narrows to the 8,099 that can be justified; Claude keeps its 4:
--   SELECT source_system, count(*), count(thread_id)
--     FROM ci.communications GROUP BY 1 ORDER BY 2 DESC;
--
-- The group-conversation threads that exist only because of this migration:
--   SELECT thread_id, count(*) FROM ci.communications
--    WHERE thread_id LIKE 'googlevoice:file:%'
--    GROUP BY 1 ORDER BY 2 DESC LIMIT 10;

-- migrate:down
-- No-op: irreversible data backfill, same reasoning as
-- 20260628000000_backfill_content_user_id, 20260818174213_backfill_capture_
-- content_rows and 20260818212254_backfill_position_coordinate_names — nothing
-- records which rows were NULL because of this bug versus NULL for any other
-- reason, so clearing thread_id again would destroy correct data.
