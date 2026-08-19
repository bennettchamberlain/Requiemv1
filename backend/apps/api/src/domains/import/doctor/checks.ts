/**
 * The data-quality check registry — `ci-import doctor`'s whole vocabulary.
 *
 * ## Why this exists
 *
 * Every check below was written first as a hand-typed SQL statement during a
 * live 13-source import of one person's real data, and every one of them found
 * something: communications with no thread, people named "Missed call from",
 * places named "IMG_0139.JPG", capture events with no thumbnail, 172 geocode
 * retries stuck past their next attempt. Those findings shipped as PRs
 * #2087–#2101, and the audit that found them lived in a scratch file that would
 * have been thrown away with the shell it was typed into.
 *
 * So these are REGRESSION DETECTORS, not hypotheticals. Each one is the
 * question "did the defect we just fixed come back?", asked in a form that both
 * a person and an agent can run: `ci-import doctor` for a table, `--json` for a
 * loop, and a non-zero exit when anything HIGH is non-zero so a loop can gate
 * on it.
 *
 * Run once against a live appliance an hour into that same import — 181,359
 * communications and 3,600 events written so far, twelve of thirteen sources
 * still pushing — the suite took 631ms and returned twelve findings, six of
 * them HIGH: 181,359 communications with no thread (all but four from
 * `google_voice`), 95,407 with no participant on either end, 10 capture events
 * with no content row, 472 pipeline retries past their next attempt, 55
 * unreplayed dead letters. None of that was visible from the import UI, which
 * showed every finished stage green.
 *
 * ## The mirroring rule
 *
 * Nearly every predicate here already exists somewhere else in the tree — as a
 * guard in `push/inputs.ts` that stops NEW rows being written, or as the WHERE
 * clause of the backfill migration that cleaned up the OLD ones. Where that is
 * true, this file MIRRORS it verbatim and the `mirrors` field says where from.
 * That is not decoration: a check that drifts from the guard it is supposed to
 * be watching silently stops watching it, and the only defence is that the two
 * are readable side by side. If you change a predicate here, change it there,
 * and vice versa.
 *
 * The mirrors are SQL-flavoured, so they are not character-identical to the
 * TypeScript ones. Two translation notes that have already bitten:
 *
 *   * Postgres regexes are POSIX AREs, not PCRE. `\y` is the word boundary;
 *     `\b` means a literal BACKSPACE and matches nothing you meant. `\d` and
 *     `\s` do work, but `[[:space:]]` / `[0-9]` are used where a migration
 *     already spelled it that way, so the two texts diff cleanly.
 *   * Every SQL string here is a `String.raw` template. A plain TS string would
 *     eat the backslashes — `'\FFFC'` is just `FFFC`, `'\.'` is just `.`, and
 *     `'\d'` is just `d` — turning a precise predicate into a much broader one
 *     that still runs and still returns a number. That is the worst possible
 *     failure mode for a check, so: raw, always.
 *
 * ## The statement contract
 *
 * ONE statement per check, returning EXACTLY ONE row, with these columns:
 *
 *   count      bigint  — offending rows. 0 means clean. Required.
 *   breakdown  jsonb   — optional `{key: n}` object; how the count splits by
 *                        the dimension that makes it diagnosable (usually
 *                        `source_system`, because "which importer did this?" is
 *                        the first question anyone asks).
 *   sample     jsonb   — optional one offending row, so a reader can see the
 *                        shape of the problem without writing a second query.
 *
 * One statement, and not one big union of fifty, for a reason learned the hard
 * way: a single CTE containing every check was tried during that session and
 * ONE slow arm took the entire audit down with it, after several minutes, with
 * nothing to show. Separate statements mean a slow check reports TIMEOUT and
 * the other eighteen still report their numbers. See {@link ImportDoctorService}
 * for the timeout mechanics.
 *
 * The `WITH bad AS (…) SELECT count(*), breakdown, sample FROM bad` shape is
 * deliberate too: `bad` is referenced three times, so Postgres materializes it
 * and the offending set is computed ONCE — count, breakdown and sample all read
 * the same scan rather than costing three.
 */

/**
 * How much a non-zero count matters.
 *
 * `high` is the gate: `ci-import doctor` exits non-zero when any high check is
 * non-zero, so it can sit in an agent's loop or a release check. Reserve it for
 * "this is provably wrong and there is a known fix" — a guard being violated, a
 * row that cannot be reached from anywhere, a job that will never run again.
 *
 * `medium` is "look at this, but it may be legitimate". The distinction is not
 * about how much a finding annoys you; it is about whether a machine can act on
 * it without a human deciding first. Future-dated events are the canonical
 * medium: three of them on the live appliance, all from `calendar`, all
 * correct, because a calendar is a list of things that have not happened yet.
 */
export type DoctorSeverity = 'high' | 'medium';

export interface DoctorCheck {
  /** Stable, kebab-case, never renamed — an agent's loop and a runbook both key on it. */
  id: string;
  severity: DoctorSeverity;
  /** One line, read as: what a NON-ZERO count means. Not what the check does. */
  title: string;
  /** The tables scanned. Printed next to a TIMEOUT so the reader knows what was slow. */
  scope: string;
  /**
   * What to do about a non-zero count — the sentence that turns a number into
   * an action. This is the field written FOR the agent: a fresh one with no
   * context should be able to read a finding and know where to go next.
   */
  remedy: string;
  /**
   * The guard or migration this predicate is a copy of, so the two stay
   * together. Null only where no such twin exists (the pipeline-health checks,
   * which watch a control plane rather than a data shape).
   */
  mirrors: string | null;
  /** One statement, one row, `count` / `breakdown` / `sample`. See the file header. */
  sql: string;
}

/**
 * A per-source count, as `{source_system: n}`.
 *
 * Factored out because eleven checks want the same thing and a typo in one copy
 * of it is invisible — the check still runs, still returns a count, and just
 * quietly reports its breakdown wrong. `COALESCE(…, '(null)')` because
 * `jsonb_object_agg` throws on a null key, and a null `source_system` is
 * exactly the kind of row a doctor should be able to report rather than crash
 * on.
 */
const breakdownBy = (column: string) =>
  `(SELECT jsonb_object_agg(k, n) FROM (SELECT COALESCE(${column}, '(null)') AS k, count(*) AS n FROM bad GROUP BY 1) g)`;

/** One offending row as jsonb, from the already-materialized `bad` set. */
const SAMPLE = `(SELECT to_jsonb(b) FROM bad b LIMIT 1)`;

/**
 * The checks, grouped in the order an import produces the data they inspect:
 * communications, then the people and places pulled out of them, then events
 * and content, then the enrichment control plane, then the search index.
 *
 * The doctor runs them in this order and reports in this order, which means the
 * output reads as a walk down the pipeline — useful when several checks fire at
 * once, because the earliest one is usually the cause and the rest the echo.
 */
export const DOCTOR_CHECKS: readonly DoctorCheck[] = [
  // ───────────────────────────────────────────────────────────────────────────
  // Communications
  // ───────────────────────────────────────────────────────────────────────────
  {
    id: 'comms-missing-thread-id',
    severity: 'high',
    title: 'Communications with no thread_id — the message exists but no conversation contains it',
    scope: 'ci.communications',
    remedy:
      'A message with no thread is unreachable from the thread view: it can only be found by search. ' +
      'Two backfills recover them — 20260819000746 re-derives the thread from the import staging rows ' +
      'the parse stage still holds, and 20260819000941 pairs up one-to-one iMessage rows by ' +
      'correspondent. If the breakdown names a source neither covers, the parser for that source is ' +
      'not emitting a thread key at all, which is a parser fix, not a backfill.',
    mirrors:
      'db/postgres/migrations/20260819000746_backfill_communications_thread_id_from_import_staging.sql',
    sql: String.raw`
      WITH bad AS (
        SELECT id, time, source_system, communication_type
          FROM ci.communications
         WHERE thread_id IS NULL
      )
      SELECT count(*)::bigint AS count,
             ${breakdownBy('source_system')} AS breakdown,
             ${SAMPLE} AS sample
        FROM bad
    `,
  },
  {
    id: 'comms-missing-participants',
    severity: 'high',
    title: 'Communications with neither a sender nor a recipient — a message from nobody to nobody',
    scope: 'ci.communications',
    remedy:
      'These rows cannot be attributed to a person, so they are invisible to every people-centric view ' +
      'and contribute nothing to entity resolution. 20260819000959 recovers the google_voice class by ' +
      'reading the counterpart back out of the staged filename; other sources need the participant ' +
      'edges filled by the `extract_people` / `link_communications` enrichment legs — run ' +
      '`ci-import backfill extract_people link_communications` before concluding the parser is at fault.',
    mirrors: 'db/postgres/migrations/20260819000959_recover_orphan_communication_participants.sql',
    sql: String.raw`
      WITH bad AS (
        SELECT id, time, source_system, direction
          FROM ci.communications
         WHERE from_entity_id IS NULL
           AND (to_entity_ids IS NULL OR cardinality(to_entity_ids) = 0)
      )
      SELECT count(*)::bigint AS count,
             ${breakdownBy('source_system')} AS breakdown,
             ${SAMPLE} AS sample
        FROM bad
    `,
  },
  {
    id: 'comms-placeholder-content',
    severity: 'high',
    title: 'Message bodies that are nothing but a U+FFFC/U+FFFD placeholder glyph',
    scope: 'ci.communications',
    remedy:
      'macOS stores an attachment-only iMessage as a single U+FFFC OBJECT REPLACEMENT CHARACTER, and a ' +
      'mis-decoded byte run comes out as U+FFFD. Both used to be copied through verbatim, producing a ' +
      'row whose entire text is one invisible control glyph — 22,321 of them on a real appliance. ' +
      '`sanitizeText`/`isAttachmentPlaceholderOnly` in push/canonical.ts now strip it on the way in; ' +
      '20260819000154 blanks the rows already written (and the ci.entities mirror label with them). ' +
      'A non-zero count here means rows were written by a build predating that fix.',
    mirrors: 'db/postgres/migrations/20260819000154_blank_placeholder_only_communication_content.sql',
    // Anchored (`^…$`), exactly as the migration is: a captioned attachment
    // ("U+FFFC Merry Christmas") is a real message the user wrote and is NOT a
    // finding. The second predicate requires at least one actual glyph, so a
    // legitimately whitespace-only body is not counted either.
    sql: String.raw`
      WITH bad AS (
        SELECT id, time, source_system, length(content) AS content_length
          FROM ci.communications
         WHERE content ~ ('^[[:space:]' || U&'\FFFC' || U&'\FFFD' || ']+$')
           AND content ~ ('[' || U&'\FFFC' || U&'\FFFD' || ']')
      )
      SELECT count(*)::bigint AS count,
             ${breakdownBy('source_system')} AS breakdown,
             ${SAMPLE} AS sample
        FROM bad
    `,
  },

  // ───────────────────────────────────────────────────────────────────────────
  // People and places
  // ───────────────────────────────────────────────────────────────────────────
  {
    id: 'position-not-a-place-name',
    severity: 'high',
    title: 'ci.position.name holding a coordinate pair, a media filename, a bare UUID stem, or a URI',
    scope: 'ci.position',
    remedy:
      'A fake place name is strictly worse than no place name: it renders in the Places view as though ' +
      'the place were already known, so nothing ever offers it a real one. NULL is the correct value — ' +
      'that is what makes the row a reverse-geocode candidate. `isNotAPlaceName` in push/inputs.ts ' +
      'blocks all four shapes at write time; 20260818212254 and 20260818235752 cleared the 64,917 rows ' +
      'written before it existed.',
    mirrors: 'src/domains/import/push/inputs.ts isNotAPlaceName (+ geocode isUriLocation)',
    // All four arms of isNotAPlaceName, in its order: coordinate text (with the
    // optional generic geo-label prefix, so the bare and labelled forms are one
    // arm exactly as COORDINATE_TEXT makes them one regex), URI, media
    // extension, bare UUID stem. Every arm compares btrim(name), matching
    // isMediaFilename, which trims before testing — without it a name carrying
    // stray whitespace is rejected by the guard and missed here, and the two
    // would disagree about the same string.
    sql: String.raw`
      WITH bad AS (
        SELECT id, time, name, source_system
          FROM ci.position
         WHERE name IS NOT NULL
           AND (   btrim(name) ~* '\.(jpe?g|png|heic|heif|gif|mov|mp4|m4v|avi|webp|dng|tiff?)$'
                OR btrim(name) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}([-_][0-9]+)?$'
                OR btrim(name) ~* '^[a-z][a-z0-9+.-]*://\S+$'
                OR btrim(name) ~* '^[[:space:]]*((location|position|coordinates?|coords?|point|waypoint|fix|gps)[[:space:]]*[-:]?[[:space:]]*)?[-+]?[0-9]{1,3}(\.[0-9]+)?[[:space:]]*,[[:space:]]*[-+]?[0-9]{1,3}(\.[0-9]+)?[[:space:]]*$')
      )
      SELECT count(*)::bigint AS count,
             ${breakdownBy('source_system')} AS breakdown,
             ${SAMPLE} AS sample
        FROM bad
    `,
  },
  {
    id: 'person-name-garbage',
    severity: 'high',
    title: 'Person entities named with a call-log heading, an export filename, or a raw newline',
    scope: 'ci.entities',
    remedy:
      'These are not people. "Missed call from", "Group Conversation - 2019-…Z.html" and a name ' +
      "containing a literal newline are all the export's own chrome, promoted to a Person row because " +
      'the parser read a heading where a contact should have been. 20260819002002 repairs the ' +
      "recoverable ones (strip the heading, keep the contact behind it) and falls back to the row's own " +
      'phone/email identifier for the rest; 20260818220731 deletes the filename rows outright, along ' +
      'with their identifiers, pipeline state and search index entries.',
    mirrors: 'db/postgres/migrations/20260819002002_repair_call_log_heading_person_entities.sql',
    // The three arms of that migration's `bad` CTE, verbatim. `\y` is Postgres's
    // word boundary — POSIX ARE, not PCRE, so the JS `\b` spelling would match a
    // literal backspace and silently find nothing. Merged rows are excluded
    // because a merged-away row keeps its old name by design and is no longer
    // displayed anywhere.
    sql: String.raw`
      WITH bad AS (
        SELECT entity_id, name, linked_table, owner_user_id
          FROM ci.entities
         WHERE entity_type = 'Person'
           AND merged_into_entity_id IS NULL
           AND name IS NOT NULL
           AND (   name ~* '^[[:space:]]*(missed|placed|received|recorded|voicemail)([[:space:]]+call)?[[:space:]]+(from|to|with)\y'
                OR name ~* '(\.(html?|json|csv|vcf|txt)$)|(^[[:space:]]*group conversation\y)'
                OR name ~ '[\n\r]')
      )
      SELECT count(*)::bigint AS count,
             ${breakdownBy('linked_table')} AS breakdown,
             ${SAMPLE} AS sample
        FROM bad
    `,
  },
  {
    id: 'person-bare-phone-name',
    severity: 'medium',
    title: 'Person entities whose whole name is a phone number — an unresolved contact',
    scope: 'ci.entities',
    remedy:
      'MEDIUM on purpose, and the one check here that is not evidence of a bug. When an export names ' +
      'nobody, the handle IS the honest display name — 20260819002002 deliberately WRITES this shape as ' +
      'its fallback. What a non-zero count means is that these contacts have never been resolved to a ' +
      'named person, which is a merge opportunity: 20260818220833 proposes exactly these as merge ' +
      'candidates by matching the last 10 digits against the `phones` property of named Person rows. ' +
      'Treat a rising number as "the address book was never imported", not as corruption.',
    mirrors:
      'db/postgres/migrations/20260818220833_propose_phone_matched_person_merge_candidates.sql (bare_phone CTE)',
    sql: String.raw`
      WITH bad AS (
        SELECT entity_id, name, owner_user_id
          FROM ci.entities
         WHERE entity_type = 'Person'
           AND COALESCE(is_active, true) = true
           AND merged_into_entity_id IS NULL
           AND name ~ '^\+?[0-9()\-.\s]{7,}$'
      )
      SELECT count(*)::bigint AS count,
             ${SAMPLE} AS sample
        FROM bad
    `,
  },
  {
    id: 'person-duplicate-names',
    severity: 'medium',
    title: 'Person entities sitting in exact-duplicate name groups — the same human, several times',
    scope: 'ci.entities',
    remedy:
      'The count is ROWS in duplicate groups, not the number of groups: three "Chris Czaplak" rows ' +
      'count as three. Identical names are the cheapest possible duplicate signal and the one entity ' +
      'resolution should never miss, so a large number means the identifier-claim path did not run — ' +
      'try `ci-import backfill extract_people heal_self_collation`. It is MEDIUM because two different ' +
      'people really can share a name, so a machine must not merge on this alone.',
    mirrors: null,
    // Grouped on (owner_user_id, name) rather than name alone: two accounts on
    // one appliance each knowing a "John Smith" is not a duplicate, and merging
    // across owners would be a data leak, not a cleanup.
    sql: String.raw`
      WITH dupe AS (
        SELECT owner_user_id, name, count(*) AS n
          FROM ci.entities
         WHERE entity_type = 'Person'
           AND COALESCE(is_active, true) = true
           AND merged_into_entity_id IS NULL
           AND name IS NOT NULL
           AND btrim(name) <> ''
         GROUP BY 1, 2
        HAVING count(*) > 1
      )
      SELECT COALESCE(sum(n), 0)::bigint AS count,
             (SELECT to_jsonb(d) FROM (SELECT name, n AS rows FROM dupe ORDER BY n DESC, name LIMIT 1) d) AS sample
        FROM dupe
    `,
  },

  // ───────────────────────────────────────────────────────────────────────────
  // Events and content
  // ───────────────────────────────────────────────────────────────────────────
  {
    id: 'events-location-without-name',
    severity: 'medium',
    title: 'Events whose metadata names a Location but whose location_name is NULL',
    scope: 'ci.events',
    remedy:
      'The source told us where this happened and the column that displays it is empty, so the event ' +
      'shows as placeless in the timeline and the map. Usually a mapping gap in the parser for the ' +
      'source named in the breakdown. Fix the mapping, then re-import — or run ' +
      '`ci-import backfill geocode` if the name is present but the coordinates are what is missing.',
    mirrors: 'db/postgres/migrations/20260818215813_null_calendar_location_name_urls.sql (the exclusion)',
    // Two exclusions, and neither is incidental — both stop this check firing
    // on rows that are CORRECT.
    //
    // The URI arm: 20260818215813 deliberately NULLs location_name when the
    // calendar's location field held a meeting-join link, because a URL is not
    // a place. Those rows KEEP the URL in metadata.Location, so without this
    // arm every repaired calendar row would be reported as a defect by the
    // check watching for the opposite defect. Same grammar as isUriLocation
    // (geocode/util/virtualLocations.ts).
    //
    // The `[^[:space:]]` arm: `btrim(x)` strips SPACES ONLY, not tabs or
    // newlines, so an emptiness test written as `NULLIF(btrim(x), '')` reads a
    // Location of "\n\n" as present. That is not a hypothetical — the first
    // run of this check against a live appliance returned exactly one row, and
    // it was a `calendar` event whose Location was two newlines. Requiring at
    // least one non-whitespace character is the test that was actually meant.
    sql: String.raw`
      WITH bad AS (
        SELECT event_id, start_time, source_system,
               left(btrim(metadata ->> 'Location'), 120) AS location
          FROM ci.events
         WHERE location_name IS NULL
           AND metadata ->> 'Location' ~ '[^[:space:]]'
           AND btrim(metadata ->> 'Location') !~* '^[a-z][a-z0-9+.-]*://\S+$'
      )
      SELECT count(*)::bigint AS count,
             ${breakdownBy('source_system')} AS breakdown,
             ${SAMPLE} AS sample
        FROM bad
    `,
  },
  {
    id: 'capture-events-without-content',
    severity: 'high',
    title: 'Capture events pointing at a file but carrying no ci.content row — the blank-thumbnail class',
    scope: 'ci.events, ci.content',
    remedy:
      'A photo or video event links to its binary ONLY through ci.content (type=media, external_id = ' +
      'the ci.files id); there is no FK. No content row means no thumbnail anywhere in the UI, which is ' +
      'how this was found — 2,098 blank tiles in the gallery. `destinationsFor` was omitting the ' +
      "'content' destination for dated capture.* events (fixed in 8abfb5de5); 20260818174213 backfills " +
      'the rows already written, joining through metadata.FileId.',
    mirrors: 'db/postgres/migrations/20260818174213_backfill_capture_content_rows.sql',
    // Requires metadata.FileId, exactly as the backfill does: a capture event
    // with no file reference has no binary to point at, so it is not a defect —
    // counting it would make this check fire forever on a corpus that has none.
    sql: String.raw`
      WITH bad AS (
        SELECT e.event_id, e.start_time, e.source_system, e.metadata ->> 'FileId' AS file_id
          FROM ci.events e
         WHERE e.category = 'capture'
           AND e.metadata ->> 'FileId' IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM ci.content c WHERE c.event_id = e.event_id)
      )
      SELECT count(*)::bigint AS count,
             ${breakdownBy('source_system')} AS breakdown,
             ${SAMPLE} AS sample
        FROM bad
    `,
  },
  {
    id: 'blank-social-affiliation-content',
    severity: 'high',
    title: 'ci.content rows for a connection or a subreddit membership — an entry with no body at all',
    scope: 'ci.content',
    remedy:
      'A LinkedIn connection and a moderated subreddit carry no Text, no Body and no URL, so the ' +
      'content row toContentInput built for them has a NULL text AND a NULL url — and ci.content has ' +
      'no title column, so nothing about the row renders in any Content view. `destinationsFor` was ' +
      "sending every social.* record to 'content' as well as 'events' (fixed by isSocialAffiliation in " +
      'push/canonical.ts); 20260819051916 deletes the rows already written. The facts are not lost ' +
      'either way: the connection is a ci.entities Person carrying the profile URL plus a dated ' +
      'social event, and the subreddit is an event titled r/<sub>.',
    mirrors: 'db/postgres/migrations/20260819051916_cleanup_blank_social_affiliation_content_rows.sql',
    // Provenance-scoped, exactly as the migration is: this watches the ONE
    // shape the router now withholds, not blank content rows in general. Other
    // sources produce blank rows for their own reasons (vcard contact cards
    // with no note, Amazon app purchases) and folding them in here would make
    // this check permanently non-zero for causes it says nothing about.
    //
    // Emptiness is `!~ '[^[:space:]]'` and not `btrim(x) = ''` for the reason
    // the events-location-without-name check documents: btrim strips SPACES
    // ONLY, so the btrim form reads a body of two newlines as present.
    sql: String.raw`
      WITH bad AS (
        SELECT id, source_system, source_id, source_data ->> 'Kind' AS kind
          FROM ci.content
         WHERE source_type = 'ci-import-tools'
           AND (
                (source_system = 'linkedin' AND source_data ->> 'Kind' = 'connection')
             OR (
                  source_system = 'reddit'
                  AND source_data ->> 'Kind' IN ('moderated_subreddit', 'subscribed_subreddit')
                )
               )
           AND external_id IS NULL
           AND coalesce(text, '') !~ '[^[:space:]]'
           AND coalesce(url, '') !~ '[^[:space:]]'
      )
      SELECT count(*)::bigint AS count,
             ${breakdownBy('source_system')} AS breakdown,
             ${SAMPLE} AS sample
        FROM bad
    `,
  },
  {
    id: 'content-media-mimetype-mismatch',
    severity: 'medium',
    title: "ci.content typed 'media' whose mimetype is not an image, video or audio type",
    scope: 'ci.content',
    remedy:
      "The type discriminator drives rendering: a row typed 'media' gets a player or a thumbnail, so an " +
      'ebook or an APK stamped media renders as a broken tile. 20260818224249 re-typed the Amazon ' +
      "Appstore rows ('application/vnd.android.package-archive') to 'app'. Each new mimetype in the " +
      'breakdown is a mapping the pushing parser got wrong — fix it at the source, then re-type the ' +
      'existing rows with a narrow backfill.',
    mirrors: 'db/postgres/migrations/20260818224249_backfill_amazon_appstore_content_type.sql',
    // NULL mimetype is excluded deliberately: "media with no declared type" is a
    // weaker and much more common smell (most importers never set one), and
    // folding it in here would bury the actual mismatches under it.
    sql: String.raw`
      WITH bad AS (
        SELECT id, source_system, mimetype, left(external_id, 80) AS external_id
          FROM ci.content
         WHERE type = 'media'
           AND mimetype IS NOT NULL
           AND mimetype !~* '^(image|video|audio)/'
      )
      SELECT count(*)::bigint AS count,
             ${breakdownBy('mimetype')} AS breakdown,
             ${SAMPLE} AS sample
        FROM bad
    `,
  },
  {
    id: 'events-dated-before-1990',
    severity: 'high',
    title: 'Events dated before 1990 — a date no personal-data export legitimately carries',
    scope: 'ci.events',
    remedy:
      'Almost always an epoch-unit bug: seconds parsed as milliseconds lands in 1970, and a missing or ' +
      'zero timestamp lands there exactly. One such row anchors the whole timeline — every zoom-to-fit ' +
      'and every date histogram is computed over the range it defines. Find the parser named in the ' +
      'breakdown and check what it does with an absent timestamp.',
    mirrors: null,
    sql: String.raw`
      WITH bad AS (
        SELECT event_id, start_time, source_system, event_type
          FROM ci.events
         WHERE start_time < TIMESTAMPTZ '1990-01-01T00:00:00Z'
      )
      SELECT count(*)::bigint AS count,
             ${breakdownBy('source_system')} AS breakdown,
             ${SAMPLE} AS sample
        FROM bad
    `,
  },
  {
    id: 'events-dated-in-future',
    severity: 'medium',
    title: 'Events dated after now — legitimate for a calendar, a bug for everything else',
    scope: 'ci.events',
    remedy:
      'MEDIUM because the breakdown is the whole answer: a calendar is a list of things that have not ' +
      'happened yet, and three future-dated `calendar` rows on the live appliance are all correct. Any ' +
      'OTHER source in the breakdown is a defect — a photo, a purchase or a message cannot have ' +
      'happened tomorrow, and a far-future date is the other half of the epoch-unit bug that ' +
      'events-dated-before-1990 catches (milliseconds parsed as seconds lands in the year 56,000). ' +
      'Predicted and inferred events are excluded: forecasting the future is what they are for.',
    mirrors: null,
    sql: String.raw`
      WITH bad AS (
        SELECT event_id, start_time, source_system, event_type
          FROM ci.events
         WHERE start_time > now()
           AND COALESCE(is_predicted, false) = false
           AND COALESCE(is_inferred, false) = false
      )
      SELECT count(*)::bigint AS count,
             ${breakdownBy('source_system')} AS breakdown,
             ${SAMPLE} AS sample
        FROM bad
    `,
  },
  {
    id: 'events-timestamped-at-import',
    severity: 'high',
    title: 'Events whose date is the moment they were imported, not the moment they happened',
    scope: 'ci.events',
    remedy:
      "An undated record stamped with the import run's wall clock — which is why a handful of Google " +
      'Maps saved places sit at the TOP of the timeline dated the day of the import, above everything ' +
      "that actually happened that week. `ci.events.time_source = 'ingest'` is the declared marker " +
      '(TemporalRepairStage sets it, and the column comment defines it as "stamped at import, i.e. not ' +
      'a real date"); the second arm is the structural backstop for the far more common case where ' +
      'nothing declared anything. Fix is in the parser: emit no date rather than `now()`, and let the ' +
      'UI say "no date".',
    mirrors: 'db/postgres/migrations/20260809184710_clean_stage_support.sql (time_source vocabulary)',
    // The one legitimate shape this can match is a LIVE capture ingested within
    // two seconds of the moment it records — genuinely "happened now, stored
    // now". That is what `time_source = 'source'` is excluded for (the export
    // said so, and it agreed), and why the breakdown is by source_system: a
    // `google_maps` row here is the bug, a live `capture` row is not. Two
    // seconds rather than one because a batch push writes created_at at commit
    // time, a beat after the row was built.
    sql: String.raw`
      WITH bad AS (
        SELECT event_id, start_time, created_at, source_system, time_source
          FROM ci.events
         WHERE created_at IS NOT NULL
           AND time_source IS DISTINCT FROM 'source'
           AND ( time_source = 'ingest'
              OR start_time BETWEEN created_at - INTERVAL '2 seconds' AND created_at + INTERVAL '2 seconds' )
      )
      SELECT count(*)::bigint AS count,
             ${breakdownBy('source_system')} AS breakdown,
             ${SAMPLE} AS sample
        FROM bad
    `,
  },

  // ───────────────────────────────────────────────────────────────────────────
  // Enrichment control plane
  //
  // Not data shapes but WORK: rows the pipeline still owes, in states from which
  // nothing will pick them up again without a nudge. They are here because a
  // clean-looking corpus with a stalled control plane is the failure mode that
  // looks most like success.
  // ───────────────────────────────────────────────────────────────────────────
  {
    id: 'pipeline-overdue-retries',
    severity: 'high',
    title: 'Failed pipeline_state rows whose next_attempt_at is already in the past',
    scope: 'ci.pipeline_state',
    remedy:
      'The retry was scheduled and the moment passed with nothing claiming it — either no worker is ' +
      'running for that stage, or the whole backlog is larger than the tick can drain. 172 of these ' +
      'were sitting on `enrich.geocode` with reason `provider_unavailable` during the live import. ' +
      'Check the stage named in the breakdown has a running consumer, then re-drive it with ' +
      '`ci-import backfill <leg>`.',
    mirrors: null,
    // Cheap regardless of table size: 20260809032723 creates a partial index on
    // (status, next_attempt_at) WHERE status = 'failed', which is exactly this
    // predicate.
    sql: String.raw`
      WITH bad AS (
        SELECT entity_type, stage, entity_id, attempts, next_attempt_at, left(reason, 160) AS reason
          FROM ci.pipeline_state
         WHERE status = 'failed'
           AND next_attempt_at IS NOT NULL
           AND next_attempt_at < now()
      )
      SELECT count(*)::bigint AS count,
             ${breakdownBy('stage')} AS breakdown,
             ${SAMPLE} AS sample
        FROM bad
    `,
  },
  {
    id: 'pipeline-quarantined',
    severity: 'high',
    title: 'Quarantined pipeline_state rows — permanently excluded from claim(), silently',
    scope: 'ci.pipeline_state',
    remedy:
      'Quarantine is the state that makes a stage LOOK healthy while doing nothing: claim() skips these ' +
      'rows, so the job runs, reports green, and writes nothing. Replaying the dead letters does not ' +
      'clear it — the quarantine outlives them. Read `reason`, fix the cause, then clear the rows for ' +
      'that stage explicitly before re-running the leg.',
    mirrors: null,
    sql: String.raw`
      WITH bad AS (
        SELECT entity_type, stage, entity_id, attempts, left(reason, 160) AS reason
          FROM ci.pipeline_state
         WHERE status = 'quarantined'
      )
      SELECT count(*)::bigint AS count,
             ${breakdownBy('stage')} AS breakdown,
             ${SAMPLE} AS sample
        FROM bad
    `,
  },
  {
    id: 'pipeline-dead-letters',
    severity: 'high',
    title: 'Dead letters never replayed — work the bus gave up on and nobody has looked at',
    scope: 'ci.pipeline_dead_letters',
    remedy:
      'Each row is one event the pipeline dropped, with the error that dropped it. These are the most ' +
      'information-dense rows in the whole appliance for working out what an import did wrong: during ' +
      'the live import eight of them said "Cannot find ffmpeg", which is a missing binary, not a data ' +
      'problem, and no other surface said so. Read the errors first, fix the cause, then replay.',
    mirrors: null,
    sql: String.raw`
      WITH bad AS (
        SELECT id, queue, event_name, stage, entity_type, failed_at, left(error, 160) AS error
          FROM ci.pipeline_dead_letters
         WHERE replayed_at IS NULL
      )
      SELECT count(*)::bigint AS count,
             ${breakdownBy('event_name')} AS breakdown,
             ${SAMPLE} AS sample
        FROM bad
    `,
  },
  {
    id: 'pipeline-orphan-shards',
    severity: 'medium',
    title: 'Shards still pending or running under a pipeline run that has already finished',
    scope: 'ci.pipeline_shards, ci.pipeline_runs',
    remedy:
      'The run reported done and part of its work never did. Nothing will pick these shards up — the ' +
      'run that owned them is finished — so whatever slice of the corpus they covered is simply ' +
      'missing from that stage. Re-run the stage for the affected keys, or delete the shards and start ' +
      'a fresh run for that leg.',
    mirrors: null,
    // Keyed on `finished_at IS NOT NULL` rather than a status list, following
    // 20260809032723's own reasoning for its unique index: the status vocabulary
    // belongs to the runner and will grow, while "finished" is structural.
    sql: String.raw`
      WITH bad AS (
        SELECT s.id, s.run_id, s.stage, s.shard_key, s.status, r.kind AS run_kind,
               r.status AS run_status, r.finished_at AS run_finished_at
          FROM ci.pipeline_shards s
          JOIN ci.pipeline_runs r ON r.id = s.run_id
         WHERE s.status IN ('pending', 'running')
           AND r.finished_at IS NOT NULL
      )
      SELECT count(*)::bigint AS count,
             ${breakdownBy('stage')} AS breakdown,
             ${SAMPLE} AS sample
        FROM bad
    `,
  },

  // ───────────────────────────────────────────────────────────────────────────
  // Search index
  //
  // Both of these ask about ci_search.VECTORS, never ci_search.embeddings, and
  // that is load-bearing. The vector table is the search CANDIDATE source; the
  // embedding is only a re-ranking boost. A row with an embedding and no vector
  // is invisible to search while every coverage metric keyed on embeddings
  // reports it as done — which is exactly how a corpus can be "100% indexed"
  // and return nothing.
  // ───────────────────────────────────────────────────────────────────────────
  {
    id: 'events-missing-search-vector',
    severity: 'medium',
    title: 'Events with no ci_search.vectors row and no skip marker — unfindable by search',
    scope: 'ci.events, ci_search.vectors, ci_search.index_skips',
    remedy:
      'Run `ci-import backfill search_index`. If the number does not move, the listener is not writing ' +
      'vectors at all — check for quarantined pipeline_state rows and dead letters on the index stage ' +
      'first (this doctor has a check for each), because a quarantined row makes the backfill report ' +
      'success while writing nothing.',
    mirrors: null,
    // index_skips are DECIDED rows, not failures — a record with nothing worth
    // embedding. Excluding them is what keeps this check from permanently
    // reporting a number that can never reach zero.
    sql: String.raw`
      WITH bad AS (
        SELECT e.event_id, e.start_time, e.source_system
          FROM ci.events e
         WHERE NOT EXISTS (
                 SELECT 1 FROM ci_search.vectors v
                  WHERE v.entity_type = 'event' AND v.entity_id = e.event_id)
           AND NOT EXISTS (
                 SELECT 1 FROM ci_search.index_skips s
                  WHERE s.entity_type = 'event' AND s.entity_id = e.event_id)
      )
      SELECT count(*)::bigint AS count,
             ${breakdownBy('source_system')} AS breakdown,
             ${SAMPLE} AS sample
        FROM bad
    `,
  },
  {
    id: 'communications-missing-search-vector',
    severity: 'medium',
    title: 'Communications with no ci_search.vectors row and no skip marker — unfindable by search',
    scope: 'ci.communications, ci_search.vectors, ci_search.index_skips',
    remedy:
      'Same remedy as events-missing-search-vector, and usually the same cause. Separate checks because ' +
      'the two tables are indexed by different listeners and one can stall without the other: a run ' +
      'where events are covered and communications are not points straight at the communication ' +
      'listener rather than at the index as a whole.',
    mirrors: null,
    sql: String.raw`
      WITH bad AS (
        SELECT c.id, c.time, c.source_system
          FROM ci.communications c
         WHERE NOT EXISTS (
                 SELECT 1 FROM ci_search.vectors v
                  WHERE v.entity_type = 'communication' AND v.entity_id = c.id)
           AND NOT EXISTS (
                 SELECT 1 FROM ci_search.index_skips s
                  WHERE s.entity_type = 'communication' AND s.entity_id = c.id)
      )
      SELECT count(*)::bigint AS count,
             ${breakdownBy('source_system')} AS breakdown,
             ${SAMPLE} AS sample
        FROM bad
    `,
  },
];

/** Every check id, for validation and for `--list`. */
export const DOCTOR_CHECK_IDS: readonly string[] = DOCTOR_CHECKS.map((check) => check.id);

/** Look one up by id. Undefined for an id that does not exist. */
export function findCheck(id: string): DoctorCheck | undefined {
  return DOCTOR_CHECKS.find((check) => check.id === id);
}
