/**
 * What `ci.content.external_id` references, and the value-shaped test that
 * decides it when the writer did not say.
 *
 * `external_id` is structurally overloaded: for locally-captured or uploaded
 * media it holds a `ci.files.id` UUID (no FK enforces the join); for a
 * source-native reference it holds an opaque platform identifier that will
 * never resolve against `ci.files` (Spotify's `spotify:track:<id>`, Amazon
 * Music's `amazonmusic:album:<asin>`, a bare YouTube video id, a Google Drive
 * file id, a Facebook post id). Migration
 * 20260818215331_add_content_external_id_kind added `external_id_kind` to make
 * the difference explicit; this module is the single definition of how it is
 * derived, mirrored in SQL by
 * 20260819..._fix_content_external_id_kind_shape (the two MUST stay in step).
 */

/** The two things a set `external_id` can be. Mirrors the column's CHECK. */
export type ExternalIdKind = 'file' | 'external_uri';

/**
 * A source-native identifier namespaced by a scheme prefix — `spotify:`,
 * `amazonmusic:`, `audible:`, `kindle:`, `primevideo:`, and any URL scheme
 * (`https:`) a source hands us. Lowercase ASCII letters/underscore then a
 * colon, matched at the start only: the tail is opaque and deliberately
 * unconstrained.
 *
 * Disjoint from {@link EXTERNAL_ID_UUID_SHAPE} by construction — a UUID
 * contains no colon, and this pattern requires one before any digit or hyphen.
 */
export const EXTERNAL_ID_URI_SHAPE = /^[a-z_]+:/;

/**
 * An RFC-4122-shaped id, which is what `ci.files.id` always is (uuidv7). Case
 * insensitive and fully anchored: a value that merely *starts* with something
 * UUID-like is not a file id.
 */
export const EXTERNAL_ID_UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Classify an `external_id` by its SHAPE, never by its source system.
 *
 * A source list is a snapshot observation — it is right until the next
 * datasource lands, and the first version of this backfill (migration
 * 20260818215331) mislabelled every non-Spotify URI source as `'file'` for
 * exactly that reason. The shape is a structural property of the value itself.
 *
 * Returns `undefined` — meaning "leave it unclassified" — for anything that is
 * neither shape: a bare platform id like a YouTube `videoId` or a Facebook
 * post id is genuinely not distinguishable from a random opaque string by
 * looking at it, so a writer that KNOWS it is minting a source-native
 * reference must pass {@link SOURCE_NATIVE_EXTERNAL_ID_KIND} explicitly rather
 * than rely on this. Guessing `'file'` there is what this whole module exists
 * to prevent.
 */
export function classifyExternalId(externalId: string | null | undefined): ExternalIdKind | undefined {
  if (!externalId) {
    return undefined;
  }

  if (EXTERNAL_ID_URI_SHAPE.test(externalId)) {
    return 'external_uri';
  }

  if (EXTERNAL_ID_UUID_SHAPE.test(externalId)) {
    return 'file';
  }

  return undefined;
}

/**
 * The kind every ETL connector transform must stamp.
 *
 * Every `ci.content` row written by `domains/etl` keys `external_id` on the
 * REMOTE platform's identifier — a Spotify track id, a YouTube video/channel/
 * playlist id, a Google Drive `fileId`, a OneDrive `itemId`, a Facebook object
 * id, a Steam appid, a GitHub comment id. None of those is a `ci.files.id`,
 * not even for the Drive/OneDrive transforms that ALSO create a `ci.files` row
 * — that row gets its own generated uuid, and the content row points at the
 * provider's id, so a join against `ci.files` would find nothing (or, worse,
 * an unrelated row).
 *
 * Most of these ids have no scheme prefix, so {@link classifyExternalId}
 * cannot recognise them and would leave them NULL. The transform knows, so the
 * transform says.
 */
export const SOURCE_NATIVE_EXTERNAL_ID_KIND: ExternalIdKind = 'external_uri';
