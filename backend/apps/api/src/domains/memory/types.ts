import type { Point } from 'typeorm';
import { z } from 'zod';

import type {
  ObservationBoundingBox,
  ObservationLabelSource,
  ObservationResolutionMethod,
  ObservationSourceKind,
} from './entities/ObjectObservationEntity';
import type { PlaceKind } from './entities/PlaceEntity';
import { type NormalizedFieldMap, type PropertiesBag } from './normalizedProperties';
import type { AcquisitionMethod, UnitSystem } from './physicalProperties';

export const createContentSchema = z.object({
  type: z.string().optional(),
  title: z.string().optional(),
  text: z.string().optional(),
  url: z.string().optional(),
  mimetype: z.string().optional(),
  external_id: z.string().optional(),
  source_url: z.string().optional(),
  user_id: z.string().optional(),
  event_id: z.string().optional(),
});

export const updateContentSchema = z.object({
  type: z.string().optional(),
  title: z.string().optional(),
  text: z.string().optional(),
  url: z.string().optional(),
  mimetype: z.string().optional(),
  external_id: z.string().optional(),
  source_url: z.string().optional(),
  user_id: z.string().optional(),
  event_id: z.string().optional(),
});

export interface CreateEventDto {
  id?: string;
  title: string;
  description?: string;
  event_type?: string;
  category?: string;
  start_time: Date;
  end_time?: Date;
  location_name?: string;
  location_entity_id?: string;
  location_coordinates?: Point;
  participant_entity_ids?: string[];
  organizer_entity_id?: string;
  source_type?: string;
  source_system?: string;
  source_id?: string;
  confidence_score?: number;
  is_recurring?: boolean;
  recurrence_pattern?: Record<string, unknown>;
  is_all_day?: boolean;
  is_private?: boolean;
  priority?: number;
  metadata?: Record<string, unknown>;
  is_predicted?: boolean;
  is_inferred?: boolean;
  inference_sources?: Record<string, unknown>;
  tags?: string[];
  sentiment_score?: number;
  energy_level?: number;
  status?: string;
  sharing_level?: string;
  is_deleted?: boolean;
  external_sync_status?: string;
  parent_event_id?: string;
  created_by?: string;
  user_id?: string;
  duration_minutes?: number;
  user?: {
    id: string;
  };
  content?: CreateContentDto[];
}

export interface UpdateEventDto {
  id?: string;
  title?: string;
  description?: string;
  event_type?: string;
  category?: string;
  start_time?: Date;
  end_time?: Date;
  location_name?: string;
  location_entity_id?: string;
  location_coordinates?: Point;
  participant_entity_ids?: string[];
  organizer_entity_id?: string;
  source_type?: string;
  source_system?: string;
  source_id?: string;
  confidence_score?: number;
  is_recurring?: boolean;
  recurrence_pattern?: Record<string, unknown>;
  is_all_day?: boolean;
  is_private?: boolean;
  priority?: number;
  metadata?: Record<string, unknown>;
  is_predicted?: boolean;
  is_inferred?: boolean;
  inference_sources?: Record<string, unknown>;
  tags?: string[];
  sentiment_score?: number;
  energy_level?: number;
  status?: string;
  sharing_level?: string;
  is_deleted?: boolean;
  external_sync_status?: string;
  parent_event_id?: string;
  created_by?: string;
  user_id?: string;
  duration_minutes?: number;
  content?: CreateContentDto[];
}

export interface SearchEventDto {
  id?: string;
  title?: string;
  description?: string;
  eventType?: string;
  category?: string;
  startTime?: Date;
  endTime?: Date;
  locationName?: string;
  locationEntityId?: string;
  locationCoordinates?: Point;
  organizerEntityId?: string;
  sourceType?: string;
  sourceSystem?: string;
  sourceId?: string;
  confidenceScore?: number;
  isRecurring?: boolean;
  recurrencePattern?: object;
  isAllDay?: boolean;
  isPrivate?: boolean;
  priority?: number;
  metadata?: object;
  isPredicted?: boolean;
  isInferred?: boolean;
  inferenceSources?: object;
  sentimentScore?: number;
  energyLevel?: number;
  status?: string;
  isDeleted?: boolean;
  externalSyncStatus?: string;
  parentEventId?: string;
  createdBy?: string;
  userId?: string;
}

export interface CreateContentDto {
  id?: string;
  type: string;
  title?: string;
  text?: string;
  url?: string;
  mimetype?: string;
  external_id?: string;
  source_url?: string;
  source_data?: Record<string, unknown>;
  user_id?: string;
  event_id?: string;
  // Provenance triple for idempotent batch ingest and event auto-linking. See
  // content_source_triple_uniq and ContentService.createMany.
  source_type?: string;
  source_system?: string;
  source_id?: string;
  event?: {
    id: string;
  };
  user?: {
    id: string;
  };
}

export interface UpdateContentDto {
  type?: string;
  title?: string;
  text?: string;
  url?: string;
  mimetype?: string;
  external_id?: string;
  source_url?: string;
  source_data?: Record<string, unknown>;
  event?: {
    id: string;
  };
  user?: {
    id: string;
  };
}

export type SearchContentDto = UpdateContentDto;

export interface CreatePlaceDto {
  id?: string;
  entity_type?: string;
  name?: string;
  description?: string;
  properties?: Record<string, unknown>;
  type?: string;
  geo_format?: string;
  geolocation?: Record<string, unknown>;
  location_boundary?: Record<string, unknown>;
  estimated?: boolean;
  tracked?: boolean;
  uploaded?: boolean;
  user_id?: string;
  user?: {
    id: string;
  };
  parent?: {
    id: string;
  };
  /** Typed place columns (issue #1811) — entity-field names for repository.create. */
  locationPoint?: Point;
  placeKind?: PlaceKind;
  parentPlaceId?: string;
}

export interface UpdatePlaceDto {
  entity_type?: string;
  name?: string;
  description?: string;
  properties: {
    type?: string;
    geoformat?: string;
    geolocation?: Record<string, unknown>;
    locationBoundary?: Record<string, unknown>;
    estimated?: boolean;
    tracked?: boolean;
    uploaded?: boolean;
    [key: string]: unknown;
  };
  user_id?: string;
  parent?: {
    id: string;
  };
  /** Typed place columns (issue #1811). */
  latitude?: number;
  longitude?: number;
  place_kind?: PlaceKind | null;
  parent_place_id?: string | null;
}

export interface CreateFileDto {
  name?: string;
  description?: string;
  properties?: Record<string, unknown>;
  linkedId?: string;
  user?: {
    id: string;
  };
}

/**
 * The physical half of an item as CALLERS may supply it — deliberately looser
 * than the columns it lands in.
 *
 * Measurements accept a canonical number (`lengthMm: 304.8`) or any unit-
 * bearing string (`'12 in'`, `'5 ft 11 in'`), because the writers are a web
 * form, a vision model and an importer and only one of them thinks in
 * millimetres. Every value passes through `normalizePhysicalProperties` in
 * {@link ../physicalProperties} before it reaches the database, so the tolerance
 * stops here — nothing downstream sees a unit.
 */
export interface PhysicalItemPropertiesDto {
  /** MILLIMETRES, or any length string. */
  lengthMm?: number | string | null;
  /** MILLIMETRES, or any length string. */
  widthMm?: number | string | null;
  /** MILLIMETRES, or any length string. */
  heightMm?: number | string | null;
  /** GRAMS, or any mass string. */
  massG?: number | string | null;
  /** MILLILITRES (capacity), or any volume string. */
  volumeMl?: number | string | null;
  /** `'12 x 8 x 2 in'` — fills only the axes not given individually. */
  dimensions?: string | null;
  /** Display preference; never changes what the stored numbers mean. */
  unitSystem?: UnitSystem | string | null;
  colors?: string[] | string | null;
  colorHex?: string | null;
  materials?: string[] | string | null;
  /** `{material: fraction}`; percentages are accepted and converted. */
  composition?: Record<string, number | string> | null;
  acquisitionMethod?: AcquisitionMethod | string | null;
  acquiredFrom?: string | null;
  acquiredFromEntityId?: string | null;
  manufacturedAt?: Date | null;
  expiresAt?: Date | null;
  /** A digital item is refused a mass, a size and a volume. */
  isDigital?: boolean;
}

export interface CreateItemDto extends PhysicalItemPropertiesDto {
  id?: string;
  name: string;
  description?: string;
  category?: string;
  subcategory?: string;
  brand?: string;
  model?: string;
  purchasePrice?: number;
  currentValue?: number;
  currency?: string;
  /** When it was bought/received — the ownership clock, not the manufacture date. */
  acquiredAt?: Date;
  identifierCodes?: Record<string, unknown>;
  condition?: 'new' | 'like_new' | 'good' | 'fair' | 'poor' | 'broken' | 'n/a' | null;
  /** How many identical units this row stands for. Whole and positive. */
  quantity?: number;
  /**
   * How this unit's identity was established, and how much to trust it.
   * Defaults to 1.0 in the schema, which reads as ground truth to HBPE and RAG
   * — so anything INFERRED (a vision guess, a receipt line) must say so here.
   */
  identityMethod?: 'user' | 'barcode' | 'receipt' | 'vision' | 'import' | 'inferred';
  identityConfidence?: number;
  images?: string[];
  metadata?: Record<string, unknown>;
  // Provenance triple for idempotent re-ingest (see inventory_source_triple_uniq).
  sourceType?: string;
  sourceSystem?: string;
  sourceId?: string;
}

export interface UpdateItemDto extends PhysicalItemPropertiesDto {
  name?: string;
  description?: string;
  category?: string;
  subcategory?: string;
  brand?: string;
  model?: string;
  purchasePrice?: number;
  currentValue?: number;
  currency?: string;
  acquiredAt?: Date | null;
  condition?: 'new' | 'like_new' | 'good' | 'fair' | 'poor' | 'broken' | 'n/a' | null;
  quantity?: number;
  images?: string[];
  metadata?: Record<string, unknown> | undefined;
}

// ---------------------------------------------------------------------------
// Object observations — the SIGHTING half of object identity
// ---------------------------------------------------------------------------

/**
 * A geographic point for an observation, named the way humans say it.
 *
 * Deliberately NOT TypeORM's `Point` (which is `{x, y}` and therefore silent
 * about which one is which): every caller here is copying a `lat`/`lon` pair
 * out of a capture payload, and the one bug that matters in this area is
 * transposing them. `ObjectObservationService` does the swap to PostGIS'
 * `ST_MakePoint(lon, lat)` in exactly one place.
 */
export interface ObservationCoordinates {
  lat: number;
  lon: number;
}

/**
 * A sighting, as handed to {@link ObjectObservationService.create}.
 *
 * Carries DETECTION only. There is deliberately no way to set
 * `resolvedObjectId`, `resolutionMethod` or `confirmedByUser` here — resolution
 * is a separate, revisable decision reached through `resolve()` / `confirm()`,
 * and a detector that could write it on the way in is the conflation
 * `ci.object_observations` exists to prevent.
 *
 * `detectionKey` is absent for the same reason it is absent from the entity's
 * public constructor surface: it is DERIVED by the service (see
 * `detectionKeyFor`), never supplied. A caller-chosen key is a caller-chosen
 * idempotency contract, which is how the same detector run lands twice.
 */
export interface CreateObjectObservationDto {
  id?: string;
  /** When the pixels were captured — NOT when the detector ran. */
  observedAt: Date;
  sourceKind?: ObservationSourceKind;

  /** What the detector said, verbatim. Required: a label-less sighting carries no information. */
  label: string;
  labelSource?: ObservationLabelSource | null;
  detector?: string | null;
  detectorVersion?: string | null;
  /** Detector confidence in [0, 1]. Clamped, never fabricated. */
  detectionConfidence?: number | null;
  bbox?: ObservationBoundingBox | null;

  /** Where the pixels live. No FKs — content and files are purgeable. */
  contentId?: string | null;
  fileId?: string | null;
  eventId?: string | null;
  cropContentId?: string | null;

  /** The resolution prior. See the note on `place_entity_id` in the migration. */
  placeEntityId?: string | null;
  coordinates?: ObservationCoordinates | null;

  attributes?: Record<string, unknown>;
  metadata?: Record<string, unknown>;

  /**
   * Provenance triple — the idempotency arbiter for IMPORTED observations and
   * for any source that carries a stable per-detection id of its own. When
   * `sourceId` is set the row is keyed on the triple and `detection_key` stays
   * NULL; when it is absent the service derives a `detection_key`. A row has
   * one arbiter or the other, never both.
   */
  sourceType?: string | null;
  sourceSystem?: string | null;
  sourceId?: string | null;
}

/**
 * A resolution decision, applied by {@link ObjectObservationService.resolve}.
 *
 * Never sets `confirmedByUser` — that flag has exactly one writer
 * (`confirm()`), because HBPE and RAG are entitled to read it as "a human said
 * so" rather than "something was fairly sure".
 */
export interface ResolveObjectObservationDto {
  resolvedObjectId?: string | null;
  resolvedProductId?: string | null;
  /** How the link was reached. `'user'` is rejected here; use `confirm()`. */
  resolutionMethod: Exclude<ObservationResolutionMethod, 'user'>;
  /** Confidence in [0, 1]. Omit rather than invent one. */
  resolutionConfidence?: number | null;
}

/** Scoped read filter for {@link ObjectObservationService.find}. */
export interface FindObjectObservationsFilter {
  placeEntityId?: string;
  contentId?: string;
  fileId?: string;
  eventId?: string;
  /** Exact label match, case-insensitive. */
  label?: string;
  /** `true` = only rows linked to an owned unit; `false` = only unlinked. */
  resolved?: boolean;
  confirmedByUser?: boolean;
  observedFrom?: Date;
  observedTo?: Date;
  limit?: number;
  offset?: number;
}

export interface CreatePersonDto {
  id?: string;
  name?: string;
  description?: string;
  searchContent?: string;
  linkedId?: string;
  linkedTable?: string;
  lastAccessed?: Date;
  properties?: {
    email?: string;
    firstName?: string;
    lastName?: string;
    contactType?: string;
    ownerUserId?: string;
    connectionId?: string;
    sources?: string[];
    [key: string]: unknown;
  };
}

export interface UpdatePersonDto {
  name?: string;
  description?: string;
  searchContent?: string;
  linkedId?: string;
  linkedTable?: string;
  lastAccessed?: Date;
  properties?: {
    email?: string;
    firstName?: string;
    lastName?: string;
    contactType?: string;
    ownerUserId?: string;
    connectionId?: string;
    sources?: string[];
    [key: string]: unknown;
  };
}

/**
 * The `properties` keys that `PersonEntity` promotes to named domain fields,
 * paired as `[jsonb storage key, camelCase field name]`. The single source of
 * truth for splitting a person's jsonb bag on egress and mapping a domain input
 * back onto it.
 */
export const NORMALIZED_PERSON_FIELDS = [
  ['email', 'email'],
  ['first_name', 'firstName'],
  ['middle_name', 'middleName'],
  ['last_name', 'lastName'],
  ['nickname', 'nickname'],
  ['pronouns', 'pronouns'],
  ['birth_date', 'birthDate'],
  ['is_self', 'isSelf'],
  ['gender', 'gender'],
  ['job_title', 'jobTitle'],
  ['organization', 'organization'],
  ['department', 'department'],
  ['website', 'website'],
  // The labelled multi-address list (home / work / ...). The flat `address`,
  // `street_address`, ... keys below predate it and are kept as a mirror of the
  // PRIMARY address so existing readers (search projection, importers) still
  // resolve one address without understanding the list.
  ['addresses', 'addresses'],
  ['address', 'address'],
  ['street_address', 'streetAddress'],
  ['street_address_2', 'streetAddress2'],
  ['city', 'city'],
  ['region', 'region'],
  ['country', 'country'],
  ['postal_code', 'postalCode'],
] as const satisfies NormalizedFieldMap;

/**
 * One labelled postal address on a person, stored inside the `addresses` jsonb
 * array. The field names deliberately match the flat `street_address`, `city`,
 * ... property keys so mirroring the primary address to the top level is a
 * plain key copy.
 */
export interface PersonAddress {
  /** 'home', 'work', or any user-supplied label. Null for un-labelled legacy rows. */
  label: string | null;
  streetAddress: string | null;
  streetAddress2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  country: string | null;
  isPrimary: boolean;
}

/** The jsonb storage shape of a {@link PersonAddress} (snake_case, as stored). */
interface StoredPersonAddress {
  label?: unknown;
  street_address?: unknown;
  street_address_2?: unknown;
  city?: unknown;
  region?: unknown;
  postal_code?: unknown;
  country?: unknown;
  is_primary?: unknown;
}

function asTrimmedText(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();

  return trimmed === '' ? null : trimmed;
}

/** True when an address carries at least one line worth persisting/showing. */
export function isPersonAddressEmpty(address: PersonAddress): boolean {
  return (
    address.streetAddress == null &&
    address.streetAddress2 == null &&
    address.city == null &&
    address.region == null &&
    address.postalCode == null &&
    address.country == null
  );
}

/** Render an address as a single comma-joined line (the `address` mirror key). */
export function formatPersonAddress(address: PersonAddress): string | null {
  const line = [
    address.streetAddress,
    address.streetAddress2,
    address.city,
    address.region,
    address.postalCode,
    address.country,
  ]
    .filter((part): part is string => part != null && part.length > 0)
    .join(', ');

  return line === '' ? null : line;
}

/** Read one stored address object into its named-field form. */
function toPersonAddress(stored: StoredPersonAddress): PersonAddress {
  return {
    label: asTrimmedText(stored.label),
    streetAddress: asTrimmedText(stored.street_address),
    streetAddress2: asTrimmedText(stored.street_address_2),
    city: asTrimmedText(stored.city),
    region: asTrimmedText(stored.region),
    postalCode: asTrimmedText(stored.postal_code),
    country: asTrimmedText(stored.country),
    isPrimary: stored.is_primary === true,
  };
}

/** Serialize an address back to its jsonb storage shape. */
export function serializePersonAddress(address: PersonAddress): Record<string, unknown> {
  return {
    label: address.label,
    street_address: address.streetAddress,
    street_address_2: address.streetAddress2,
    city: address.city,
    region: address.region,
    postal_code: address.postalCode,
    country: address.country,
    is_primary: address.isPrimary,
  };
}

/**
 * Read a person's address list out of the raw properties bag.
 *
 * Rows written before the list existed carry only the flat `street_address`,
 * `city`, ... keys; those are surfaced as a single un-labelled primary address
 * so every reader sees one shape regardless of when the row was written.
 */
export function readPersonAddresses(properties: Record<string, unknown> | null | undefined): PersonAddress[] {
  const raw = properties?.addresses;

  if (Array.isArray(raw)) {
    const addresses = raw
      .filter((entry): entry is StoredPersonAddress => typeof entry === 'object' && entry !== null)
      .map(toPersonAddress)
      .filter((address) => !isPersonAddressEmpty(address));

    if (addresses.length > 0) {
      return ensureSinglePrimary(addresses);
    }
  }

  const legacy: PersonAddress = {
    label: null,
    streetAddress: asTrimmedText(properties?.street_address),
    streetAddress2: asTrimmedText(properties?.street_address_2),
    city: asTrimmedText(properties?.city),
    region: asTrimmedText(properties?.region),
    postalCode: asTrimmedText(properties?.postal_code),
    country: asTrimmedText(properties?.country),
    isPrimary: true,
  };

  return isPersonAddressEmpty(legacy) ? [] : [legacy];
}

/**
 * Exactly one address is primary: the first one flagged, else the first entry.
 * Callers (and the flat mirror) rely on `addresses[0]` NOT being the primary by
 * accident, so the primary is also hoisted to the front.
 */
export function ensureSinglePrimary(addresses: PersonAddress[]): PersonAddress[] {
  if (addresses.length === 0) {
    return addresses;
  }

  const primaryIndex = Math.max(
    addresses.findIndex((address) => address.isPrimary),
    0,
  );

  const ordered = [addresses[primaryIndex]!, ...addresses.filter((_, index) => index !== primaryIndex)];

  return ordered.map((address, index) => ({ ...address, isPrimary: index === 0 }));
}

/** Union of the jsonb storage keys promoted to named fields on a person. */
export type NormalizedPersonPropertyKey = (typeof NORMALIZED_PERSON_FIELDS)[number][0];

/**
 * A person's egress `properties` bag: source-specific data only, with the
 * normalized keys forbidden at compile time so they are reached solely through
 * their named fields.
 */
export type PersonProperties = PropertiesBag<NormalizedPersonPropertyKey>;

export interface CreateConceptDto {
  id?: string;
  name?: string;
  description?: string;
  searchContent?: string;
  linkedId?: string | null;
  linkedTable?: string | null;
  lastAccessed?: Date;
  properties?: Record<string, unknown>;
}

export interface UpdateConceptDto {
  name?: string;
  description?: string;
  searchContent?: string;
  linkedId?: string | null;
  linkedTable?: string | null;
  lastAccessed?: Date;
  properties?: Record<string, unknown>;
}

export enum CommunicationType {
  EMAIL = 'email',
  SMS = 'sms',
  CALL = 'call',
  CHAT = 'chat',
  VIDEO_CALL = 'video_call',
  VOICE_NOTE = 'voice_note',
  POST = 'post',
}

export enum CommunicationDirection {
  INBOUND = 'inbound',
  OUTBOUND = 'outbound',
  INTERNAL = 'internal',
  ASYNC = 'async',
  ONGOING = 'ongoing',
}
export interface CreateCommunicationDto {
  id?: string;
  time: Date;
  communication_type: CommunicationType;
  direction: 'inbound' | 'outbound';
  thread_id?: string;
  user_id?: string;
  event_id?: string;
  device_id?: string;
  from_entity_id?: string;
  to_entity_ids?: string[];
  participants_metadata?: Record<string, unknown>;
  subject?: string;
  content: string;
  attachments?: unknown[];
  duration_seconds?: number;
  sentiment_score?: number;
  importance_score?: number;
  urgency_score?: number;
  category?: string;
  summary?: string;
  connection_id?: string;
  is_encrypted?: boolean;
  is_archived?: boolean;
  preview?: string | null;
  // Provenance triple for idempotent re-ingest (see communications_source_triple_uniq).
  source_type?: string;
  source_system?: string;
  source_id?: string;
}

export const createCommunicationSchema = z.object({
  time: z.string(),
  communication_type: z.enum(['email', 'sms', 'call']),
  direction: z.enum(['inbound', 'outbound']),
  thread_id: z.string().optional(),
  device_id: z.string().optional(),
  from_entity_id: z.string().optional(),
  to_entity_ids: z.array(z.string()).optional(),
  participants_metadata: z.record(z.unknown()).optional(),
  subject: z.string().optional(),
  content: z.string(),
  attachments: z.array(z.unknown()).optional(),
  duration_seconds: z.number().optional(),
  sentiment_score: z.number().optional(),
  importance_score: z.number().optional(),
  urgency_score: z.number().optional(),
  category: z.string().optional(),
  summary: z.string().optional(),
  connection_id: z.string().optional(),
  is_encrypted: z.boolean().optional(),
  is_archived: z.boolean().optional(),
  preview: z.string().optional(),
});

export interface UpdateCommunicationDto {
  time?: Date;
  communication_type?: 'email' | 'sms' | 'call';
  direction?: 'inbound' | 'outbound';
  thread_id?: string;
  device_id?: string;
  from_entity_id?: string;
  to_entity_ids?: string[];
  participants_metadata?: Record<string, unknown>;
  subject?: string;
  content: string;
  attachments?: unknown[];
  duration_seconds?: number;
  sentiment_score?: number;
  importance_score?: number;
  urgency_score?: number;
  category?: string;
  summary?: string;
  connection_id?: string;
  is_encrypted?: boolean;
  is_archived?: boolean;
  preview?: string | null;
}

export const updateCommunicationSchema = z.object({
  time: z.string().optional(),
  communication_type: z.enum(['email', 'sms', 'call']).optional(),
  direction: z.enum(['inbound', 'outbound']).optional(),
  thread_id: z.string().optional(),
  device_id: z.string().optional(),
  from_entity_id: z.string().optional(),
  to_entity_ids: z.array(z.string()).optional(),
  participants_metadata: z.record(z.unknown()).optional(),
  subject: z.string().optional(),
  content: z.string().optional(),
  attachments: z.array(z.unknown()).optional(),
  duration_seconds: z.number().optional(),
  sentiment_score: z.number().optional(),
  importance_score: z.number().optional(),
  urgency_score: z.number().optional(),
  category: z.string().optional(),
  summary: z.string().optional(),
  connection_id: z.string().optional(),
  is_encrypted: z.boolean().optional(),
  is_archived: z.boolean().optional(),
  preview: z.string().optional(),
});

const createEventSchemaRoot = z.object({
  title: z.string(),
  description: z.string().optional(),
  event_type: z.string().optional(),
  category: z.string().optional(),
  start_time: z.string().datetime(),
  end_time: z.string().datetime().optional(),
  location_name: z.string().optional(),
  location_coordinates: z
    .object({
      type: z.string(),
      coordinates: z.array(z.number()),
    })
    .optional(),
  location_entity_id: z.string().optional(),
  participant_entity_ids: z.array(z.string()).optional(),
  organizer_entity_id: z.string().optional(),
  source_type: z.string().optional(),
  source_system: z.string().optional(),
  source_id: z.string().optional(),
  confidence_score: z.number().optional(),
  is_recurring: z.boolean().optional(),
  recurrence_pattern: z.record(z.unknown()).optional(),
  is_all_day: z.boolean().optional(),
  is_private: z.boolean().optional(),
  priority: z.number().optional(),
  metadata: z.record(z.unknown()).optional(),
  is_predicted: z.boolean().optional(),
  is_inferred: z.boolean().optional(),
  inference_sources: z.record(z.unknown()).optional(),
  tags: z.array(z.string()).optional(),
  sentiment_score: z.number().optional(),
  energy_level: z.number().optional(),
  status: z.string().optional(),
  is_deleted: z.boolean().optional(),
  external_sync_status: z.string().optional(),
  parent_event_id: z.string().optional(),
  created_by: z.string().optional(),
  content: z.array(createContentSchema).optional(),
});

export const createEventSchema = z.union([createEventSchemaRoot, z.array(createEventSchemaRoot)]);

export const updateEventSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  event_type: z.string().optional(),
  category: z.string().optional(),
  start_time: z.string().datetime().optional(),
  end_time: z.string().datetime().optional(),
  location_name: z.string().optional(),
  location_entity_id: z.string().optional(),
  location_coordinates: z
    .object({
      type: z.string(),
      coordinates: z.array(z.number()),
    })
    .optional(),
  participant_entity_ids: z.array(z.string()).optional(),
  organizer_entity_id: z.string().optional(),
  source_type: z.string().optional(),
  source_system: z.string().optional(),
  source_id: z.string().optional(),
  confidence_score: z.number().optional(),
  is_recurring: z.boolean().optional(),
  recurrence_pattern: z.record(z.unknown()).optional(),
  is_all_day: z.boolean().optional(),
  is_private: z.boolean().optional(),
  priority: z.number().optional(),
  metadata: z.record(z.unknown()).optional(),
  is_predicted: z.boolean().optional(),
  is_inferred: z.boolean().optional(),
  inference_sources: z.record(z.unknown()).optional(),
  tags: z.array(z.string()).optional(),
  sentiment_score: z.number().optional(),
  energy_level: z.number().optional(),
  status: z.string().optional(),
  is_deleted: z.boolean().optional(),
  external_sync_status: z.string().optional(),
  parent_event_id: z.string().optional(),
  created_by: z.string().optional(),
  content: z.array(createContentSchema).optional(),
});
