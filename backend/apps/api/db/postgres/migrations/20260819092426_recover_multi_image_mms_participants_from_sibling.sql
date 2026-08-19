-- migrate:up
-- Backfill: give the attachments of a multi-image Google Voice MMS the
-- participants their own message block already recorded on the FIRST image.
--
-- ## The defect
--
-- googlevoice.ts read each message with
-- `/<div class="message[^"]*">([\s\S]*?)<\/div>/` — lazy, so the block ended at
-- the FIRST `</div>`. A real Google Voice MMS wraps every attachment in its own
-- sibling div inside the message:
--
--   <div class="message">…<q></q>
--     <div><img src="…-7-1"/></div> <div><img src="…-7-2"/></div> …
--   </div>
--
-- so the captured block stopped after image 1 and images 2..N sat outside every
-- block the parser could see. `attachmentSenders` had no entry for them, and
-- they reached ci.communications with no sender, no recipient and no direction.
--
-- The signature is exact and is what identifies this class rather than the
-- generic "orphan" one that 20260819000959 handled. On the live corpus 274 rows
-- carry it, and EVERY ONE is an attachment whose per-message index is >= 2
-- (168 x "-2", 48 x "-3", 28 x "-4", … 1 x "-15"); NOT ONE has index 1:
--
--   SELECT substring(content from '-[0-9]+-([0-9]+)\.[A-Za-z0-9]+$') AS att_idx,
--          count(*)
--     FROM ci.communications
--    WHERE source_system = 'google_voice'
--      AND from_entity_id IS NULL
--      AND (to_entity_ids IS NULL OR cardinality(to_entity_ids) = 0)
--      AND participants_metadata = '{}'::jsonb
--      AND content ~ '-[0-9]+-[0-9]+\.[A-Za-z0-9]+$'
--    GROUP BY 1 ORDER BY 1;
--
-- The producer is fixed in the same change as this migration (googlevoice.ts
-- now finds the block's real close by counting `<div>` / `</div>`). Without
-- that forward fix this backfill would be theatre — 20260819000959 was a
-- one-shot repair of an overlapping symptom with no matching upstream guard,
-- so every import since has re-created it. This one repairs rows that already
-- exist; the parser is what stops the next import minting more.
--
-- ## Why these rows are invisible to the normal linking sweep
--
-- `PERSON_LINK_SOURCE` (domains/pipeline/stages/enrich/PersonLinkStage.ts)
-- selects on `participants_metadata IS NOT NULL AND <> '{}'::jsonb`, so an
-- empty object can never be offered a slice. Confirmed on the live DB: not one
-- of the 274 has an `enrich.person_link` row in ci.pipeline_state — they have
-- never been claimed, not claimed-and-completed.
--
-- That is why this migration writes `participants_metadata` and NOT
-- `from_entity_id` / `to_entity_ids`. Recovering the raw identifier is the part
-- only this rule can do; resolving it to a Person, minting a stub when there is
-- none, and honouring merges is the sweep's job, and it will pick these rows up
-- on its next run now that they qualify.
--
-- ## Where the value comes from, and why it is not a guess
--
-- NOT from the filename. Google Voice names an attachment
-- "<label> - <Type> - <ISO>-<messageIndex>-<attachmentIndex>.<ext>", and the
-- label names the THREAD, never the author — filing it as a person is how this
-- importer previously minted 241 Person entities named after .html files and
-- 2,025 named "Missed call from". 20260819000959 needed a known-counterpart
-- guard for exactly that reason, and still had to inherit `direction` it could
-- not verify.
--
-- This rule needs no such guard, because the answer is already in the database:
-- the trailing "-<attachmentIndex>" is the ONLY part that differs between
-- attachments of one message, so stripping it groups an MMS's images back
-- together, and image 1 of that same block was attributed by the importer from
-- the block's real `<cite class="sender vcard">` markup. Every attachment in
-- one block shares one sender, one direction and one recipient by construction
-- — they are one message — so the donor's value IS this row's value, not an
-- approximation of it.
--
-- Verified against the fixed parser rather than asserted: re-running
-- googlevoice.ts over the source export (71,945 files, 7,318 attachments) and
-- comparing its output for each of these rows to the value this statement
-- copies gives 230 of 230 identical, 0 mismatches, 0 donor groups carrying more
-- than one distinct value.
--
-- ## What "recovered" means here, precisely
--
-- On the live corpus all 230 repaired rows receive `{"to": ["+1949…"]}` — the
-- OWNER as recipient — and no `from`. That is not the migration being timid: it
-- is what the export says. These MMS blocks carry an empty sender
-- (`<a class="tel" href="tel:"><span class="fn"></span></a>`), so the fixed
-- parser records a recipient and refuses to name an author, and image 1 of each
-- block carries exactly that. The row stops being participant-less; the other
-- party stays unnamed because the markup never named it.
--
-- The thread label ("Chris Fornof") is NOT promoted into `from`, even though
-- 20260819000959 did that for its own subset behind a known-participant guard.
-- Two reasons, and the second is the load-bearing one: a filename labels the
-- thread, not the author of any one message in it; and `participants_metadata`
-- is in INGEST_REFRESH_COLUMNS.communication, so a re-import would overwrite an
-- invented `from` with the parser's recipient-only value — while the
-- `from_entity_id` minted from it in the meantime would survive, because a
-- ledger row at the current stage version is never revisited. Writing only what
-- the parser will also write is what keeps this repair and the next import
-- telling the same story.
--
-- ## What is NOT recovered, stated rather than papered over
--
-- 230 of the 274. The other 44 are all "Group Conversation" files whose donor
-- never landed in ci.communications at all (`-<n>-1` is absent from the table
-- while present on disk and emitted by the parser), so there is nothing here to
-- inherit from. The fixed parser attributes them — it reads a real sender out
-- of the group block's markup — so they heal on the next import of that export
-- and are deliberately left alone rather than guessed at from the label
-- "Group Conversation", which names nobody.
--
-- Also untouched, and correct as-is: the 107 rows whose content is a call
-- record with no counterpart ("Received call from unknown"). An export that
-- says the caller was unknown is not a row missing its participants.
--
-- ## Narrow and idempotent
--
-- The donor must be unambiguous (`count(DISTINCT …) = 1`), so a group that
-- somehow disagreed with itself is skipped rather than resolved by coin-flip.
-- The target requires `participants_metadata = '{}'::jsonb` alongside the
-- orphan predicate, so a row that already names anyone is never touched and a
-- second run matches zero rows. Neither `from_entity_id`, `to_entity_ids` nor
-- `direction` is written.

WITH attachment AS (
  SELECT c.id,
         c.user_id,
         c.participants_metadata,
         -- Strip ONLY the trailing "-<attachmentIndex>.<ext>". What remains
         -- ("Chris Fornof - Text - 2019-05-09T03_17_14Z-7") is the message the
         -- attachment belongs to — the same key for every image in one block.
         regexp_replace(c.content, '-[0-9]+\.[A-Za-z0-9]+$', '') AS message_key
    FROM ci.communications c
   WHERE c.source_system = 'google_voice'
     AND c.content ~ '-[0-9]+-[0-9]+\.[A-Za-z0-9]+$'
),
donor AS (
  SELECT a.user_id,
         a.message_key,
         min(a.participants_metadata::text) AS participants
    FROM attachment a
   WHERE a.participants_metadata <> '{}'::jsonb
   GROUP BY a.user_id, a.message_key
  HAVING count(DISTINCT a.participants_metadata::text) = 1
),
recoverable AS (
  SELECT o.id, d.participants
    FROM attachment o
    JOIN donor d
      ON d.user_id = o.user_id
     AND d.message_key = o.message_key
   WHERE o.participants_metadata = '{}'::jsonb
)
UPDATE ci.communications AS c
   SET participants_metadata = r.participants::jsonb
  FROM recoverable r
 WHERE c.id = r.id
   AND c.from_entity_id IS NULL
   AND (c.to_entity_ids IS NULL OR cardinality(c.to_entity_ids) = 0)
   AND c.participants_metadata = '{}'::jsonb;

-- Re-open the link for the rows just given a counterpart. These rows have no
-- enrich.person_link ledger entry on the live DB (the sweep's predicate has
-- always excluded them), so this matches nothing there — it is written for the
-- appliance where an earlier repair DID populate participants_metadata and
-- leave a `done` entry behind, because a ledger row at the current stage
-- version is never revisited and the FK would otherwise outlive the metadata
-- it was derived from.
DELETE FROM ci.pipeline_state ps
 USING ci.communications c
 WHERE ps.entity_id = c.id
   AND ps.stage = 'enrich.person_link'
   AND c.source_system = 'google_voice'
   AND c.from_entity_id IS NULL
   AND (c.to_entity_ids IS NULL OR cardinality(c.to_entity_ids) = 0)
   AND c.participants_metadata <> '{}'::jsonb
   AND c.content ~ '-[0-9]+-[0-9]+\.[A-Za-z0-9]+$';

-- migrate:down
-- No-op: irreversible data backfill, same reasoning as 20260819000959. The rows
-- this writes to held an empty object, so there is no prior value to restore,
-- and nothing records which rows were touched versus already populated.
