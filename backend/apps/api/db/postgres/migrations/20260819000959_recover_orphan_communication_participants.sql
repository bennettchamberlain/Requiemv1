-- migrate:up
-- Backfill: give ci.communications rows that name NOBODY the conversation
-- counterpart back, wherever the import staging tables still hold enough to
-- derive one honestly.
--
-- ## The defect
--
-- 24,043 rows have BOTH `from_entity_id IS NULL` AND `to_entity_ids` empty, so
-- there is no way to tell who the conversation was with. On a real appliance:
--
--   SELECT source_system, direction, count(*) FROM ci.communications
--    WHERE from_entity_id IS NULL
--      AND (to_entity_ids IS NULL OR cardinality(to_entity_ids) = 0)
--    GROUP BY 1, 2 ORDER BY 3 DESC;
--   -- imessage     | outbound | 16325
--   -- google_voice | inbound  |  7318
--   -- imessage     | inbound  |   373
--   -- (+25 rows across linkedin/reddit/claude/gmail: Reddit posts, LinkedIn
--   --  system notices and Claude transcripts, none of which HAS a
--   --  person-to-person counterpart to recover)
--
-- The producers are fixed in the same change as this migration
-- (imessage.ts / googlevoice.ts / PushStage.ts). Without a forward fix this
-- backfill would be theatre: the next import would mint the same orphans.
--
-- ## Why these rows are invisible to the normal linking sweep
--
-- `PERSON_LINK_SOURCE` (domains/pipeline/stages/enrich/PersonLinkStage.ts)
-- selects on `participants_metadata IS NOT NULL AND <> '{}'::jsonb` — an empty
-- object is metadata in name only and can never produce a claim, so the sweep
-- deliberately never offers these rows a slice. Confirmed on the live DB: not
-- one of the 24,043 has an `enrich.person_link` row in ci.pipeline_state.
--
-- That is why this migration writes `participants_metadata` and NOT
-- `from_entity_id` / `to_entity_ids` directly. Recovering the raw identifier is
-- the part only the staging tables can do; resolving it to a Person, minting a
-- stub when there is none, and honouring merges is the sweep's job, and it will
-- pick these rows up on its next run now that they qualify.
--
-- ## What is recoverable, and what is not
--
-- The staged rows survive (1,473,027 of them) and join 1:1 to the orphans on
-- (user_id, data_source = source_system, content_hash = source_id). What they
-- do NOT contain is the participant: not one of the 24,043 staged rows carries
-- a Sender / Recipients / To / Contact key, and none has a staged `participant`
-- relationship either —
--
--   SELECT s.data_source, r.relation, count(*)
--     FROM <the orphan join> LEFT JOIN ci_import.staged_relationships r
--       ON r.item_id = s.id GROUP BY 1, 2;
--   -- imessage     | (null) | 16698
--   -- google_voice | (null) |  7318
--
-- so the importers never knew who these were, and no amount of re-reading
-- staging invents one. Two subsets ARE derivable, and only those are touched:
--
--   A. Google Voice image attachments  — 6,760 of the 7,318
--   B. iMessage tapbacks (reactions)   —   648 of the 16,698
--
-- The remaining 16,635 are NOT recovered here, and this is stated plainly
-- rather than papered over: for the 16,325 outbound + 373 inbound iMessages,
-- `message.handle_id` resolved to no `handle` row AND the chat lookup returned
-- nothing, so chat.db itself never said who they were between. Re-importing the
-- same chat.db is the only thing that can help them, and only if that copy has
-- the `handle` / `chat_handle_join` rows this one lacked.
--
-- ### A. Google Voice image attachments
--
-- Every one of the 7,318 is an image-only MMS: `metadata` is exactly
-- {"Source": "GoogleVoice", "Attachment": "image"}. googlevoice.ts scanned the
-- whole conversation file for `<img src>` OUTSIDE the message loop, so the
-- picture arrived with no sender, no recipient and no conversation.
--
-- What it DOES have is the staged `filename`, which Google Voice names
-- "<contact> - <Type> - <ISO timestamp>-<n>-<n>.<ext>":
--
--   "Marlon Fuentes - Text - 2018-10-05T02_48_10Z-33-1.jpg"
--   "+13109683286 - Text - 2018-04-08T19_50_11Z-6-1.jpg"
--
-- The label before " - <Type> - " is the conversation counterpart, and the
-- regex below is `processConversation()`'s own `conversation` rule, character
-- for character, with JS's `\b` written as Postgres ARE's `\y` (in ARE, `\b` is
-- a backspace, not a word boundary). `regexp_replace` without the 'g' flag
-- replaces only the first match, matching JS `String.replace` with a
-- non-global pattern.
--
-- GUARDED so a filename can never become a person: the derived label is
-- accepted only when it is ALREADY a known Google Voice participant for that
-- same user — i.e. it appears as `from`, or inside `to`, on some other
-- ci.communications row. A label that survives is one the importer already
-- resolved from real markup elsewhere, not filename debris. This importer has
-- twice minted people out of strings that were never names (241 Person rows
-- named after .html files; 2,025 named "Missed call from"), and this guard is
-- what keeps that from happening a third time. On the live DB the guard costs
-- nothing and proves the point: all 6,760 labels that parse are already known
-- counterparts, 403 distinct people; the 558 that do not parse are dropped.
--
-- LIMITATION, stated rather than hidden: the counterpart is derived; the ROLE
-- is inherited. All 7,318 rows are `direction = 'inbound'`, which for these is
-- `toCommunicationInput`'s conservative default and not something the export
-- stated, and the file no longer exists to say which way the picture
-- travelled. Writing `{"from": <counterpart>}` therefore says exactly what the
-- row already says about direction, and matches the shape every other inbound
-- Google Voice row in the same conversation carries. For pictures the OWNER
-- sent, the counterpart ends up in the sender's seat. That is a worse answer
-- than the truth and a better one than nobody.
--
-- CORRECTION to an earlier draft of this comment, which claimed the guess was
-- "not sticky" because `participants_metadata` and `direction` are both in
-- INGEST_REFRESH_COLUMNS.communication. A re-import does refresh those two
-- columns — but `from_entity_id` / `to_entity_ids` are written by the
-- enrich.person_link sweep, and a row whose ledger entry is already `done` at
-- the current stage version is never revisited. So the FK minted from this
-- guess would outlive the metadata it was guessed from, and no re-import could
-- correct it.
--
-- The final statement below is what makes the guess re-openable: it deletes the
-- enrich.person_link ledger rows for every id these two statements touched, so
-- the next sweep re-derives the link from whatever participants_metadata says
-- THEN — the corrected value after a re-import, or this guess if none has
-- happened. A guess that can be revisited is a different thing from a guess
-- that is permanent.
--
-- ### B. iMessage tapbacks
--
-- A tapback is its own `message` row pointing at the message it reacts to via
-- `associated_message_guid`, recorded by imessage.ts as `metadata.ReactionTo`.
-- It is in the same conversation as its target by construction — that is what a
-- tapback IS — so the target's participants are this row's participants.
--
-- Restricted to the unambiguous case, which on the live DB is all 648 of them:
-- the reacting row is `outbound` (from `is_from_me`, a real column, not a
-- default), and its target is a 1:1 inbound message carrying `from` and no
-- `to`. One counterpart, one role, nothing inferred — the reaction went TO the
-- one other person in the chat. Group chats are skipped: an inbound reaction in
-- a group has an unknowable sender, and an outbound one would need the owner's
-- own handles subtracted from the membership list, which is not derivable here.
--
-- ## Narrow and idempotent
--
-- Both statements require `participants_metadata = '{}'::jsonb` alongside the
-- orphan predicate, so a row that already names anyone is never touched, and a
-- second run matches zero rows because the first run left `<> '{}'` behind.
-- Neither statement writes `from_entity_id`, `to_entity_ids` or `direction`.

-- A. Google Voice image attachments: the counterpart out of the staged filename.
WITH orphan AS (
  SELECT c.id,
         c.user_id,
         s.filename,
         btrim(
           regexp_replace(
             s.filename,
             '\s*-\s*(Text|Received|Placed|Missed|Voicemail|Recorded|Group Conversation)\y.*$',
             '',
             'i'
           )
         ) AS counterpart
    FROM ci.communications c
    JOIN ci_import.staged_items s
      ON s.user_id = c.user_id
     AND s.data_source = c.source_system
     AND s.content_hash = c.source_id
   WHERE c.source_system = 'google_voice'
     AND c.direction = 'inbound'
     AND c.from_entity_id IS NULL
     AND (c.to_entity_ids IS NULL OR cardinality(c.to_entity_ids) = 0)
     AND c.participants_metadata = '{}'::jsonb
     AND s.metadata ? 'Attachment'
     AND s.filename IS NOT NULL
),
known AS (
  SELECT DISTINCT k.user_id, x.v AS counterpart
    FROM ci.communications k
    CROSS JOIN LATERAL (
      SELECT k.participants_metadata->>'from' AS v
      UNION ALL
      SELECT jsonb_array_elements_text(k.participants_metadata->'to')
       WHERE jsonb_typeof(k.participants_metadata->'to') = 'array'
    ) AS x
   WHERE k.source_system = 'google_voice'
     AND k.participants_metadata <> '{}'::jsonb
     AND x.v IS NOT NULL
     AND x.v <> ''
),
recoverable AS (
  SELECT o.id, o.counterpart
    FROM orphan o
    JOIN known k
      ON k.user_id = o.user_id
     AND k.counterpart = o.counterpart
   -- `replace` returns the subject untouched when nothing matched, so a
   -- filename with no " - <Type> - " separator yields the whole basename. That
   -- is the "this file does not say who the contact was" case, not a name.
   WHERE o.counterpart <> ''
     AND o.counterpart <> o.filename
)
UPDATE ci.communications AS c
   SET participants_metadata = jsonb_build_object('from', r.counterpart)
  FROM recoverable r
 WHERE c.id = r.id;

-- B. iMessage tapbacks: inherit the 1:1 counterpart from the message reacted to.
WITH tapback AS (
  SELECT c.id,
         c.user_id,
         c.source_type,
         s.metadata->>'ReactionTo' AS target_source_id
    FROM ci.communications c
    JOIN ci_import.staged_items s
      ON s.user_id = c.user_id
     AND s.data_source = c.source_system
     AND s.content_hash = c.source_id
   WHERE c.source_system = 'imessage'
     AND c.direction = 'outbound'
     AND c.from_entity_id IS NULL
     AND (c.to_entity_ids IS NULL OR cardinality(c.to_entity_ids) = 0)
     AND c.participants_metadata = '{}'::jsonb
     AND s.metadata ? 'ReactionTo'
),
recoverable AS (
  SELECT t.id, target.participants_metadata->>'from' AS counterpart
    FROM tapback t
    JOIN ci.communications target
      ON target.user_id = t.user_id
     AND target.source_type = t.source_type
     AND target.source_system = 'imessage'
     AND target.source_id = t.target_source_id
   -- 1:1 only: `from` present, `to` absent. In a group the target's `to` lists
   -- the rest of the membership INCLUDING the owner's own handles, and nothing
   -- here can tell those apart.
   WHERE target.direction = 'inbound'
     AND target.participants_metadata ? 'from'
     AND NOT (target.participants_metadata ? 'to')
     AND coalesce(target.participants_metadata->>'from', '') <> ''
)
UPDATE ci.communications AS c
   SET participants_metadata = jsonb_build_object('to', jsonb_build_array(r.counterpart))
  FROM recoverable r
 WHERE c.id = r.id;

-- C. Re-open the person-link ledger for every row A and B touched.
--
-- Without this, statement A's derived authorship becomes a permanent
-- from_entity_id: enrich.person_link records a `done` ledger row per
-- communication at its stage version, and the sweep's anti-join skips anything
-- already done at that version. Deleting the ledger rows for exactly these ids
-- costs one re-derivation each and buys the ability to correct them.
--
-- Scoped to this migration's own predicate (the rows that now carry a recovered
-- `participants_metadata` and still have no link), so it cannot re-open a row
-- some other run legitimately settled.
DELETE FROM ci.pipeline_state ps
 USING ci.communications c
 WHERE ps.stage = 'enrich.person_link'
   AND ps.entity_type = 'communication'
   AND ps.entity_id = c.id
   AND ps.user_id = c.user_id
   AND c.source_system IN ('google_voice', 'imessage')
   AND c.from_entity_id IS NULL
   AND (c.to_entity_ids IS NULL OR cardinality(c.to_entity_ids) = 0)
   AND c.participants_metadata <> '{}'::jsonb;

-- ## Verification
--
-- PROJECTIONS, not results: the counts below come from running the CTEs as
-- SELECTs against a live appliance database. This migration has NOT been
-- executed — do not read them as before/after measurements.
--
-- Projected: 6760 / 648 rows match. After: 0 / 0 (both statements re-run as
-- no-ops).
--
--   SELECT source_system, direction, count(*) FROM ci.communications
--    WHERE from_entity_id IS NULL
--      AND (to_entity_ids IS NULL OR cardinality(to_entity_ids) = 0)
--      AND participants_metadata = '{}'::jsonb
--    GROUP BY 1, 2 ORDER BY 3 DESC;
--   -- google_voice inbound drops 7318 -> 558, imessage outbound 16325 -> 15677
--
-- The 7,408 recovered rows now qualify for PERSON_LINK_SOURCE and are linked by
-- the enrich.person_link sweep on its next run; from_entity_id / to_entity_ids
-- fill in there, not here.

-- migrate:down
-- No-op: irreversible data backfill, same reasoning as
-- 20260818212254_backfill_position_coordinate_names and
-- 20260818213148_backfill_google_voice_call_heading_duplication. The rows this
-- writes to held an empty object, so there is no prior value to restore, and
-- nothing records which rows were touched versus already populated.
