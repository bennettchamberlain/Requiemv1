import { resolveMediaUrl } from '@/components/entities/resolveMediaUrl';

import { eventDisplayTitle } from '../Components/utils';
import type { EntityItem } from '../useEntityService';

export type EntityMediaKind = 'image' | 'video';

/**
 * A resolved, renderable piece of media derived from an entity. Generalises
 * FileModal's `previewUrl`/`contentType` approach so the gallery can show real
 * thumbnails and a lightbox for any media-bearing type, not just files.
 */
export interface EntityMedia {
  entityId: string;
  kind: EntityMediaKind;
  contentType: string;
  /**
   * URL to render in the grid tile, or `null` when nothing cheap enough to be a
   * thumbnail exists — see {@link pickThumbUrl}. A null here means "draw the
   * placeholder tile", not "this entity has no media": `fullUrl` still opens.
   */
  thumbUrl: string | null;
  /** Full-resolution URL for the lightbox. */
  fullUrl: string;
  /** Human label for caption / alt text. */
  title: string;
}

/**
 * Above this, a full-resolution original is never used as a grid thumbnail.
 *
 * 70% of this corpus's media originals have no PREVIEW variant yet, so the grid
 * would otherwise download the original and let the browser downscale it —
 * bearable for the ~1 MB median, ruinous for the tail (the largest original
 * here is 2 GB). The cap is deliberately generous: it lets almost every
 * preview-less photo still render while keeping one pathological file from
 * stalling the page. Files above it get the placeholder tile and load their
 * bytes only when the user actually opens the lightbox.
 */
export const MAX_UNPREVIEWED_THUMB_BYTES = 8 * 1024 * 1024;

/**
 * Choose what the grid tile should load: the PREVIEW variant whenever one
 * exists, otherwise the original — but only for an image small enough to be
 * worth it.
 *
 * A preview-less *video* never falls back to its source: handing an `<img>` a
 * video URL always fails to decode, which cost a wasted full-file download
 * before the tile fell through to its error placeholder anyway.
 */
export function pickThumbUrl(input: {
  kind: EntityMediaKind;
  previewUrl: string | null | undefined;
  fullUrl: string;
  sizeBytes: number | null | undefined;
}): string | null {
  if (input.previewUrl) {
    return input.previewUrl;
  }

  if (input.kind === 'video') {
    return null;
  }

  if (input.sizeBytes != null && input.sizeBytes > MAX_UNPREVIEWED_THUMB_BYTES) {
    return null;
  }

  return input.fullUrl;
}

/**
 * Mimetypes whose subtype names a *provider*, not a container or codec. The ETL
 * writes these alongside a watch-page URL rather than a media file, so treating
 * them as playable renders an `<img>`/`<video>` pointed at an HTML page — always
 * broken. They resolve to no media, which leaves the entity as a plain tile
 * until the embed player lands (see
 * `docs/prd/unified-content-identity-lifecycle-embeds.md` §6).
 */
const PROVIDER_PSEUDO_MIMETYPES = new Set([
  'video/youtube',
  'video/vimeo',
  'audio/spotify',
  'audio/soundcloud',
]);

function mediaKind(contentType?: string | null): EntityMediaKind | null {
  if (!contentType) {
    return null;
  }

  if (PROVIDER_PSEUDO_MIMETYPES.has(contentType.toLowerCase())) {
    return null;
  }

  if (contentType.startsWith('image/')) {
    return 'image';
  }

  if (contentType.startsWith('video/')) {
    return 'video';
  }

  return null;
}

/**
 * Extracts displayable media from an entity, or `null` when it has none — in
 * which case the gallery keeps it as a plain text tile. Add a case here to make
 * a new entity type media-aware.
 */
export function getEntityMedia(entity: EntityItem): EntityMedia | null {
  switch (entity.__typename) {
    case 'FileType': {
      const kind = mediaKind(entity.galleryContentType);
      if (!kind) {
        return null;
      }

      const preview = resolveMediaUrl(entity.galleryPreviewUrl);
      const full = resolveMediaUrl(entity.gallerySourceUrl) ?? preview;
      if (!full) {
        return null;
      }

      return {
        entityId: entity.id,
        kind,
        contentType: entity.galleryContentType,
        thumbUrl: pickThumbUrl({
          kind,
          previewUrl: preview,
          fullUrl: full,
          sizeBytes: entity.galleryMediaSize ?? null,
        }),
        fullUrl: full,
        title: entity.galleryFilename ?? 'Untitled',
      };
    }

    case 'EventType': {
      // Photo/video events link to a file whose PREVIEW variant is the
      // thumbnail and ORIGINAL is the full-res source (resolved server-side via
      // the gallery* aliases). Non-media events resolve no content type here and
      // keep their plain text tile.
      const contentType = entity.galleryMediaContentType;
      const kind = mediaKind(contentType);
      if (!kind || !contentType) {
        return null;
      }

      const preview = resolveMediaUrl(entity.galleryPreviewUrl);
      const full = resolveMediaUrl(entity.gallerySourceUrl) ?? preview;
      if (!full) {
        return null;
      }

      return {
        entityId: entity.id,
        kind,
        contentType,
        thumbUrl: pickThumbUrl({
          kind,
          previewUrl: preview,
          fullUrl: full,
          sizeBytes: entity.galleryMediaSize ?? null,
        }),
        fullUrl: full,
        title: eventDisplayTitle({
          title: entity.galleryTitle,
          startTime: (entity.bucketStartTime as string | Date | null) ?? undefined,
          locationName: entity.galleryLocationName,
          mediaContentType: contentType,
        }),
      };
    }

    case 'ContentType': {
      const contentType = entity.galleryMimetype;
      const kind = mediaKind(contentType);
      if (!kind || !contentType) {
        return null;
      }

      // A media content row is a link, not a document: `url`/`sourceUrl` are
      // NULL on every one of them and the binary hangs off
      // `external_id -> ci.files`, which the server resolves into
      // galleryFileUrl (ORIGINAL) + galleryPreviewUrl (PREVIEW variant). Reading
      // only the first two is what left these tiles blank. Web content (a
      // bookmarked image, an oEmbed thumbnail) still arrives via url/sourceUrl,
      // so both sources are kept.
      const preview = resolveMediaUrl(entity.galleryPreviewUrl);
      const url =
        resolveMediaUrl(entity.galleryFileUrl) ??
        resolveMediaUrl(entity.galleryContentUrl) ??
        resolveMediaUrl(entity.galleryContentSourceUrl) ??
        preview;
      if (!url) {
        return null;
      }

      return {
        entityId: entity.id,
        kind,
        contentType,
        thumbUrl: pickThumbUrl({
          kind,
          previewUrl: preview,
          fullUrl: url,
          sizeBytes: entity.galleryMediaSize ?? null,
        }),
        fullUrl: url,
        title: entity.galleryTitle ?? 'Untitled',
      };
    }

    default:
      return null;
  }
}
