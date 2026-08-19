-- migrate:up
-- Re-file the 2,249 contact cards that landed as `Concept` instead of `Person`
-- (2,247 from vCard, 2 from a CSV contact list), and re-key them onto the natural
-- key the fixed parser now mints, so the next import UPDATES them rather than
-- minting a second row beside them.
--
-- ## This finishes f24110960, which fixed the parsers and said so
--
-- The parser half already landed: f24110960 ("a contact card with no phone or
-- email is a Person, not a Concept") declared `type: 'contact'` in all three
-- contact parsers -- vcard.ts, contactlist.ts and applecontacts.ts. Its message is
-- explicit that the rows already written are NOT repaired there:
--
--   "Existing rows are not repaired here: INGEST_REFRESH_COLUMNS means a
--    re-import is find-or-return, so a corpus imported before this lands keeps
--    its Concepts until re-imported into a fresh database."
--
-- This migration is that repair, and it does NOT need a fresh database. One
-- correction to the reasoning above, which is also why re-importing alone would
-- not have fixed it: for ENTITIES the ingest is not find-or-return.
-- `GraphIngestService` upserts
-- `ON CONFLICT (owner_user_id, entity_type, linked_table, linked_id) DO UPDATE SET
-- name, description, properties` -- so a re-import DOES write. The problem is
-- WHERE it writes, which is the next section.
--
-- ## The bug: whether a card listed a phone number decided whether its subject
-- ## was a human
--
-- `buildContact` typed the ITEM it emitted (`classification: 'contact'`) but not
-- the ENTITY beside it. A typeless staged entity is then resolved by
-- `resolveEntityType` (import/staging/identity.ts), whose only person signal is
-- `hasContactIdentity` -- an attribute that looks like a phone number or an
-- email. A card carrying either got `type = 'contact'` and, through
-- `ENTITY_TYPES` in import/push/entities.ts, became a `Person`. A card carrying
-- just a NAME had no handle to find, fell through to `type = null`, and
-- `entityTypeFor` mapped null to `DEFAULT_ENTITY_TYPE` = 'Concept'.
--
-- So one address book split down the middle on a distinction that has nothing to
-- do with whether the subject is a person. linkedin.ts hit and documented this
-- exact failure for itself (see the comment on its connection entity, which
-- records ~1,940 connections dropped from the graph for want of an explicit
-- type); the three CONTACT parsers are the ones that never got the same treatment
-- until f24110960.
--
-- ## Why the type change alone is NOT enough -- it changes BOTH halves of the
-- ## upsert key
--
-- `GraphIngestService` upserts entities on
-- (owner_user_id, entity_type, linked_table, linked_id), where
-- linked_id = uuidv5(naturalKeyFor(staged)) -- and `naturalKeyFor`
-- (import/push/entities.ts) folds the staged type INTO the key:
-- `${type ?? 'entity'}:${handle-or-lowercased-name}`. A handle-less contact card
-- therefore keyed as `entity:<name>` before f24110960 and keys as
-- `contact:<name>` after it. So the parser fix on its own leaves every one of
-- these 2,249 rows stranded as a `Concept` while a freshly minted `Person` appears
-- beside it on the next import -- turning a mis-typed row into a permanent
-- duplicate pair. That is the state `main` is in today, and what this fixes.
--
-- Hence both columns move here. After this migration the row sits at exactly the
-- coordinate the fixed parser computes, so the next import's
-- `ON CONFLICT ... DO UPDATE SET name, description, properties` finds it and
-- refreshes it in place. That is also why the rows are RE-TYPED rather than
-- deleted and left to a re-import: they carry 2,200 graph edges and 478
-- `ci.entity_identifiers` rows between them, none of which a delete would
-- give back.
--
-- ## Why this does not merge anything
--
-- 1,779 of these rows duplicate a `Person` of the same name that another source
-- already contributed (1,717 from LinkedIn, 184 from vCard's own handle-bearing
-- cards, 90 from Google Voice, 9 from a contact list, 1 from WhatsApp). This
-- migration does NOT collapse those: `ci.merge_candidates` is this codebase's
-- purpose-built, human-reviewed path for that decision, under the rule "CLEAN
-- proposes; a human disposes" (pipeline/stages/clean/DuplicateDetectStage.ts),
-- and a merge is irreversible in practice. The companion migration
-- 20260819091554_propose_vcard_person_name_merge_candidates.sql proposes them
-- for review instead.
--
-- The two are safe in this order, and it matters: re-typing FIRST is what makes
-- the pairs `Person`-to-`Person`, which is the only shape
-- `ci.merge_candidates.entity_type` and `PersonMergeService` handle. It is also
-- durable -- once a human accepts a merge, the loser keeps its linked key as a
-- tombstone, and `GraphIngestService` excludes tombstones from its DO UPDATE
-- outright, so a later re-import drops that source's update rather than
-- resurrecting the row it was merged into.
--
-- ## Verified against the live QA appliance before writing this migration
--
--   SELECT entity_type, properties->>'Source', linked_table, count(*)
--     FROM ci.entities WHERE entity_type IN ('Person','Concept') GROUP BY 1,2,3;
--   -- Concept | vCard       | import:vcard        | 2247
--   -- Person  | LinkedIn    | import:linkedin     | 1940
--   -- Person  | vCard       | import:vcard        | 1304
--   -- Person  | ContactList | import:contact_list |   31
--   -- Concept | ContactList | import:contact_list |    2
--
--   -- Confirmed in staging, the identity-bearing / identity-less split:
--   SELECT type, count(*) FROM ci_import.staged_entities
--    WHERE data_source = 'vcard' GROUP BY 1;
--   -- contact | 1416      NULL | 2962
--
-- The key derivation below is not assumed, it is CHECKED: all 2,249 rows have
-- linked_id = uuidv5(ns, 'entity:' || lower(btrim(name))), which is what proves
-- the 'entity:' prefix (i.e. `type` was NULL, not '') and that
-- `lower(btrim(name))` reproduces `naturalKeyFor`'s `name.trim().toLowerCase()`
-- byte for byte on this corpus. The predicate carries that equality, so a row
-- whose name a human has since edited -- or which some other code path minted --
-- fails to match and is LEFT ALONE rather than re-keyed onto a coordinate the
-- importer will never compute.
--
--   Uniqueness, the thing that could make this UPDATE throw. The index at risk
--   is entities_linked_uniq (owner_user_id, entity_type, linked_table,
--   linked_id) WHERE linked_table IS NOT NULL:
--     * 2,247 vCard rows / 2,247 distinct lower(btrim(name)) -- the re-keyed
--       rows cannot collide with each other. Same for the 2 contact-list rows.
--     * 0 rows collide with an existing `Person` row at the new linked_id, in
--       either source. The handle-bearing cards key on their HANDLE
--       (`contact:<email-or-phone>`), not their name, so the two key spaces are
--       disjoint. The `NOT EXISTS` below re-checks this at run time anyway and
--       SKIPS a colliding row instead of aborting the migration, because on such
--       a row the `Person` already exists and the duplicate is a merge question,
--       not a re-typing one.
--
--   Handle-absence is an EXACT discriminator between the two populations, which
--   is what makes `migrate:down` precise (see below):
--     vCard:        0 of 2,247 Concept rows carry properties->'email' or
--                   ->'phone';  0 of 1,304 Person rows lack one.
--     Contact list: 0 of 2 Concept rows carry one; 0 of 31 Person rows lack one.
--   It matters because 3 vCard `Person` rows are cards whose display name IS
--   their email address ("info@womp.xyz"), so they DO sit at
--   uuidv5(ns, 'contact:' || lower(name)) -- and would be caught by a down
--   predicate keyed on the hash alone. They all carry properties->'email', so
--   both predicates here exclude them.
--
--   Nothing else keys on entity_type for these rows:
--     * The composite FKs (id, entity_type) -> ci.entities(entity_id,
--       entity_type) from ci.content / ci.events / ci.inventory /
--       ci.communications are ON DELETE CASCADE and would break on a re-type --
--       verified 0 child rows across all four, plus 0 ci.users rows.
--     * entities_search_vector_trigger fires BEFORE UPDATE OF
--       name, description, search_content, properties -- none of which this
--       statement touches -- so the FTS row is correct without being rewritten.
--     * 0 tombstones and 0 inactive rows in the affected set; tombstones are
--       excluded regardless, since re-keying one would move a coordinate that
--       must stay put.
--
--   Row counts: the full predicate below selects 2,249 -- every mis-typed row in
--   both affected sources (2,247 vCard + 2 contact_list), and nothing else.
--
--   `import:apple_contacts` is in the scope list with ZERO measured rows, stated
--   plainly rather than quietly: this appliance has never imported Apple Contacts
--   (0 entities with that linked_table or an 'AppleContacts' Source), so there was
--   nothing to count. It is included because f24110960 fixed that parser too and
--   an appliance that DID import it before then has the identical stranded rows.
--   Including it is safe without a measurement: the predicate only ever touches a
--   row whose linked_id equals uuidv5(ns, 'entity:' || lower(btrim(name))), which
--   only the buggy null-type path can produce.
--
-- `uuid_generate_v5` is the one thing here that is not guaranteed by the schema:
-- `uuid-ossp` is NOT in infrastructure/setup-database/entrypoint.sh's extension
-- list (timescaledb postgis vector pg_stat_statements btree_gist), and no
-- migration creates it -- it is present on the existing appliances as a legacy
-- artifact, owned by the `companion` migration role and installed into `ci`.
-- It is marked `trusted` in PG18, so the database owner may create it without
-- superuser, and its module ships in the postgres:18.4-bookworm base image.
-- Created explicitly here rather than assumed. SHA-1 is unavoidable: uuid v5 is
-- defined on it, and PG18 has no built-in sha1 (only sha224 and up).
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA ci;

-- Fail loudly, with the remedy, rather than let a missing function turn into a
-- confusing "function does not exist" mid-statement. The only way to get here is
-- an appliance where uuid-ossp predates this migration in some OTHER schema, in
-- which case `IF NOT EXISTS` above was a silent no-op.
DO $guard$
BEGIN
  IF to_regprocedure('ci.uuid_generate_v5(uuid, text)') IS NULL THEN
    RAISE EXCEPTION
      'ci.uuid_generate_v5 is unavailable: the uuid-ossp extension exists in another schema. '
      'It is relocatable -- run  ALTER EXTENSION "uuid-ossp" SET SCHEMA ci;  and re-run this migration.';
  END IF;
END
$guard$;

UPDATE ci.entities e
   SET entity_type = 'Person',
       -- The whole point: land on the coordinate the FIXED parser computes.
       linked_id = ci.uuid_generate_v5(
         '6f4b3f9e-1c2a-5d8e-9a7b-0c1d2e3f4a5b'::uuid, -- IMPORT_NAMESPACE, GraphIngestService.ts
         'contact:' || lower(btrim(e.name))
       ),
       updated_at = now()
 WHERE e.entity_type = 'Concept'
   -- Provenance, both halves: the linked key says which importer wrote the row,
   -- the property says which parser inside it. A `Concept` from any other source
   -- is out of scope even if it shares a name.
   AND (e.linked_table, e.properties->>'Source') IN (
     ('import:vcard', 'vCard'),
     ('import:contact_list', 'ContactList'),
     ('import:apple_contacts', 'AppleContacts')
   )
   AND e.name IS NOT NULL
   AND btrim(e.name) <> ''
   -- The exact discriminator: a handle-less card is the one that fell through
   -- resolveEntityType. A row WITH a handle was never mis-typed.
   AND NOT (e.properties ? 'email' OR e.properties ? 'phone')
   -- A tombstone keeps its linked key so it still owns its coordinate; moving it
   -- would strand the merge that created it.
   AND e.merged_into_entity_id IS NULL
   -- Proof this row was minted by naturalKeyFor from a NULL type and this exact
   -- name. Anything else is left untouched rather than re-keyed on a guess.
   AND e.linked_id = ci.uuid_generate_v5(
     '6f4b3f9e-1c2a-5d8e-9a7b-0c1d2e3f4a5b'::uuid,
     'entity:' || lower(btrim(e.name))
   )
   -- Skip rather than abort if the destination coordinate is already occupied:
   -- that row IS the Person this card describes, so the leftover is a merge
   -- question for the companion migration, not a uniqueness violation here.
   AND NOT EXISTS (
     SELECT 1
       FROM ci.entities t
      WHERE t.owner_user_id IS NOT DISTINCT FROM e.owner_user_id
        AND t.entity_type = 'Person'
        AND t.linked_table = e.linked_table
        AND t.linked_id = ci.uuid_generate_v5(
          '6f4b3f9e-1c2a-5d8e-9a7b-0c1d2e3f4a5b'::uuid,
          'contact:' || lower(btrim(e.name))
        )
   );

-- ## Post-migration verification
--
--   -- Should be 0: every handle-less contact card is now a Person.
--   SELECT count(*) FROM ci.entities
--    WHERE entity_type = 'Concept'
--      AND linked_table IN ('import:vcard', 'import:contact_list')
--      AND NOT (properties ? 'email' OR properties ? 'phone');
--   -- (the `contact-cards-typed-as-concept` doctor check mirrors this predicate
--   --  on the metadata SHAPE rather than the source list -- see
--   --  import/doctor/checks.ts, which explains why the two scopes differ)
--
--   -- Should be 3,551 vCard (2,247 re-typed + 1,304 already correct) and
--   -- 33 contact_list (2 + 31), all Person, no Concept:
--   SELECT linked_table, entity_type, count(*) FROM ci.entities
--    WHERE linked_table IN ('import:vcard', 'import:contact_list') GROUP BY 1, 2;
--
--   -- Idempotency-with-the-parser check: re-import the same export and confirm
--   -- the Person count does NOT grow, i.e. the rows were UPDATEd not inserted.

-- migrate:down
-- Exactly invertible: both columns move back, selected by the post-state
-- coordinate. The handle-absence clause is what keeps this off the 3 vCard
-- Person rows whose display name is their own email address and which therefore
-- legitimately sit at uuidv5(ns, 'contact:' || lower(name)).
--
-- Ordering note: dbmate rolls back in reverse, so
-- 20260819091554_propose_vcard_person_name_merge_candidates.sql has already
-- removed its proposals by the time this runs -- no candidate is left pointing
-- at a row that is a Concept again. A merge a human ACCEPTED in between is not
-- undone by either down migration; that is `PersonMergeService`'s domain, and
-- a tombstoned row is skipped here because its merged_into_entity_id is set.
UPDATE ci.entities e
   SET entity_type = 'Concept',
       linked_id = ci.uuid_generate_v5(
         '6f4b3f9e-1c2a-5d8e-9a7b-0c1d2e3f4a5b'::uuid,
         'entity:' || lower(btrim(e.name))
       ),
       updated_at = now()
 WHERE e.entity_type = 'Person'
   AND (e.linked_table, e.properties->>'Source') IN (
     ('import:vcard', 'vCard'),
     ('import:contact_list', 'ContactList'),
     ('import:apple_contacts', 'AppleContacts')
   )
   AND e.name IS NOT NULL
   AND btrim(e.name) <> ''
   AND NOT (e.properties ? 'email' OR e.properties ? 'phone')
   AND e.merged_into_entity_id IS NULL
   AND e.linked_id = ci.uuid_generate_v5(
     '6f4b3f9e-1c2a-5d8e-9a7b-0c1d2e3f4a5b'::uuid,
     'contact:' || lower(btrim(e.name))
   )
   AND NOT EXISTS (
     SELECT 1
       FROM ci.entities t
      WHERE t.owner_user_id IS NOT DISTINCT FROM e.owner_user_id
        AND t.entity_type = 'Concept'
        AND t.linked_table = e.linked_table
        AND t.linked_id = ci.uuid_generate_v5(
          '6f4b3f9e-1c2a-5d8e-9a7b-0c1d2e3f4a5b'::uuid,
          'entity:' || lower(btrim(e.name))
        )
   );
