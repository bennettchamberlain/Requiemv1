/*
 * Canonical record → the ingest DTOs each destination actually takes.
 *
 * Ported from CI-Import-Tools' `ci-server/mapping.ts`. Upstream these built the
 * shapes for CI-Server's `/v1` HTTP contract; here they build the DTOs the
 * services take in-process, so the transport half of the port evaporates and the
 * per-kind judgement — which is all of the value — is what remains.
 *
 * The field names differ from upstream because ci-server's DTOs do: everything
 * is snake_case EXCEPT `CreateItemDto`, which is the one camelCase ingest DTO.
 * That single exception is why the provenance triple has two helpers rather than
 * one shared object spread.
 *
 * Every input carries the (source_type, source_system, source_id) triple, which
 * is what makes a re-import a no-op: each destination table has a
 * `*_source_triple_uniq` index over it.
 */
import type { CreateBrowserActivityDto } from '@ci/domains/browser-activity';
import { CommunicationType } from '@ci/domains/memory';
import type {
  CreateCommunicationDto,
  CreateContentDto,
  CreateEventDto,
  CreateItemDto,
} from '@ci/domains/memory';
import type { CreatePositionDto } from '@ci/domains/position';

import { mimeForFile } from '../datasources/timeline';

import {
  clip,
  discordAttachmentFilename,
  discordAttachmentUrls,
  isMediaType,
  contentFileRef,
  isDiscordAttachmentOnly,
  isRedditComment,
  isRedditPost,
  num,
  redditMediaUrl,
  str,
  type CanonicalRecord,
} from './canonical';

/** The full source triple every per-destination input carries. */
/**
 * The provenance triple, snake_case — the spelling every ingest DTO uses except
 * inventory. It is what makes a re-import a no-op: each destination has a
 * `*_source_triple_uniq` index over it.
 */
function sourceTriple(
  rec: CanonicalRecord,
): Pick<CreateContentDto, 'source_type' | 'source_system' | 'source_id'> {
  return { source_type: rec.sourceType, source_system: rec.sourceSystem, source_id: rec.sourceId };
}

/**
 * The same triple for `CreateItemDto`, which is ci-server's one camelCase ingest
 * DTO. Kept as its own function rather than a cast so a future rename on either
 * side fails to compile instead of silently dropping the provenance.
 */
function sourceTripleCamel(
  rec: CanonicalRecord,
): Pick<CreateItemDto, 'sourceType' | 'sourceSystem' | 'sourceId'> {
  return { sourceType: rec.sourceType, sourceSystem: rec.sourceSystem, sourceId: rec.sourceId };
}

/** The content `type` bucket for a kind (bookmark/media/purchase/note/…). */
function contentTypeFor(kind: string): string {
  if (kind === 'web.bookmark') {
    return 'bookmark';
  }

  // media.saved (a library's saved/followed track or album) is the same kind
  // of thing a play/read session's content row describes — one type family.
  if (
    kind === 'media.play' ||
    kind === 'media.watch' ||
    kind === 'media.listen' ||
    kind === 'media.read' ||
    kind === 'media.saved'
  ) {
    return 'media';
  }

  // A photo/video/audio row that reached the content lane instead of events
  // (undated — see destinationsFor) is the same kind of thing the media leg
  // creates for a dated one, so it takes the same 'media' type rather than the
  // 'capture' the generic prefix rule would give it.
  if (kind.startsWith('capture.')) {
    return 'media';
  }

  // A document, archive, or key off a drive walk / mail attachment. 'import'
  // (the prefix rule) named the pipeline that carried it, not the thing.
  if (kind === 'import.archive_item') {
    return 'file';
  }

  // A digital purchase's content row is the bought thing (an ebook, an app, a
  // movie) — the same 'media' bucket its play/read/watch rows land in, so the
  // purchase and its sessions describe one artifact, not two type families.
  if (kind === 'commerce.purchase') {
    return 'media';
  }

  if (kind === 'commerce.transaction') {
    return 'transaction';
  }

  if (kind === 'reading.annotation') {
    return 'annotation';
  }

  if (kind === 'calendar.event') {
    return 'event';
  }

  if (kind === 'travel.trip') {
    return 'trip';
  }

  if (kind === 'social.post') {
    return 'post';
  }

  if (kind === 'social.comment') {
    return 'comment';
  }

  if (kind === 'social.like') {
    return 'like';
  }

  if (kind === 'social.bookmark') {
    return 'social_bookmark';
  }

  return kind.includes('.') ? kind.split('.')[0] : kind;
}

/**
 * Map a record to a CreateContentDto. Used for bookmarks, digital purchases,
 * notes/annotations, and the content side of calendar/media events. The server
 * links the row to its event via the shared source triple, so no eventId here.
 */
export function toContentInput(rec: CanonicalRecord): CreateContentDto {
  const m = rec.metadata;
  // A Reddit post/comment reaches the content lane only for its media
  // (destinationsFor routes text-only records to communications alone). The
  // media row carries the record's text with it: for a post, truncated as the
  // title and the full body as the text; a comment gets no title at all — it
  // would only repeat the text it sits next to.
  const redditMedia = redditMediaUrl(rec);
  if (redditMedia) {
    const input: CreateContentDto = {
      type: redditMedia.kind,
      url: redditMedia.url,
      source_data: m,
      ...sourceTriple(rec),
    };
    const postText = rec.description || rec.title;
    if (postText) {
      if (!isRedditComment(rec)) {
        input.title = clip(postText);
      }

      input.text = postText;
    }

    const mime = mimeForFile(new URL(redditMedia.url).pathname);
    if (mime) {
      input.mimetype = mime;
    }

    return input;
  }

  const input: CreateContentDto = {
    type: contentTypeFor(rec.kind),
    source_data: m,
    ...sourceTriple(rec),
  };
  const title = rec.title || str(m.Product) || str(m.Title);
  if (title) {
    input.title = title;
  }

  const text = rec.description || str(m.Text);
  if (text) {
    input.text = text;
  }

  const url = str(m.URL) || str(m.Url) || str(m.url);
  if (url) {
    input.url = url;
  }

  // A source-native identifier (e.g. Spotify's spotify:track:<id>) doubles as
  // the row's external_id so consumers can key on it without digging into
  // source_data — and REPLACES the per-item sourceId as the content row's
  // identity. Content rows dedup server-side on the provenance triple
  // (content_source_triple_uniq); with the per-play item id in the triple,
  // every play of the same track created another copy of the same content.
  // Keying on the URI collapses them to one row per track/episode/chapter,
  // across batches and re-imports. The EVENT keeps the per-play item id, so
  // this also forfeits the server's content→event triple auto-link (a single
  // event_id could never represent N plays anyway).
  const uri = str(m.URI);
  if (uri) {
    input.external_id = uri;
    input.source_id = uri;
  }

  // A file-bearing record that reached content WITHOUT an events leg (an undated
  // photo, any drive-walk document) has had its bytes uploaded by
  // withContentMedia just before the send — point the row at the stored file, or
  // it would describe a document nobody can open. The file id wins over a
  // source URI: it identifies these bytes in CI-Server, which is what a consumer
  // of this row needs.
  const file = contentFileRef(rec);
  if (file.id) {
    input.external_id = file.id;
  }

  if (file.url && !input.url) {
    input.url = file.url;
  }

  if (rec.mediaType) {
    input.mimetype = rec.mediaType;
  }

  return input;
}

// Inventory condition vocabulary -> the DTO's condition enum. Amazon records
// "New" / "Used - Like New" etc.; normalise to the closed set the column takes.
//
// Upstream returned the GraphQL enum's UPPERCASE spellings and the transport
// lowercased them on the way out (`NA` -> `n/a`). That transport is gone, so the
// conversion lives here and the function returns what the column stores.
function conditionFor(raw: string | null): CreateItemDto['condition'] | null {
  if (!raw) {
    return null;
  }

  const lc = raw.toLowerCase();
  if (lc.includes('like new') || lc.includes('like-new')) {
    return 'like_new';
  }

  if (lc.includes('refurb') || lc === 'new') {
    return 'new';
  }

  if (lc.includes('very good') || lc.includes('good')) {
    return 'good';
  }

  if (lc.includes('acceptable') || lc.includes('fair')) {
    return 'fair';
  }

  if (lc.includes('poor')) {
    return 'poor';
  }

  if (lc.includes('broken') || lc.includes('for parts')) {
    return 'broken';
  }

  // Amazon's own `Product Condition` vocabulary, which is only ever New / Used /
  // Not Available on a real Retail.OrderHistory export. A bare "Used" states no
  // grade and "Not Available" states the data is missing; CI-Server's enum has
  // no ungraded-used bucket, so both land on n/a — the honest "no grade here"
  // answer, rather than inventing GOOD. The raw string survives untouched in
  // metadata.Condition either way. Graded forms ("Used - Very Good") never
  // reach this line: they matched above.
  if (lc === 'used' || lc === 'not available' || lc === 'n/a' || lc === 'na') {
    return 'n/a';
  }

  return null;
}

// Humanise a source category token into category + optional subcategory. Amazon
// ships screaming-snake product types (ELECTRONIC_CABLE, ABIS_KITCHEN); the
// leading segment is the broad department, the remainder the subcategory. A
// plain "Electronics > Cables" hierarchy (other sources) splits on the
// separator. Returns null when there is nothing usable.
function splitCategory(raw: string): { category: string; subcategory?: string } | null {
  const cleaned = raw.trim();
  if (!cleaned) {
    return null;
  }

  // Hierarchical "A > B > C" / "A/B" → first = category, last = subcategory.
  const hier = cleaned.split(/\s*[>/]\s*/).filter(Boolean);
  if (hier.length > 1) {
    return { category: hier[0], subcategory: hier[hier.length - 1] };
  }

  // Amazon ABIS_BOOK / ELECTRONIC_CABLE style: split the snake token.
  if (/_/.test(cleaned)) {
    const parts = cleaned.split('_').filter(Boolean);
    const humanise = (s: string) =>
      s.length <= 4 ? s.toUpperCase() : s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
    const category = humanise(parts[0]);
    const subcategory = parts.length > 1 ? parts.slice(1).map(humanise).join(' ') : undefined;

    return subcategory ? { category, subcategory } : { category };
  }

  return { category: cleaned };
}

/**
 * Map a `commerce.*` record to a CreateItemDto. The importer's Amazon
 * source supplies Product / Unit Price / Currency / Order ID / Quantity in
 * metadata; name falls back to the canonical title (then a placeholder, since
 * `name` is required) so a malformed row is still ingestable.
 *
 * `category`/`subcategory` are derived from a real source taxonomy (Amazon's
 * `Category` product type, or any source `Category`/`Type`/`Product Type`
 * field) when present, instead of collapsing every row into the generic
 * `commerce` bucket; `rec.category` (the kind prefix) is the fallback.
 */
export function toInventoryInput(rec: CanonicalRecord): CreateItemDto {
  const m = rec.metadata;
  const orderId = str(m['Order ID']);
  const input: CreateItemDto = {
    name: str(m.Product) || rec.title || 'Item',
    // Pass the full parsed metadata through — Amazon rows previously had
    // inventory.metadata = '{}' because the column extractor only kept a
    // curated subset; the bag carries Source, raw Total, and any future
    // CSV fields that don't have a first-class column yet.
    metadata: m,
    ...sourceTripleCamel(rec),
  };
  if (rec.description) {
    input.description = rec.description;
  }

  // Prefer a real source taxonomy over the constant `commerce` kind-prefix.
  const rawCategory = str(m.Category) || str(m['Product Category']) || str(m['Product Type']) || str(m.Type);
  const split = rawCategory ? splitCategory(rawCategory) : null;
  if (split) {
    input.category = split.category;
    if (split.subcategory) {
      input.subcategory = split.subcategory;
    }
  } else if (rec.category) {
    input.category = rec.category;
  }

  const brand = str(m.Brand) || str(m.Manufacturer) || str(m.Seller);
  if (brand) {
    input.brand = brand;
  }

  const condition = conditionFor(str(m.Condition) || str(m['Product Condition']));
  if (condition) {
    input.condition = condition;
  }

  const price = num(m['Unit Price']) ?? num(m.Total);
  if (price != null) {
    input.purchasePrice = price;
  }

  const currency = str(m.Currency);
  if (currency) {
    input.currency = currency;
  }

  if (rec.startTime) {
    input.acquiredAt = new Date(rec.startTime);
  }

  // Identifier codes: keep the order id (and quantity, when present) as a small
  // structured bag. sourceId already carries the order id for dedup; this is the
  // human-facing copy on the item.
  const identifierCodes: Record<string, unknown> = {};
  if (orderId) {
    identifierCodes.order_id = orderId;
  }

  const qty = num(m.Quantity);
  if (qty != null) {
    identifierCodes.quantity = qty;
  }

  const asin = str(m.ASIN) || str(m['ASIN/ISBN']) || str(m.ISBN);
  if (asin) {
    identifierCodes.asin = asin;
  }

  if (Object.keys(identifierCodes).length) {
    input.identifierCodes = identifierCodes;
  }

  return input;
}

const COMMUNICATION_TYPE_BY_KIND: Record<string, CommunicationType> = {
  'communication.email': CommunicationType.EMAIL,
  'communication.call': CommunicationType.CALL,
  'communication.message': CommunicationType.CHAT,
};

/**
 * The types a source is allowed to declare for itself.
 *
 * Deliberately a subset of the `CommunicationType` enum: these are the values
 * upstream's sources actually emit, and widening it to the whole enum would let
 * a typo in one export's metadata pick `video_call` for every message in it.
 */
const DECLARABLE_TYPES = new Map<string, CommunicationType>([
  ['email', CommunicationType.EMAIL],
  ['sms', CommunicationType.SMS],
  ['call', CommunicationType.CALL],
  ['chat', CommunicationType.CHAT],
  ['post', CommunicationType.POST],
]);

/**
 * communicationType for a record: the importer's explicit
 * `metadata.CommunicationType` when it names one of CI-Server's types,
 * otherwise the `communication.*` kind suffix.
 *
 * The override exists because one source can carry several types under a single
 * kind — a Twitter/X archive holds public POSTS (tweets, likes) alongside
 * one-to-one CHAT (DMs), and every one of them is classified 'message'.
 */
export function communicationTypeFor(kind: string, metadata?: Record<string, unknown>): CommunicationType {
  const declared = str(metadata?.CommunicationType)?.toLowerCase();
  const mapped = declared ? DECLARABLE_TYPES.get(declared) : undefined;

  if (mapped) {
    return mapped;
  }

  return COMMUNICATION_TYPE_BY_KIND[kind] ?? CommunicationType.CHAT;
}

/**
 * Map a `communication.*` record to a CreateCommunicationDto. Body text comes
 * from the canonical description (metadata Text/Body/Message); `direction`
 * normalises the importer's outgoing/incoming/sent/received vocabulary to
 * CI-Server's inbound/outbound (default inbound).
 */
export function toCommunicationInput(rec: CanonicalRecord): CreateCommunicationDto {
  const m = rec.metadata;
  // An attachment-only Discord message has no text of its own — see
  // isDiscordAttachmentOnly for why the title fallbacks must not fill it in.
  const content = isDiscordAttachmentOnly(rec) ? '' : (rec.description ?? rec.title ?? '');
  const input: CreateCommunicationDto = {
    communication_type: communicationTypeFor(rec.kind, m),
    time: new Date(rec.startTime),
    content,
    // `direction` is REQUIRED here where upstream left it optional, so a record
    // whose source states no direction still needs one. `inbound` is the
    // conservative default: an archived message that never says the user sent it
    // is far more often one they received, and mislabelling a received message
    // as sent would misattribute authorship. The branches below overwrite this
    // wherever the source actually says.
    direction: 'inbound',
    ...sourceTriple(rec),
  };
  // Pass call duration through so the server stores it on the Communication entity.
  if (m.Duration != null) {
    input.duration_seconds = Number(m.Duration);
  }

  const preview = content ? clip(content, 140) : null;
  if (preview && preview !== content) {
    input.preview = preview;
  }

  // Reddit posts and comments: the post title is the subject (comments have
  // none), the subreddit is the thread, and direction reads as authored
  // (outbound) vs saved-from-someone (inbound). The messaging-specific
  // participant/direction derivation below doesn't apply.
  if (isRedditPost(rec) || isRedditComment(rec)) {
    input.communication_type = CommunicationType.POST;
    input.direction = typeof m.Kind === 'string' && m.Kind.startsWith('saved_') ? 'inbound' : 'outbound';
    // A post has a real authored title, so it becomes the subject. A comment
    // has none — the only subject we could derive is a snippet of its own body,
    // which `content` already carries in full, so it stays blank.
    if (rec.title && !isRedditComment(rec)) {
      input.subject = rec.title;
    }

    const subreddit = str(m.Subreddit);
    if (subreddit) {
      input.thread_id = `r/${subreddit}`;
    }

    return input;
  }

  const subject = str(m.Subject);
  if (subject) {
    input.subject = subject;
  }

  const direction = directionFor(m);
  if (direction) {
    input.direction = direction;
  }

  const thread = str(m.ThreadId) || str(m.Thread) || str(m.MessageID);
  if (thread) {
    input.thread_id = thread;
  }

  // fromEntityId / toEntityIds expect UUIDs — we don't have entity resolution at
  // import time, so the raw sender + recipients ride in participantsMetadata for
  // the server to resolve. `from` is a raw string; `to` is an array of raw
  // strings (the SHARED CONTRACT shape).
  const from = str(m.Contact) || str(m.Sender) || str(m.From);
  const to = recipientsFrom(m);
  if (from || to.length) {
    input.participants_metadata = {
      ...(input.participants_metadata ?? {}),
      ...(from ? { from } : {}),
      ...(to.length ? { to } : {}),
    };
  }

  // Attachments: CI-Server ids stamped by the push's media leg (graphql.ts
  // withCommunicationMedia) just before the send. AttachmentFileIds are the
  // stored files — always present when the record had attachments that landed.
  // AttachmentContentIds are the ci.content rows over them, present only for
  // sources that describe their media well enough to catalogue it: a twitter
  // photo knows its type and its URL on X, and Messenger opts in; an MMS part
  // is bare bytes, so it lands as a file alone. The two arrays are
  // index-aligned, so attachment i is { file: fileIds[i], content:
  // contentIds[i] } — the pairing is preserved in metadata, while the column
  // gets a flat list in the `{ type, id }` vocabulary CI-Server expects.
  const attachments = attachmentsFor(m);
  if (attachments) {
    input.attachments = attachments;
  }

  return input;
}

/** The non-empty strings in a metadata value that should hold an id array. */
function strIds(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((id): id is string => typeof id === 'string' && id.length > 0) : [];
}

/** The `attachments` column value for a communication, or undefined if it has none. */
function attachmentsFor(m: Record<string, unknown>): Array<Record<string, unknown>> | undefined {
  const attachments = [
    ...strIds(m.AttachmentFileIds).map((id) => ({ type: 'file', id })),
    ...strIds(m.AttachmentContentIds).map((id) => ({ type: 'content', id })),
  ];

  return attachments.length > 0 ? attachments : undefined;
}

// Recipients for participants_metadata.to. Sources record recipients under To /
// Recipient / Recipients (email To header, SMS To, etc.); an email To header is
// a comma-separated list, so split + de-dup into the array shape the contract
// expects. iMessage and other multi-party sources hand us a pre-resolved array
// of handles, which goes in as-is. Leaves toEntityIds unset — the server
// resolves these raw strings.
function recipientsFrom(m: Record<string, unknown>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const pushOne = (raw: string) => {
    const v = raw.trim();
    if (v && !seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  };

  const push = (val: unknown) => {
    if (Array.isArray(val)) {
      for (const v of val) {
        if (typeof v === 'string') {
          pushOne(v);
        }
      }

      return;
    }

    const s = str(val);
    if (!s) {
      return;
    }

    for (const part of s.split(',')) {
      pushOne(part);
    }
  };

  push(m.To);
  push(m.Recipient);
  push(m.Recipients);

  return out;
}

/* -------------------------------------------------------------------------- *
 * Facebook Messenger communications.
 *
 * Messenger messages get a Messenger-specific contract on top of the generic
 * communication path: thread_id is the Messenger group name ('Conversation' in
 * the JSON path, 'Thread' in the HTML path), direction is decided by
 * fuzzy-matching the sender against the CI-Server user behind the push
 * credentials, and the provenance triple is
 * ('import', 'facebook_messenger', <message item id>) — NOT the generic
 * (SOURCE_TYPE, data_source, id) triple.
 *
 * Participants ship as raw display names in participants_metadata
 * ({from: string, to: [string]} — the shape CI-Server's participant-link
 * maintenance reads). Person rows are created and linked SERVER-SIDE by the
 * extract_people / link maintenance legs; the importer never calls
 * createPeople and leaves from_entity_id / to_entity_ids unset.
 * -------------------------------------------------------------------------- */

/** source_system for Messenger communications (distinct from posts/media). */
export const FACEBOOK_MESSENGER_SOURCE_SYSTEM = 'facebook_messenger';
/** source_type for Messenger communications. */
export const FACEBOOK_MESSENGER_SOURCE_TYPE = 'import';

/** Is this canonical record a Facebook Messenger message? */
export function isFacebookMessengerRecord(rec: CanonicalRecord): boolean {
  return rec.sourceSystem === 'facebook' && rec.kind === 'communication.message';
}

/** The sender + recipient display names of a Messenger message. */
export function messengerParticipantsOf(rec: CanonicalRecord): {
  sender: string | null;
  recipients: string[];
} {
  const m = rec.metadata;

  return { sender: str(m.Sender) || str(m.From) || str(m.Contact), recipients: recipientsFrom(m) };
}

/**
 * Map a Facebook Messenger record to a CreateCommunicationDto. Direction:
 * sender ≈ the API key's user → outgoing, else incoming — expressed as
 * CI-Server's 'outbound'/'inbound' (the ci.communication_direction Postgres
 * enum has no outgoing/incoming spellings, and the resolver stores the value
 * verbatim).
 */
export function toFacebookMessengerCommunicationInput(
  rec: CanonicalRecord,
  /** Does this sender display name fuzzy-match the CI-Server user? */
  isSelf: (name: string) => boolean,
): CreateCommunicationDto {
  const m = rec.metadata;
  const content = rec.description ?? rec.title ?? '';
  const { sender, recipients } = messengerParticipantsOf(rec);
  const input: CreateCommunicationDto = {
    communication_type: CommunicationType.CHAT,
    time: new Date(rec.startTime),
    content,
    direction: sender && isSelf(sender) ? 'outbound' : 'inbound',
    source_type: FACEBOOK_MESSENGER_SOURCE_TYPE,
    source_system: FACEBOOK_MESSENGER_SOURCE_SYSTEM,
    source_id: rec.sourceId,
  };
  const preview = content ? clip(content, 140) : null;
  if (preview && preview !== content) {
    input.preview = preview;
  }

  // Chat messages have no natural subject line — none is synthesized. Readers
  // fall back to preview/content (CI-Server derives preview from content when
  // absent), so lists/search still show the message body.
  // The Messenger group name: 'Conversation' (JSON export) / 'Thread' (HTML).
  const thread = str(m.Conversation) || str(m.Thread);
  if (thread) {
    input.thread_id = thread;
  }

  // Raw names in the string shape the server-side participant linker reads;
  // it resolves them to Person rows and fills the entity-id columns there.
  const participants: Record<string, unknown> = {};
  if (sender) {
    participants.from = sender;
  }

  if (recipients.length) {
    participants.to = recipients;
  }

  if (Object.keys(participants).length) {
    input.participants_metadata = participants;
  }

  // Photos/videos/gifs/audio the message carried, as { type, id } refs to the
  // stored files and their content rows — see attachmentsFor. A media-only
  // message has empty `content` and lives entirely in here.
  const attachments = attachmentsFor(m);
  if (attachments) {
    input.attachments = attachments;
  }

  return input;
}

/** source_system for WhatsApp communications. */
export const WHATSAPP_SOURCE_SYSTEM = 'whatsapp';

/** Is this canonical record a WhatsApp chat message? */
export function isWhatsAppRecord(rec: CanonicalRecord): boolean {
  return rec.sourceSystem === WHATSAPP_SOURCE_SYSTEM && rec.kind === 'communication.message';
}

/**
 * Map a WhatsApp record to a CreateCommunicationDto. `_chat.txt` exports are
 * a flat transcript with no built-in "this one is me" signal — unlike
 * iMessage's `is_from_me` column or SMS Backup & Restore's type code, the
 * account owner is just another `Sender` display name — so direction can't be
 * read off the source data the way `directionFor` does for other messengers.
 * Resolved the same way as Facebook Messenger: fuzzy-match the sender against
 * the CI-Server user behind the push credentials.
 */
export function toWhatsAppCommunicationInput(
  rec: CanonicalRecord,
  isSelf: (name: string) => boolean,
): CreateCommunicationDto {
  const input = toCommunicationInput(rec);
  const sender = str(rec.metadata.Sender);
  input.direction = sender && isSelf(sender) ? 'outbound' : 'inbound';
  // toCommunicationInput only reads ThreadId/Thread/MessageID for threadId —
  // the WhatsApp importer stamps the chat name onto `Conversation`, so without
  // this every WhatsApp message loses its thread grouping.
  const conversation = str(rec.metadata.Conversation);
  if (conversation) {
    input.thread_id = conversation;
  }

  return input;
}

// Importer direction vocabulary -> CI-Server inbound/outbound. Messages record
// `From Me` (boolean) rather than a direction string; honour both. Call records
// may carry missed/voicemail/rejected/refused/unknown — all inbound.
function directionFor(m: Record<string, unknown>): 'inbound' | 'outbound' | null {
  const raw = str(m.direction) || str(m.Direction);
  if (raw) {
    const lc = raw.toLowerCase();
    if (lc === 'outgoing' || lc === 'sent' || lc === 'outbound') {
      return 'outbound';
    }

    // Everything else — incoming, received, inbound, missed, voicemail, rejected,
    // refused, unknown — is inbound.
    return 'inbound';
  }

  if (typeof m['From Me'] === 'boolean') {
    return m['From Me'] ? 'outbound' : 'inbound';
  }

  return null;
}

/**
 * Map a `web.page_view` / `web.bookmark` record to a CreateBrowserActivityDto.
 * URL + Title come from metadata (Chromium and Firefox both use URL/Title);
 * actionType distinguishes a bookmark from a plain visit. Firefox's importer
 * also persists a `Description` per row (1.3k of 3k rows had one in the live
 * dataset) — surface it to pageSummary and pass the full metadata bag through
 * to properties so the importer stops dropping correctly-parsed fields.
 */
export function toBrowserActivityInput(rec: CanonicalRecord): CreateBrowserActivityDto {
  const m = rec.metadata;
  const input: CreateBrowserActivityDto = {
    time: rec.startTime,
    // A search often has no page URL; its query is the identity. Fall back to the
    // query (Search/Query metadata or the record title) so url is never empty.
    url:
      str(m.URL) ||
      str(m.Url) ||
      str(m.url) ||
      (rec.kind === 'web.search' ? str(m.Search) || str(m.Query) || str(m.query) : '') ||
      rec.title ||
      '',
    action_type: rec.kind === 'web.bookmark' ? 'bookmark' : rec.kind === 'web.search' ? 'search' : 'visit',
    properties: m,
    ...sourceTriple(rec),
  };
  const title = str(m.Title) || rec.title;
  if (title) {
    input.title = title;
  }

  const summary = rec.description || str(m.Description);
  if (summary) {
    input.page_summary = summary;
  }

  return input;
}

// CanonicalRecord locationSource -> CI-Server's ci.location_source enum. EXIF
// GPS came off a GPS receiver originally, so it lands as 'gps'. A textual
// address that the server forward-geocodes is much weaker than any direct
// fix — 'other' is the closest pre-existing bucket ('inferred' is reserved for
// LocationEstimateService's own output).
const POSITION_SOURCE_BY_LOCATION_SOURCE: Record<
  NonNullable<CanonicalRecord['locationSource']>,
  CreatePositionDto['source']
> = {
  gps: 'gps',
  exif: 'gps',
  address: 'other',
  wifi: 'wifi',
};

/**
 * Map a canonical record to a CreatePositionDto. Called for the `position`
 * partition produced by destinationsFor (raw GPS, place visits, GPS-bearing
 * photos). Skips records without coordinates by returning null — those have
 * nothing useful to donate to the location estimator.
 */
export function toPositionInput(rec: CanonicalRecord): CreatePositionDto | null {
  if (!rec.coordinates) {
    return null;
  }

  const m = rec.metadata;
  const input: CreatePositionDto = {
    time: rec.startTime,
    // `location` is a plain {x, y} on this DTO — x is LONGITUDE, y is latitude,
    // the order PostGIS uses and the reverse of how coordinates are spoken.
    location: { x: rec.coordinates.lon, y: rec.coordinates.lat },
    // Default to 'gps' for any coord-bearing record whose source we didn't
    // classify (locationSource undefined) — the position table requires a
    // non-null source and gps is the safest catch-all for a real coordinate.
    source: rec.locationSource ? POSITION_SOURCE_BY_LOCATION_SOURCE[rec.locationSource] : 'gps',
    ...sourceTriple(rec),
  };
  if (rec.accuracyMeters != null && rec.accuracyMeters > 0) {
    input.accuracy_meters = rec.accuracyMeters;
  }

  const altitude = num(m.Altitude) ?? num(m.altitude) ?? num(m.Elevation) ?? num(m.elevation);
  if (altitude != null) {
    input.altitude_meters = altitude;
  }

  const hdop = num(m.HDOP) ?? num(m.hdop);
  if (hdop != null) {
    input.hdop = hdop;
  }

  const vdop = num(m.VDOP) ?? num(m.vdop);
  if (vdop != null) {
    input.vdop = vdop;
  }

  const heading = num(m.Heading) ?? num(m.heading);
  if (heading != null) {
    input.heading_degrees = heading;
  }

  const speed = num(m.Velocity) ?? num(m.Speed) ?? num(m.speed);
  if (speed != null) {
    input.speed_meters_per_second = speed;
  }

  const address = rec.locationName ?? str(m.Address) ?? str(m.address);
  if (address) {
    input.address = address;
  }

  // Prefer a human title (place name, photo filename) over the empty default so
  // a position row keeps a readable label when viewed in isolation.
  const name = rec.title ?? str(m.Name) ?? str(m.Title);
  if (name) {
    input.name = name;
  }

  const description = rec.description ?? str(m.Description);
  if (description) {
    input.description = description;
  }

  const provider = str(m.Source) ?? rec.sourceSystem;
  if (provider) {
    input.provider = provider;
  }

  const activity = str(m['Activity Type']) ?? str(m.ActivityType) ?? str(m.activityType);
  if (activity) {
    input.activity_type = activity;
  }

  return input;
}

/**
 * One CreateContentDto per attachment link on a Discord message — a link row
 * and nothing more.
 *
 * `type` follows the same rule a drive walk uses for a real file
 * (timeline.mediaItemFromFile): a media MIME is 'media', everything else is the
 * honest 'file'. `title` is the uploaded filename the URL ends in — the one
 * human-readable string the package carries about the file itself. Still no
 * text: the only candidate would be the caption of the message it was posted
 * with, which describes the message, not the file. An extension mime-db can't
 * type at all (Discord uploads include bare `env` / `config` files) stays
 * 'file' with no mimetype — no type beats a wrong one.
 *
 * Each row takes the message's provenance triple with an `:attachment:<n>`
 * suffix on the sourceId, so it dedups server-side across re-imports and keeps
 * a stable identity per link.
 */
export function discordAttachmentContentInputs(rec: CanonicalRecord): CreateContentDto[] {
  return discordAttachmentUrls(rec).map((url, i) => {
    const filename = discordAttachmentFilename(url);
    const mimetype = filename ? mimeForFile(filename) : undefined;
    const input: CreateContentDto = {
      type: isMediaType(mimetype ?? null) ? 'media' : 'file',
      url,
      source_type: rec.sourceType,
      source_system: rec.sourceSystem,
      source_id: `${rec.sourceId}:attachment:${i}`,
    };
    if (filename) {
      input.title = filename;
    }

    if (mimetype) {
      input.mimetype = mimetype;
    }

    return input;
  });
}

/**
 * Map a record to the event a timeline shows.
 *
 * Ported from upstream's GraphQL encoder rather than from `mapping.ts` — events
 * were the one destination whose input never lived beside the others, because
 * they rode a different endpoint. In-process that distinction is gone, so it
 * belongs here with the rest.
 *
 * Fields with no first-class column ride in `metadata` so they survive the
 * round-trip. The GPS provenance pair is deliberately duplicated there as well
 * as on the position row: `LocationEstimateService` reads accuracy and source
 * when weighing donors, and an event whose position leg was skipped would
 * otherwise carry a coordinate with no indication of how good it is.
 */
export function toEventInput(rec: CanonicalRecord): CreateEventDto {
  const metadata: Record<string, unknown> = { ...rec.metadata };

  if (rec.mediaType) {
    metadata.mediaType = rec.mediaType;
  }

  if (rec.contentHash) {
    metadata.contentHash = rec.contentHash;
  }

  if (rec.accuracyMeters != null) {
    metadata.accuracyMeters = rec.accuracyMeters;
  }

  if (rec.locationSource) {
    metadata.locationSource = rec.locationSource;
  }

  const input: CreateEventDto = {
    // `title` is required here where upstream left it optional. A record with
    // nothing to call it is still worth a timeline row, so it falls back to the
    // kind — an honest "a photo happened" beats an empty title on the timeline.
    title: rec.title ?? rec.kind,
    start_time: new Date(rec.startTime),
    metadata,
    ...sourceTriple(rec),
  };

  if (rec.endTime) {
    input.end_time = new Date(rec.endTime);
  }

  // Sources that know a duration outright (an Uber ride's trip_duration_seconds)
  // publish it as whole minutes.
  const minutes = Number(metadata['Duration (minutes)']);

  if (Number.isFinite(minutes) && minutes >= 0) {
    input.duration_minutes = Math.round(minutes);
  }

  if (rec.eventType) {
    input.event_type = rec.eventType;
  }

  if (rec.category) {
    input.category = rec.category;
  }

  if (rec.description) {
    input.description = rec.description;
  }

  if (rec.locationName) {
    input.location_name = rec.locationName;
  }

  if (rec.isAllDay != null) {
    input.is_all_day = rec.isAllDay;
  }

  if (rec.isRecurring != null) {
    input.is_recurring = rec.isRecurring;
  }

  if (rec.coordinates) {
    input.location_coordinates = {
      type: 'Point',
      coordinates: [rec.coordinates.lon, rec.coordinates.lat],
    };
  }

  return input;
}
