import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';

/** A staged item's bytes, fingerprinted — the pair `staged_items` stores. */
export interface ContentDigest {
  sha256: string;
  sizeBytes: number;
}

/**
 * How big a file this will read to fingerprint it.
 *
 * The digest exists to keep two same-named files apart, and a file this large
 * is already distinguishable by size alone — reading 8GB of video to learn
 * something its `size_bytes` already says would cost more than the parse that
 * produced it. Over the cap the writer falls back to the path, which is what
 * {@link degenerateDiscriminator} does when there is no digest.
 */
export const MAX_DIGEST_BYTES = 2 * 1024 ** 3;

/**
 * Fingerprint a file the parser pointed at, or null when it cannot be read.
 *
 * STREAMED, not buffered: this runs over an unpacked export, where a single
 * entry is routinely larger than the heap, and the whole point is that
 * fingerprinting must never be the reason an import dies.
 *
 * Null on every failure — a missing file, a directory, a permission, a file
 * over {@link MAX_DIGEST_BYTES}. The caller degrades to the path rather than
 * failing the item, because a record we cannot fingerprint is still a record
 * the user exported.
 */
export async function digestFile(filePath: string): Promise<ContentDigest | null> {
  let sizeBytes: number;

  try {
    const info = await stat(filePath);

    if (!info.isFile()) {
      return null;
    }

    sizeBytes = info.size;
  } catch {
    return null;
  }

  if (sizeBytes > MAX_DIGEST_BYTES) {
    return null;
  }

  const hash = createHash('sha256');

  try {
    await pipeline(createReadStream(filePath), hash);
  } catch {
    return null;
  }

  return { sha256: hash.digest('hex'), sizeBytes };
}
