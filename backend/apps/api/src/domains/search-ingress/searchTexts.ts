import {
  type PersonAddress,
  NORMALIZED_PERSON_FIELDS,
  formatPersonAddress,
  previewFromContent,
  readPersonAddresses,
} from '@ci/domains/memory';

import type { WeightedText } from './types';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * THE search-text builders: one definition of "what text represents this row".
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Each indexable entity type has exactly two projections here:
 *
 *  - `<type>SearchDocument` — the flat string the dense embedding is computed
 *    from (`null` when there is nothing worth embedding);
 *  - `<type>WeightedTexts` — the weighted parts the keyword tsvector is built
 *    from (empty when there is nothing to index).
 *
 * They were previously private methods on the `*SearchIndexListener`s, with the
 * content document duplicated a second time in the pipeline's `EmbedStage`.
 * Both the listeners and the pipeline's `index.embed*` / `index.vector*` stages
 * now call THESE functions, which is the property that matters: the same row
 * must produce byte-identical text on either path, or it embeds to two
 * different vectors depending on which path reached it and every distance
 * against it becomes a coin flip.
 *
 * The input shapes are STRUCTURAL — the fields each builder actually reads —
 * so a listener can pass its egress object and a pipeline stage can pass a row
 * aliased straight out of SQL. Where an egress type derives a field (a
 * communication's preview falls back to a clip of its content; a person's
 * name parts fall back from typed columns to the properties bag), the builder
 * re-applies the same derivation so a raw row and an egress object agree.
 */

/** Add a trimmed, non-empty string to the document's part set. */
function pushPart(parts: Set<string>, value: unknown): void {
  if (typeof value !== 'string') {
    return;
  }

  const normalized = value.trim();

  if (normalized.length === 0) {
    return;
  }

  parts.add(normalized);
}

function joinParts(parts: Set<string>): string | null {
  const result = Array.from(parts).join(' ');

  return result.length > 0 ? result : null;
}

// ---------------------------------------------------------------------------
// content
// ---------------------------------------------------------------------------

export interface ContentSearchFields {
  type?: string | null;
  title?: string | null;
  text?: string | null;
  url?: string | null;
  mimetype?: string | null;
}

export function contentSearchDocument(content: ContentSearchFields): string | null {
  const parts = new Set<string>();

  pushPart(parts, content.text);
  pushPart(parts, content.type);
  pushPart(parts, content.mimetype);
  pushPart(parts, content.title);
  pushPart(parts, content.url);

  return joinParts(parts);
}

export function contentWeightedTexts(content: ContentSearchFields): WeightedText[] {
  const parts: WeightedText[] = [];

  if (content.title) {
    parts.push({ text: content.title, weight: 10 });
  }

  if (content.text) {
    parts.push({ text: content.text, weight: 5 });
  }

  if (content.type) {
    parts.push({ text: content.type, weight: 3 });
  }

  if (content.url) {
    parts.push({ text: content.url, weight: 3 });
  }

  if (content.mimetype) {
    parts.push({ text: content.mimetype, weight: 1 });
  }

  return parts;
}

// ---------------------------------------------------------------------------
// communication
// ---------------------------------------------------------------------------

export interface CommunicationSearchFields {
  subject?: string | null;
  /**
   * May be the RAW stored preview: the same `preview ?? previewFromContent(content)`
   * fallback `CommunicationEntity`'s egress mapping applies is re-applied here,
   * so a row read straight from SQL and an already-materialized egress object
   * produce the same text. (Applying it to an egress object is a no-op — its
   * preview is already non-null wherever content is.)
   */
  preview?: string | null;
  content?: string | null;
}

function effectivePreview(communication: CommunicationSearchFields): string | null {
  return communication.preview ?? previewFromContent(communication.content);
}

export function communicationSearchDocument(communication: CommunicationSearchFields): string | null {
  // A Set, like every other type's document: a derived preview IS (a clip of)
  // the content, and duplicating it would both waste embedding tokens and hide
  // trivial one-liners from `embedSkipReason` ('ok' is trivial; 'ok ok' is
  // not). De-duplication also makes a raw row and an egress object — whose
  // preview the entity mapping has already materialized — produce the same
  // document.
  const parts = new Set<string>();

  pushPart(parts, communication.subject);
  pushPart(parts, effectivePreview(communication));
  pushPart(parts, communication.content);

  return joinParts(parts);
}

export function communicationWeightedTexts(communication: CommunicationSearchFields): WeightedText[] {
  const parts: WeightedText[] = [];
  const preview = effectivePreview(communication);

  if (communication.subject) {
    parts.push({ text: communication.subject, weight: 10 });
  }

  if (preview) {
    parts.push({ text: preview, weight: 5 });
  }

  return parts;
}

// ---------------------------------------------------------------------------
// event
// ---------------------------------------------------------------------------

export interface EventSearchFields {
  title?: string | null;
  description?: string | null;
  category?: string | null;
  eventType?: string | null;
  locationName?: string | null;
  startTime?: Date | string | null;
  sourceSystem?: string | null;
  metadata?: Record<string, unknown> | null;
}

const MEDIA_FILENAME_RE =
  /\.(jpe?g|png|gif|webp|heic|heif|tiff?|bmp|dng|raw|cr2|nef|mp4|mov|m4v|avi|mkv|webm|3gp|mpe?g|wmv)$/i;
const VIDEO_FILENAME_RE = /\.(mp4|mov|m4v|avi|mkv|webm|3gp|mpe?g|wmv)$/i;

/**
 * Compact "City, ST" from a reverse-geocoded address, mirroring the frontend
 * `shortPlace` helper. Returns null when the address can't be confidently
 * parsed; in that case the caller falls back to the raw locationName, which is
 * still useful tokens for the embedding even if it's a full address.
 */
function shortPlace(locationName?: string | null): string | null {
  const name = locationName?.trim();

  if (!name) {
    return null;
  }

  const parts = name
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length <= 1) {
    return name.length <= 28 ? name : null;
  }

  const withoutCountry = /^(usa|united states|us)$/i.test(parts[parts.length - 1])
    ? parts.slice(0, -1)
    : parts;

  const region = withoutCountry[withoutCountry.length - 1]?.replace(/\s*\d{4,}.*$/, '').trim();
  const city = withoutCountry.length >= 2 ? withoutCountry[withoutCountry.length - 2] : withoutCountry[0];

  const result = [city, region].filter(Boolean).join(', ');

  return result.length > 0 && result.length <= 28 ? result : null;
}

/**
 * Backend port of the frontend's `eventDisplayTitle`: rewrite a bare media
 * filename into "Photo · Topanga, CA · Jun 17, 2026" using capture time + place.
 * Authored titles (anything with whitespace that isn't a filename) pass
 * through. Returns null when neither path produces useful text, so the caller
 * can fall back to the raw title.
 */
export function eventDisplayTitle(event: {
  title?: string | null;
  startTime?: Date | string | null;
  locationName?: string | null;
  metadata?: Record<string, unknown> | null;
}): string | null {
  const title = event.title?.trim() ?? '';

  const mediaType = (event.metadata ?? {})['Media Type'];
  const mediaTypeStr = typeof mediaType === 'string' ? mediaType : null;

  const isMediaEvent =
    mediaTypeStr?.startsWith('image/') === true ||
    mediaTypeStr?.startsWith('video/') === true ||
    MEDIA_FILENAME_RE.test(title);

  const looksAuthored = /\s/.test(title) && !MEDIA_FILENAME_RE.test(title);

  if (title && (looksAuthored || !isMediaEvent)) {
    return title;
  }

  if (!isMediaEvent) {
    return title || null;
  }

  const isVideo = mediaTypeStr?.startsWith('video/') === true || VIDEO_FILENAME_RE.test(title);
  const noun = isVideo ? 'Video' : 'Photo';

  const place = shortPlace(event.locationName);

  const start =
    event.startTime instanceof Date ? event.startTime : event.startTime ? new Date(event.startTime) : null;
  const datePart =
    start && !isNaN(start.getTime())
      ? start.toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
          timeZone: 'UTC',
        })
      : null;

  const derived = [noun, place, datePart].filter((part): part is string => Boolean(part)).join(' · ');

  return derived || title || noun;
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/**
 * Calendar tokens for the capture time — "June 2026", "summer 2026" — so
 * date-fuzzy queries match. The raw timestamp on its own won't tokenize into
 * anything a user would type. Northern-hemisphere seasons; the user corpus is
 * Pacific/US for now, and "summer" still narrows the year either way.
 */
function captureDateTokens(startTime: Date | string | null | undefined): string[] {
  if (startTime == null) {
    return [];
  }

  const date = startTime instanceof Date ? startTime : new Date(startTime);

  if (isNaN(date.getTime())) {
    return [];
  }

  const month = date.getUTCMonth();
  const year = date.getUTCFullYear();
  const monthName = MONTH_NAMES[month];

  const season =
    month >= 2 && month <= 4
      ? 'spring'
      : month >= 5 && month <= 7
        ? 'summer'
        : month >= 8 && month <= 10
          ? 'autumn fall'
          : 'winter';

  return [`${monthName} ${year}`, `${season} ${year}`];
}

/** Importer-name → searchable words. "apple_photos" → "apple photos library". */
const SOURCE_SYSTEM_EXPANSIONS: Record<string, string> = {
  apple_photos: 'apple photos library',
  google_photos: 'google photos library',
  google_takeout: 'google takeout',
  gmail: 'gmail email',
  imessage: 'imessage messages',
  whatsapp: 'whatsapp messages',
  chromium: 'chrome browser history',
  chrome: 'chrome browser history',
  safari: 'safari browser history',
  firefox: 'firefox browser history',
  gpx: 'gpx location track',
  amazon: 'amazon order',
  paypal: 'paypal payment',
  venmo: 'venmo payment',
};

function sourceSystemSearchTokens(sourceSystem: string | null | undefined): string[] {
  if (!sourceSystem) {
    return [];
  }

  const key = sourceSystem.toLowerCase();
  const expansion = SOURCE_SYSTEM_EXPANSIONS[key];

  if (expansion) {
    return [expansion];
  }

  const humanized = key.replace(/[_-]+/g, ' ').trim();

  return humanized.length > 0 ? [humanized] : [];
}

function cameraSearchTokens(event: { metadata?: Record<string, unknown> | null }): string[] {
  const metadata = (event.metadata ?? {}) as Record<string, unknown>;
  const tokens: string[] = [];

  for (const key of ['Make', 'Model', 'Lens', 'LensModel', 'Camera']) {
    const value = metadata[key];

    if (typeof value === 'string' && value.trim().length > 0) {
      tokens.push(value.trim());
    }
  }

  return tokens;
}

export function eventSearchDocument(event: EventSearchFields): string | null {
  const parts = new Set<string>();

  // For media events (imported photos/videos) the raw title is a filename
  // ("DSC00838.jpg") with no semantic signal — substitute the human-friendly
  // "Photo · Topanga, CA · Jun 17, 2026" derived from capture time + place.
  // Non-media events fall through to the original title.
  pushPart(parts, eventDisplayTitle(event) ?? event.title ?? null);
  pushPart(parts, event.description ?? null);
  pushPart(parts, event.category ?? null);
  pushPart(parts, event.eventType ?? null);

  // Reverse-geocoded place name lets "photos at Topanga" hit media events that
  // would otherwise only carry a filename.
  pushPart(parts, event.locationName ?? null);

  // Date-fuzzy queries — "photos from June 2026" — need the calendar names in
  // the doc; the raw timestamp won't tokenize.
  for (const token of captureDateTokens(event.startTime)) {
    pushPart(parts, token);
  }

  // Source provenance expanded into searchable words so "apple photos library"
  // matches events whose sourceSystem is the snake_case importer id.
  for (const token of sourceSystemSearchTokens(event.sourceSystem)) {
    pushPart(parts, token);
  }

  // High-signal structured fields that capture sources (notably CI-Import-Tools)
  // record in event metadata. A curated allowlist of keys observed across
  // importers — extend as new sources land.
  const metadata = (event.metadata ?? {}) as Record<string, unknown>;
  const candidateKeys = [
    'Subject',
    'Text',
    'Track',
    'Artist',
    'Album',
    'Product',
    'Sender',
    'Book',
    'Author',
    'Title',
    'Name',
    'Notes',
    'Make',
    'Model',
    'Lens',
    'LensModel',
    'Camera',
  ];

  for (const key of candidateKeys) {
    pushPart(parts, metadata[key]);
  }

  const aliases = metadata['aliases'];

  if (Array.isArray(aliases)) {
    for (const alias of aliases) {
      pushPart(parts, alias);
    }
  }

  return joinParts(parts);
}

export function eventWeightedTexts(event: EventSearchFields): WeightedText[] {
  const parts: WeightedText[] = [];
  const displayTitle = eventDisplayTitle(event);

  if (displayTitle) {
    parts.push({ text: displayTitle, weight: 10 });
  } else if (event.title) {
    parts.push({ text: event.title, weight: 10 });
  }

  if (event.description) {
    parts.push({ text: event.description, weight: 5 });
  }

  if (event.category) {
    parts.push({ text: event.category, weight: 3 });
  }

  if (event.eventType) {
    parts.push({ text: event.eventType, weight: 3 });
  }

  if (event.locationName) {
    parts.push({ text: event.locationName, weight: 4 });
  }

  const cameraTokens = cameraSearchTokens(event);

  if (cameraTokens.length > 0) {
    parts.push({ text: cameraTokens.join(' '), weight: 4 });
  }

  const sourceTokens = sourceSystemSearchTokens(event.sourceSystem);

  if (sourceTokens.length > 0) {
    parts.push({ text: sourceTokens.join(' '), weight: 2 });
  }

  return parts;
}

// ---------------------------------------------------------------------------
// item
// ---------------------------------------------------------------------------

export interface ItemSearchFields {
  name?: string | null;
  description?: string | null;
  category?: string | null;
  subcategory?: string | null;
  brand?: string | null;
  model?: string | null;
  /** jsonb in the schema — stringified for the tsvector, ignored (non-string) in the document. */
  maintenanceNotes?: unknown;
  /**
   * The resolved NAME of the item's last-seen place — "where is my drill"
   * should match by place words. The listener resolves it via PlaceService;
   * the pipeline loader joins it straight off `ci.entities`.
   */
  lastSeenPlaceName?: string | null;
}

export function itemSearchDocument(item: ItemSearchFields): string | null {
  const parts = new Set<string>();

  pushPart(parts, item.name ?? null);
  pushPart(parts, item.description ?? null);
  pushPart(parts, item.category ?? null);
  pushPart(parts, item.subcategory ?? null);
  pushPart(parts, item.brand ?? null);
  pushPart(parts, item.model ?? null);
  pushPart(parts, item.maintenanceNotes ?? null);
  pushPart(parts, item.lastSeenPlaceName ?? null);

  return joinParts(parts);
}

export function itemWeightedTexts(item: ItemSearchFields): WeightedText[] {
  const parts: WeightedText[] = [];

  if (item.name) {
    parts.push({ text: item.name, weight: 10 });
  }

  if (item.description) {
    parts.push({ text: item.description, weight: 5 });
  }

  if (item.brand) {
    parts.push({ text: item.brand, weight: 5 });
  }

  if (item.model) {
    parts.push({ text: item.model, weight: 5 });
  }

  if (item.category) {
    parts.push({ text: item.category, weight: 3 });
  }

  if (item.subcategory) {
    parts.push({ text: item.subcategory, weight: 3 });
  }

  if (item.lastSeenPlaceName) {
    parts.push({ text: item.lastSeenPlaceName, weight: 8 });
  }

  if (item.maintenanceNotes) {
    const maintenanceNotes =
      typeof item.maintenanceNotes === 'string'
        ? item.maintenanceNotes
        : JSON.stringify(item.maintenanceNotes);
    if (maintenanceNotes.length > 0) {
      parts.push({ text: maintenanceNotes, weight: 1 });
    }
  }

  return parts;
}

// ---------------------------------------------------------------------------
// person
// ---------------------------------------------------------------------------

export interface PersonSearchFields {
  name?: string | null;
  description?: string | null;
  email?: string | null;
  firstName?: string | null;
  middleName?: string | null;
  lastName?: string | null;
  nickname?: string | null;
  pronouns?: string | null;
  birthDate?: string | null;
  isSelf?: boolean | null;
  gender?: string | null;
  jobTitle?: string | null;
  organization?: string | null;
  department?: string | null;
  website?: string | null;
  /**
   * Labelled addresses; flattened into the indexed text one line per address.
   * Absent on the bulk-index path, which loads the RAW jsonb bag — the list is
   * then read back out of `properties` instead.
   */
  addresses?: PersonAddress[] | null;
  address?: string | null;
  streetAddress?: string | null;
  streetAddress2?: string | null;
  city?: string | null;
  region?: string | null;
  country?: string | null;
  postalCode?: string | null;
  /**
   * The person's source-specific bag. May be the RAW jsonb (normalized keys
   * still present) — they are stripped here before stringifying, mirroring the
   * egress split, so a raw row and an egress Person index the same text.
   */
  properties?: Record<string, unknown> | null;
}

const NORMALIZED_PERSON_KEYS: ReadonlySet<string> = new Set(NORMALIZED_PERSON_FIELDS.map(([key]) => key));

function strippedPersonProperties(
  properties: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const bag: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(properties ?? {})) {
    if (!NORMALIZED_PERSON_KEYS.has(key)) {
      bag[key] = value;
    }
  }

  return bag;
}

export function personSearchDocument(person: PersonSearchFields): string | null {
  const parts = new Set<string>();

  pushPart(parts, person.name ?? null);
  pushPart(parts, person.description ?? null);

  // Normalized identity attributes are stripped from the egress bag and only
  // reachable through their named fields.
  pushPart(parts, person.firstName);
  pushPart(parts, person.lastName);
  pushPart(parts, person.nickname);
  pushPart(parts, person.email);
  pushPart(parts, person.jobTitle);
  pushPart(parts, person.organization);

  const properties = strippedPersonProperties(person.properties);
  // We don't have a schema on properties yet. These values are an accumulated
  // superset of values we've indexed in various places. Normalized keys are
  // not listed here: the egress bag no longer carries them (`organization` and
  // `job_title` were normalized later and are pushed from their named fields
  // above; they stay listed for rows written before that).
  const candidateKeys = ['occupation', 'bio', 'phone', 'organization', 'job_title'];

  for (const key of candidateKeys) {
    pushPart(parts, properties[key]);
  }

  const aliases = properties['aliases'];

  if (Array.isArray(aliases)) {
    for (const alias of aliases) {
      pushPart(parts, alias);
    }
  }

  return joinParts(parts);
}

export function personWeightedTexts(person: PersonSearchFields): WeightedText[] {
  const parts: WeightedText[] = [];

  if (person.name) {
    parts.push({ text: person.name, weight: 10 });
  }

  if (person.description) {
    parts.push({ text: person.description, weight: 5 });
  }

  // Normalized attributes (email, structured name, address, ...) indexed from
  // the named fields explicitly. `addresses` is the one non-string field in the
  // map, so it is flattened separately rather than dropped by the string filter.
  const normalized = NORMALIZED_PERSON_FIELDS.map(
    ([, fieldName]) => (person as Record<string, unknown>)[fieldName],
  )
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .concat(
      (person.addresses ?? readPersonAddresses(person.properties))
        .map((address) => [address.label, formatPersonAddress(address)].filter(Boolean).join(' '))
        .filter((line) => line.length > 0),
    )
    .join(' ');

  if (normalized.length > 0) {
    parts.push({ text: normalized, weight: 1 });
  }

  const properties = strippedPersonProperties(person.properties);

  if (Object.keys(properties).length > 0) {
    parts.push({ text: JSON.stringify(properties), weight: 1 });
  }

  return parts;
}

// ---------------------------------------------------------------------------
// file
// ---------------------------------------------------------------------------

export interface FileSearchFields {
  title?: string | null;
  description?: string | null;
  filename?: string | null;
  contentType?: string | null;
}

export function fileSearchDocument(file: FileSearchFields): string | null {
  const parts = new Set<string>();

  pushPart(parts, file.title ?? null);
  pushPart(parts, file.description ?? null);
  pushPart(parts, file.filename ?? null);
  pushPart(parts, file.contentType ?? null);

  return joinParts(parts);
}

export function fileWeightedTexts(file: FileSearchFields): WeightedText[] {
  const parts: WeightedText[] = [];

  if (file.title) {
    parts.push({ text: file.title, weight: 10 });
  }

  if (file.description) {
    parts.push({ text: file.description, weight: 5 });
  }

  if (file.filename) {
    parts.push({ text: file.filename, weight: 3 });
  }

  if (file.contentType) {
    parts.push({ text: file.contentType, weight: 1 });
  }

  return parts;
}

// ---------------------------------------------------------------------------
// browser-activity
// ---------------------------------------------------------------------------

export interface BrowserActivitySearchFields {
  title?: string | null;
  url?: string | null;
  properties?: Record<string, unknown> | null;
}

export function browserActivitySearchDocument(activity: BrowserActivitySearchFields): string | null {
  const parts = new Set<string>();

  pushPart(parts, activity.url ?? null);
  pushPart(parts, activity.title ?? null);
  pushPart(parts, activity.properties?.description ?? null);

  return joinParts(parts);
}

export function browserActivityWeightedTexts(activity: BrowserActivitySearchFields): WeightedText[] {
  const parts: WeightedText[] = [];

  if (activity.title) {
    parts.push({ text: activity.title, weight: 10 });
  }

  if (activity.url) {
    parts.push({ text: activity.url, weight: 5 });
  }

  const description = activity.properties?.description;
  if (typeof description === 'string' && description.length > 0) {
    parts.push({ text: description, weight: 3 });
  }

  return parts;
}
