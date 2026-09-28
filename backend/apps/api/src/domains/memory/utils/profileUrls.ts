/**
 * LinkedIn profile URLs as duplicate-person evidence.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * The same LinkedIn connection routinely lands twice: once from
 * `Connections.csv` (`properties.URL` holds the profile URL) and once from a
 * contacts vCard export of the same network (the URL survives only as a
 * `URL: https://www.linkedin.com/in/<slug>` line inside `properties.Notes`).
 * Ingest namespaces linked keys per source, so both rows are legitimately
 * distinct entities, and neither carries an email or phone the claim-based
 * detector could match on. What they share is the profile URL — which is, at
 * any instant, unique to one member — and nothing in the corpus reads it.
 *
 * ── The rule, in one place ──────────────────────────────────────────────────
 *
 * {@link adjudicateProfileUrls} is the ONLY judgement of what two people's
 * profile URLs say about them. The duplicate detector calls it to write
 * evidence, and the auto-merger calls it again on the live rows immediately
 * before each merge, both through {@link ProfileUrlHolders.adjudicate}. Two
 * call sites, one rule: a merge can never be justified by a verdict the
 * detector would no longer give.
 *
 *  - URL SETS are compared, not single URLs. Some vCards carry two LinkedIn
 *    records in one NOTE; an overlap rule would chain two different people
 *    together through that card. Only EQUAL sets are strong evidence.
 *  - Equal sets still need corroboration (a shared name token or an agreeing
 *    "Connected On" date) and must not contradict it (a different surname, or
 *    two stated connection dates that do not match). Slugs are re-assignable,
 *    so the URL alone is not allowed to carry a merge.
 *  - DISJOINT sets are the strongest negative evidence the corpus has: two
 *    people with the same name and different profiles are different people,
 *    and that veto applies even to a pair that also shares an email.
 *  - A URL stated by more than {@link PROFILE_URL_MAX_HOLDERS} people is not
 *    anyone's profile. It is removed from every holder's facts BEFORE the
 *    adjudicator sees them ({@link ProfileUrlHolders.cap}), by both callers,
 *    so it can neither carry a pair to the auto-merge tier nor veto one.
 *
 * Pure: no database access. The SQL helpers at the bottom only BUILD text.
 * Changing anything here that alters a verdict requires a
 * `DUPLICATE_SCORING_GENERATION` bump in `DuplicateDetectStage`, so pending
 * rows are rescored under the new rule.
 *
 * NOT the same function as `normalizeProfileUrl` in
 * `import/datasources/linkedin.ts`, which canonicalises owner-detection URLs
 * into a different shape. Keep the two separate.
 */

import {
  hasFamilyConflict,
  indexableTokens,
  tokenizePersonName,
  type TokenizedPersonName,
} from './personNameTokens';

/**
 * Evidence strength for a shared profile URL.
 *
 *  - **exact 0.95** — equal URL sets, corroborated, uncontradicted. The same
 *    tier as a shared email or an E.164-exact phone, and like them it folds
 *    without review.
 *  - **contested 0.8** — the URL agrees but something else does not (a
 *    surname, a connection date, or nothing corroborates it), or the sets only
 *    overlap. Strong enough to lead the review queue; never auto-merged.
 */
export const PROFILE_URL_SCORES = {
  exact: 0.95,
  contested: 0.8,
} as const;

/** The evidence kinds this module writes into `ci.merge_candidates.evidence`. */
export const PROFILE_URL_EVIDENCE = {
  /** The shared URL(s). Scored 0.95 (exact) or 0.8 (contested). */
  match: 'profile_url',
  /** Why an equal-URL pair was held back for review. Carries no weight. */
  check: 'profile_url_check',
  /** The URL sets overlap but are not equal. A veto. Carries no weight. */
  partial: 'profile_url_partial',
  /** Both sides state URLs and none match. A veto. Carries no weight. */
  conflict: 'profile_url_conflict',
} as const;

/** Markers carry information, not strength: they never raise a pair's score. */
const MARKER_KINDS: ReadonlySet<string> = new Set([
  PROFILE_URL_EVIDENCE.check,
  PROFILE_URL_EVIDENCE.partial,
  PROFILE_URL_EVIDENCE.conflict,
]);

/** True for every evidence kind this module owns — the ones it replaces on re-adjudication. */
export function isProfileUrlEvidenceKind(kind: string): boolean {
  return kind === PROFILE_URL_EVIDENCE.match || MARKER_KINDS.has(kind);
}

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

/**
 * `[http(s)://][www.|xx.|xxx.]linkedin.com/in/<slug>[/][?…][#…]` and nothing
 * else.
 *
 * Anchored at both ends: `/in/<slug>/details/…`, `/pub/…`, `/company/…`,
 * `/school/…`, `/profile/view?id=…` and `lnkd.in` short links are all refused.
 * A company page is not a person, a `/pub/` URL is a legacy format whose
 * trailing segments are not stable, and a short link says nothing about its
 * target without a network call.
 */
const PROFILE_URL_PATTERN =
  /^(?:https?:\/\/)?(?:(?:www|[a-z]{2,3})\.)?linkedin\.com\/in\/([^/?#\s]+)\/?(?:[?#]\S*)?$/i;

/**
 * Sentence punctuation that trails a URL typed into free text ("… /in/ada-l.").
 * Stripped before matching, because leaving it on would make the two copies of
 * one profile DISJOINT — i.e. manufacture a veto out of a full stop.
 */
const TRAILING_PUNCTUATION = /[.,;:!)\]}>'"]+$/;

/**
 * What a slug may contain once decoded and lower-cased: ASCII letters, digits,
 * `-` and `_`, or any non-ASCII character that is not whitespace or a control
 * character. Non-ASCII is deliberately broad — real vanity URLs carry accented
 * letters, other scripts and even emoji — while ASCII punctuation (`,`, `(`,
 * `'`…) is refused, because in a slug it is almost always text that ran into
 * the URL, and keeping it would make two copies of one profile disjoint.
 */
const SLUG_CHARACTERS = /^(?:[a-z0-9_-]|(?![\s\p{Cc}])\P{ASCII})+$/u;

/**
 * Invisible format characters (bidi marks, zero-width joiners/spaces, BOM).
 * Contact exports paste them into copied URLs; stripped so a marked and an
 * unmarked copy of the same slug agree.
 */
const FORMAT_CHARACTERS = /\p{Cf}/gu;

/** Shorter slugs are not vanity URLs anybody was issued; refuse them rather than guess. */
const MIN_SLUG_LENGTH = 3;

/**
 * The canonical `linkedin.com/in/<slug>` form of a member profile URL, or null
 * when `raw` is not one.
 *
 * The slug is percent-decoded, NFC-normalised, stripped of invisible format
 * characters and lower-cased, so the scheme,
 * `www.`/country subdomain, trailing slash, query string (`?trk=…`,
 * `?originalSubdomain=…`), fragment and letter case of two copies of the same
 * profile never make them differ.
 */
export function normalizeProfileUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') {
    return null;
  }

  const trimmed = raw.trim().replace(TRAILING_PUNCTUATION, '');
  const match = PROFILE_URL_PATTERN.exec(trimmed);

  if (match == null) {
    return null;
  }

  let slug: string;

  try {
    slug = decodeURIComponent(match[1]);
  } catch {
    // Malformed percent-encoding. Not a URL anyone could have followed.
    return null;
  }

  slug = slug.normalize('NFC').replace(FORMAT_CHARACTERS, '').toLowerCase();

  if ([...slug].length < MIN_SLUG_LENGTH || !SLUG_CHARACTERS.test(slug)) {
    return null;
  }

  return `linkedin.com/in/${slug}`;
}

// ---------------------------------------------------------------------------
// Facts
// ---------------------------------------------------------------------------

/** What one person's own record says about their LinkedIn identity. */
export interface ProfileFacts {
  /** Canonical profile URLs ({@link normalizeProfileUrl}). */
  urls: ReadonlySet<string>;
  /** LinkedIn "Connected On" dates, as `yyyy-mm-dd`. */
  connectedOn: ReadonlySet<string>;
  /** The display name, tokenized once. Null when there is no usable name. */
  name: TokenizedPersonName | null;
}

/** Scalar URL fields: `Connections.csv` writes `URL`; other importers may write `url`. */
const URL_KEYS = ['URL', 'url'] as const;
/** List URL fields: the vCard parser writes every card URL into `URLs`. */
const URL_LIST_KEYS = ['URLs', 'urls'] as const;
/** Note fields: the vCard parser keeps a LinkedIn card's `URL:` line only here. */
const NOTE_KEYS = ['Notes', 'notes'] as const;
/** `Connections.csv`'s "Connected On" column. */
const CONNECTED_ON_KEY = 'ConnectedOn';

/**
 * Every `properties` key {@link extractProfileFacts} reads. `SocialProfiles` is
 * deliberately absent — the vCard parser stores those values truncated, so a
 * match on one would be a match on a prefix — and so are `avatar_url`,
 * `website` and any URL that appears in prose.
 */
export const PROFILE_FACT_PROPERTY_KEYS = [
  ...URL_KEYS,
  ...URL_LIST_KEYS,
  ...NOTE_KEYS,
  CONNECTED_ON_KEY,
] as const;

/** `URL: <token>` at the start of a NOTE line. Only the first whitespace-free token counts. */
const NOTE_URL_LINE = /^[ \t]*URL:[ \t]*(\S+)/gim;
/** `Connected On: <date>` at the start of a NOTE line. */
const NOTE_CONNECTED_ON_LINE = /^[ \t]*Connected On:[ \t]*(.+?)[ \t]*$/gim;

const MONTHS: Readonly<Record<string, number>> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

/**
 * LinkedIn's `DD Mon YYYY` ("09 May 2014") as `yyyy-mm-dd`, or null.
 *
 * Only that shape: it is the one both the CSV column and the vCard NOTE line
 * carry, and a date parsed from any other shape would be a guess about which
 * field is the day.
 */
export function canonicalConnectedOn(raw: unknown): string | null {
  if (typeof raw !== 'string') {
    return null;
  }

  const match = /^(\d{1,2})\s+([A-Za-z]{3,})\.?\s+(\d{4})$/.exec(raw.trim());

  if (match == null) {
    return null;
  }

  const day = Number(match[1]);
  const month = MONTHS[match[2].slice(0, 3).toLowerCase()];

  if (month == null || day < 1 || day > 31) {
    return null;
  }

  return `${match[3]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function stringsOf(value: unknown): string[] {
  if (typeof value === 'string') {
    return [value];
  }

  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string');
  }

  return [];
}

/**
 * The profile facts one person's `properties` state.
 *
 * Reads ONLY {@link PROFILE_FACT_PROPERTY_KEYS}. A Notes value is read as a
 * record, not as prose: a URL counts only when it is the first token of a
 * line that starts `URL:`, which is the shape the LinkedIn vCard export
 * writes, so "met her via linkedin.com/in/…" in a hand-written note is not
 * evidence of anything.
 */
export function extractProfileFacts(
  properties: Readonly<Record<string, unknown>> | null | undefined,
  name: string | null | undefined,
): ProfileFacts {
  const props = properties ?? {};
  const urls = new Set<string>();
  const connectedOn = new Set<string>();

  const addUrl = (raw: string) => {
    const url = normalizeProfileUrl(raw);

    if (url != null) {
      urls.add(url);
    }
  };

  const addDate = (raw: string) => {
    const date = canonicalConnectedOn(raw);

    if (date != null) {
      connectedOn.add(date);
    }
  };

  for (const key of [...URL_KEYS, ...URL_LIST_KEYS]) {
    stringsOf(props[key]).forEach(addUrl);
  }

  for (const key of NOTE_KEYS) {
    for (const note of stringsOf(props[key])) {
      for (const match of note.matchAll(NOTE_URL_LINE)) {
        addUrl(match[1]);
      }

      for (const match of note.matchAll(NOTE_CONNECTED_ON_LINE)) {
        addDate(match[1]);
      }
    }
  }

  stringsOf(props[CONNECTED_ON_KEY]).forEach(addDate);

  return { urls, connectedOn, name: tokenizePersonName(name) };
}

// ---------------------------------------------------------------------------
// The adjudicator
// ---------------------------------------------------------------------------

/** Why an equal-URL pair was held back for a human. */
export type ProfileCheckReason = 'family_name_conflict' | 'connected_on_conflict' | 'uncorroborated';

/** What corroborated an equal-URL pair. */
export type ProfileCorroboration = 'connected_on' | 'name';

/**
 * What two people's profile URLs say about them.
 *
 *  - `absent` — at least one side states no profile URL. Says nothing.
 *  - `conflict` — both sides state URLs and none match. Different people.
 *  - `partial` — the sets overlap but differ: one card lists a profile the
 *    other does not. A human decides.
 *  - `review` — equal sets, but a guard failed.
 *  - `exact` — equal sets, corroborated, uncontradicted. The same person.
 */
export type ProfileVerdict =
  | { kind: 'absent' }
  | { kind: 'conflict'; left: string[]; right: string[] }
  | { kind: 'partial'; shared: string[]; left: string[]; right: string[] }
  | { kind: 'review'; urls: string[]; reasons: ProfileCheckReason[] }
  | { kind: 'exact'; urls: string[]; corroboratedBy: ProfileCorroboration[] };

function sorted(values: Iterable<string>): string[] {
  return [...values].sort();
}

function intersects(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  for (const value of left) {
    if (right.has(value)) {
      return true;
    }
  }

  return false;
}

/** A shared name token of at least two characters — initials do not corroborate. */
function sharesNameToken(left: TokenizedPersonName | null, right: TokenizedPersonName | null): boolean {
  if (left == null || right == null) {
    return false;
  }

  const rightTokens = new Set(indexableTokens(right));

  return indexableTokens(left).some((token) => rightTokens.has(token));
}

/**
 * Judge two people's profile facts. Symmetric in its verdict kind; `left`
 * and `right` in the result follow the argument order.
 */
export function adjudicateProfileUrls(left: ProfileFacts, right: ProfileFacts): ProfileVerdict {
  if (left.urls.size === 0 || right.urls.size === 0) {
    return { kind: 'absent' };
  }

  const shared = sorted([...left.urls].filter((url) => right.urls.has(url)));

  if (shared.length === 0) {
    return { kind: 'conflict', left: sorted(left.urls), right: sorted(right.urls) };
  }

  if (shared.length !== left.urls.size || shared.length !== right.urls.size) {
    return { kind: 'partial', shared, left: sorted(left.urls), right: sorted(right.urls) };
  }

  const reasons: ProfileCheckReason[] = [];

  if (left.name != null && right.name != null && hasFamilyConflict(left.name, right.name)) {
    reasons.push('family_name_conflict');
  }

  const bothDated = left.connectedOn.size > 0 && right.connectedOn.size > 0;
  const datesAgree = bothDated && intersects(left.connectedOn, right.connectedOn);

  if (bothDated && !datesAgree) {
    reasons.push('connected_on_conflict');
  }

  const corroboratedBy: ProfileCorroboration[] = [];

  if (datesAgree) {
    corroboratedBy.push('connected_on');
  }

  if (sharesNameToken(left.name, right.name)) {
    corroboratedBy.push('name');
  }

  if (corroboratedBy.length === 0) {
    reasons.push('uncorroborated');
  }

  if (reasons.length > 0) {
    return { kind: 'review', urls: shared, reasons };
  }

  return { kind: 'exact', urls: shared, corroboratedBy };
}

// ---------------------------------------------------------------------------
// The holder cap
// ---------------------------------------------------------------------------

/**
 * How many people may state one profile URL before it stops being evidence
 * about any of them.
 *
 * Above it the URL is not an identity, it is a shared page someone pasted
 * into many cards: a recruiter's profile in every candidate's notes, the
 * owner's own profile in every card they wrote. Treating it as identity
 * would fold a bare given-name match into the auto-merge tier, and would
 * fold contacts into the self Person when the pasted URL is the owner's.
 *
 * Six, the value of `MAX_GROUP_MEMBERS` in `DuplicateDetectStage` (its spec
 * pins the two together). Defined here rather than there because the
 * auto-merger applies the same cap to the live rows, and the memory domain
 * does not import the pipeline. Changing it is a
 * `DUPLICATE_SCORING_GENERATION` bump.
 */
export const PROFILE_URL_MAX_HOLDERS = 6;

/**
 * Who states each profile URL, across the owner's whole corpus. It holds
 * the counts the {@link PROFILE_URL_MAX_HOLDERS} cap reads.
 *
 * The cap is applied by REMOVING an over-common URL from each person's facts
 * ({@link cap}) before {@link adjudicateProfileUrls} sees them. Removal, not a
 * downgrade, because the URL says nothing about the person:
 *
 *  - two people who share only an over-common URL are `absent`, so the pair
 *    keeps whatever else it had (a 0.5 given-name match stays 0.5);
 *  - one person's over-common URL against another's own profile is not a
 *    `conflict` either, since the first card never stated its own profile;
 *  - a person's own profile still counts when the card also carries an
 *    over-common one.
 *
 * Callers go through {@link adjudicate}, so the cap and the verdict cannot be
 * separated. It is built from the whole corpus, never from a slice or a
 * page: a slice of 200 can hold two members of a 40-member group, and from
 * inside the slice that looks like a pair.
 *
 * Mutable on purpose. The detector builds one per slice and never changes
 * it. The auto-merger keeps one per drain and updates it as it merges (a
 * merged-away source stops holding its URLs, and the target is re-read), so
 * a cap decision late in a long drain uses the corpus as it is at that point.
 */
export class ProfileUrlHolders {
  /** url → everyone who states it. */
  private readonly holdersByUrl = new Map<string, Set<string>>();

  /** entity → what it stated when last recorded, so {@link set} can replace rather than accumulate. */
  private readonly urlsByEntity = new Map<string, ReadonlySet<string>>();

  constructor(facts: Iterable<readonly [string, ProfileFacts]> = []) {
    for (const [entityId, fact] of facts) {
      this.set(entityId, fact.urls);
    }
  }

  /** Record what `entityId` states NOW, replacing whatever it stated before. */
  set(entityId: string, urls: ReadonlySet<string>): void {
    this.delete(entityId);

    if (urls.size === 0) {
      return;
    }

    this.urlsByEntity.set(entityId, new Set(urls));

    for (const url of urls) {
      const holders = this.holdersByUrl.get(url);

      if (holders == null) {
        this.holdersByUrl.set(url, new Set([entityId]));
      } else {
        holders.add(entityId);
      }
    }
  }

  /** `entityId` states nothing any more: merged away, deactivated or deleted. */
  delete(entityId: string): void {
    const urls = this.urlsByEntity.get(entityId);

    if (urls == null) {
      return;
    }

    this.urlsByEntity.delete(entityId);

    for (const url of urls) {
      const holders = this.holdersByUrl.get(url);
      holders?.delete(entityId);

      if (holders?.size === 0) {
        this.holdersByUrl.delete(url);
      }
    }
  }

  /** Everyone who states `url`, in the order they were recorded. */
  holdersOf(url: string): string[] {
    return [...(this.holdersByUrl.get(url) ?? [])];
  }

  /** True when more than {@link PROFILE_URL_MAX_HOLDERS} people state `url`. */
  isOverCommon(url: string): boolean {
    return (this.holdersByUrl.get(url)?.size ?? 0) > PROFILE_URL_MAX_HOLDERS;
  }

  /** `facts` without its over-common URLs. The same object when none is. */
  cap(facts: ProfileFacts): ProfileFacts {
    const kept = [...facts.urls].filter((url) => !this.isOverCommon(url));

    return kept.length === facts.urls.size ? facts : { ...facts, urls: new Set(kept) };
  }

  /** {@link adjudicateProfileUrls} on both sides' {@link cap}ped facts. The only way either caller reaches a verdict. */
  adjudicate(left: ProfileFacts, right: ProfileFacts): ProfileVerdict {
    return adjudicateProfileUrls(this.cap(left), this.cap(right));
  }
}

// ---------------------------------------------------------------------------
// Verdict → evidence
// ---------------------------------------------------------------------------

/** One evidence item as `ci.merge_candidates.evidence` stores it. */
export interface ProfileEvidenceItem {
  kind: string;
  value: string;
  score: number;
}

/** Any evidence item — the detector's (numeric score) or one parsed back from a row (nullable). */
export interface EvidenceLike {
  kind: string;
  value: string;
  score: number | null;
}

/** The items a verdict contributes. Markers carry score 0: they inform, they never weigh. */
export function profileEvidenceFor(verdict: ProfileVerdict): ProfileEvidenceItem[] {
  switch (verdict.kind) {
    case 'absent':
      return [];
    case 'exact':
      return [
        { kind: PROFILE_URL_EVIDENCE.match, value: verdict.urls.join(', '), score: PROFILE_URL_SCORES.exact },
      ];
    case 'review':
      return [
        {
          kind: PROFILE_URL_EVIDENCE.match,
          value: verdict.urls.join(', '),
          score: PROFILE_URL_SCORES.contested,
        },
        { kind: PROFILE_URL_EVIDENCE.check, value: verdict.reasons.join(', '), score: 0 },
      ];
    case 'partial':
      return [
        {
          kind: PROFILE_URL_EVIDENCE.match,
          value: verdict.shared.join(', '),
          score: PROFILE_URL_SCORES.contested,
        },
        {
          kind: PROFILE_URL_EVIDENCE.partial,
          value: `${verdict.left.join(', ')} ≠ ${verdict.right.join(', ')}`,
          score: 0,
        },
      ];
    case 'conflict':
      return [
        {
          kind: PROFILE_URL_EVIDENCE.conflict,
          value: `${verdict.left.join(', ')} ≠ ${verdict.right.join(', ')}`,
          score: 0,
        },
      ];
  }
}

/**
 * Re-state a candidate's profile-URL evidence under `verdict`, and rescore it.
 *
 * Every existing `profile_url*` item is removed first, so the result depends
 * only on the verdict — applying it twice is applying it once, and a stale
 * item from an earlier adjudication can never survive a new one.
 *
 * The score is the strongest weighed item, exactly as the detector scores any
 * pair. A `partial` or `conflict` verdict then CAPS it at
 * {@link PROFILE_URL_SCORES.contested}: an email pair (0.95) whose two sides
 * state different LinkedIn profiles is a question for a human, and must not
 * sit at the auto-merge tier. The cap never raises a score — a name pair at
 * 0.62 stays at 0.62 with the conflict attached.
 */
export function applyProfileVerdict<E extends EvidenceLike>(
  candidate: { readonly score: number; readonly evidence: readonly E[] },
  verdict: ProfileVerdict,
): { score: number; evidence: Array<E | ProfileEvidenceItem> } {
  const evidence: Array<E | ProfileEvidenceItem> = [
    ...candidate.evidence.filter((item) => !isProfileUrlEvidenceKind(item.kind)),
    ...profileEvidenceFor(verdict),
  ];

  evidence.sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.kind.localeCompare(b.kind));

  let score = 0;

  for (const item of evidence) {
    if (!MARKER_KINDS.has(item.kind)) {
      score = Math.max(score, item.score ?? 0);
    }
  }

  if (verdict.kind === 'partial' || verdict.kind === 'conflict') {
    score = Math.min(score, PROFILE_URL_SCORES.contested);
  }

  return { score, evidence };
}

// ---------------------------------------------------------------------------
// SQL text — no access, only construction
// ---------------------------------------------------------------------------

/**
 * The one literal every URL {@link normalizeProfileUrl} accepts must contain.
 * The prefilter below tests for it; the spec proves the containment.
 */
export const PROFILE_URL_PREFILTER_TOKEN = 'linkedin';

/**
 * A cheap SQL predicate that NARROWS a Person load to rows that could hold a
 * profile URL. It is a superset test and must never be used as the matcher:
 * `normalizeProfileUrl` decides, in TypeScript, and has no SQL twin to drift
 * from. `->>` on an array yields its JSON text, so one ILIKE covers scalar,
 * list and note fields alike.
 */
export function profileUrlSqlPrefilter(alias: string): string {
  const fields = [...URL_KEYS, ...URL_LIST_KEYS, ...NOTE_KEYS]
    .map((key) => `${alias}.properties->>'${key}'`)
    .join(', ');

  return `concat_ws(' ', ${fields}) ILIKE '%${PROFILE_URL_PREFILTER_TOKEN}%'`;
}

/** {@link profileUrlSqlPrefilter} over the conventional `e` alias for `ci.entities`. */
export const PROFILE_URL_SQL_PREFILTER = profileUrlSqlPrefilter('e');

/**
 * A `jsonb_build_object(...)` of exactly the keys {@link extractProfileFacts}
 * reads, so a caller loads the few fields that matter rather than the whole
 * `properties` bag (which, for a vCard, includes every note and address).
 */
export function profileFactsSqlObject(alias: string): string {
  return `jsonb_build_object(${PROFILE_FACT_PROPERTY_KEYS.map(
    (key) => `'${key}', ${alias}.properties->'${key}'`,
  ).join(', ')})`;
}

/**
 * One row of {@link PROFILE_FACTS_CORPUS_SQL}: a live Person's name and the
 * fields {@link extractProfileFacts} reads.
 */
export interface ProfileFactsCorpusRow {
  entity_id: string;
  person_name: string | null;
  profile_props: Record<string, unknown> | null;
}

/**
 * Every live Person of the owner bound to `$1` that could state a profile
 * URL, with only the fields {@link extractProfileFacts} reads.
 *
 * The population {@link ProfileUrlHolders} counts over. The detector and the
 * auto-merger both load it with THIS text, so the holder cap means the same
 * thing at detection and at merge time: a second copy of the WHERE clause
 * that drifted (one counting deactivated people, say) would let a URL be
 * over-common to one caller and not to the other.
 */
export const PROFILE_FACTS_CORPUS_SQL = `SELECT e.entity_id,
              e.name AS person_name,
              ${profileFactsSqlObject('e')} AS profile_props
         FROM ci.entities e
        WHERE e.owner_user_id = $1::uuid
          AND e.entity_type = 'Person'
          AND COALESCE(e.is_active, true) = true
          AND e.merged_into_entity_id IS NULL
          AND ${PROFILE_URL_SQL_PREFILTER}`;
