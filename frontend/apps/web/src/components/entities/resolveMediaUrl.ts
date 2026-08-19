/**
 * Resolve a media path for the Memory UI.
 * Absolute http(s) URLs are used as-is; relative object-store keys are served
 * under `/static` (same contract as Gallery `getEntityMedia` / FileDetails).
 */
export function resolveMediaUrl(value?: string | null): string | undefined {
  if (!value) {
    return undefined;
  }

  return /^https?:\/\//.test(value) ? value : `/static${value}`;
}

/**
 * Tile/row thumbnail for a FileType: prefer the derived preview, then the
 * original source for images (and videos when no preview exists yet).
 * Matches Gallery `getEntityMedia` so Capture screenshots render before
 * preview generation finishes.
 */
export function resolveFileTileUrl(opts: {
  contentType?: string | null;
  previewUrl?: string | null;
  sourceUrl?: string | null;
}): string | undefined {
  const preview = resolveMediaUrl(opts.previewUrl);
  if (preview) {
    return preview;
  }

  const contentType = opts.contentType ?? '';
  if (contentType.startsWith('image/') || contentType.startsWith('video/')) {
    return resolveMediaUrl(opts.sourceUrl);
  }

  return undefined;
}
