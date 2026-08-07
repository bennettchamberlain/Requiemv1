/* Shared media-asset emission for the AI-chat importers (chatgpt/claude/gemini).

   AI exports reference media (DALL-E generations, uploaded photos, Gemini
   generated images) from the conversation records and ship the bytes as
   sidecar files elsewhere in the export. Each importer resolves its own
   reference scheme to an on-disk file; this module turns a resolved file into
   a timeline 'media' item the same way facebook.ts does: MIME from the file
   extension, photos/videos only (audio, docs and unknown types are out of
   scope), lazy byte loader, intermediateLocation for the retention pass, and
   an export-root-relative relKey as the stable identity so re-imports dedupe. */
import fs from 'node:fs';
import path from 'node:path';

import type { Item, MediaAttachment, Metadata } from './timeline';
import { mimeForFile } from './timeline';

export interface ResolvedAsset {
  /** Absolute on-disk path of the asset. */
  abs: string;
  /** Export-root-relative path — stable across staging dirs, doubles as id. */
  relKey: string;
}

/** Build a 'media' item for an on-disk asset, or undefined when the file's
    MIME isn't image/* or video/*. `idPrefix` is the importer's namespace
    (e.g. 'chatgpt:media'); the item id is `<idPrefix>:<relKey>`. */
export function mediaItemForAsset(
  idPrefix: string,
  source: string,
  asset: ResolvedAsset,
  ts: Date | undefined,
  metadata: Metadata,
): Item | undefined {
  const filename = path.basename(asset.abs);
  const mediaType = mimeForFile(filename);
  const type = mediaType?.startsWith('video/')
    ? 'Video'
    : mediaType?.startsWith('image/')
      ? 'Photo'
      : undefined;
  if (!type) {
    return undefined;
  }

  return {
    id: `${idPrefix}:${asset.relKey}`,
    classification: 'media',
    timestamp: ts,
    intermediateLocation: asset.abs,
    content: { filename, mediaType, data: async () => fs.promises.readFile(asset.abs) },
    metadata: { ...metadata, Type: type, Source: source },
  };
}

/**
 * MediaAttachments descriptors for media items that accompany a MESSAGE — the
 * comms media lane (upload + content row + the message's attachments column;
 * see graphql.ts withCommunicationMedia). Media used to ride messages as
 * attachment sub-items routed by MIME to events, which minted a duplicate
 * ci.events row per attachment at the message's timestamp. Standalone
 * media-only records (a DALL-E generation with no message) are NOT attachments
 * and keep their own item — there is no communication row to duplicate.
 */
export function mediaAttachmentsFor(media: Item[]): MediaAttachment[] {
  return media.flatMap((m) => {
    if (!m.intermediateLocation) {
      return [];
    }

    const mediaType = m.content?.mediaType;

    return [
      {
        path: m.intermediateLocation,
        filename: m.content?.filename,
        type: mediaType?.startsWith('video/') ? ('video' as const) : ('image' as const),
        mimetype: mediaType,
      },
    ];
  });
}

/** True when `abs` resolves inside `root` — guards a hostile export whose
    file references path-traverse out of the unpacked directory. */
export function insideRoot(root: string, abs: string): boolean {
  const rel = path.relative(path.resolve(root), path.resolve(abs));

  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}
