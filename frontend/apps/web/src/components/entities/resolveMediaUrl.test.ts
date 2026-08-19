import { describe, expect, it } from 'vitest';

import { resolveFileTileUrl, resolveMediaUrl } from './resolveMediaUrl';

describe('resolveMediaUrl', () => {
  it('prefixes relative paths with /static', () => {
    expect(resolveMediaUrl('/u/shot.png')).toBe('/static/u/shot.png');
  });

  it('leaves absolute http(s) URLs alone', () => {
    expect(resolveMediaUrl('https://cdn.example.com/a.png')).toBe('https://cdn.example.com/a.png');
  });

  it('returns undefined for empty values', () => {
    expect(resolveMediaUrl(null)).toBeUndefined();
    expect(resolveMediaUrl('')).toBeUndefined();
  });
});

describe('resolveFileTileUrl', () => {
  it('prefers previewUrl when present', () => {
    expect(
      resolveFileTileUrl({
        contentType: 'image/png',
        previewUrl: '/p/thumb.png',
        sourceUrl: '/u/shot.png',
      }),
    ).toBe('/static/p/thumb.png');
  });

  it('falls back to sourceUrl for image/png when preview is missing', () => {
    expect(
      resolveFileTileUrl({
        contentType: 'image/png',
        previewUrl: null,
        sourceUrl: '/u/shot.png',
      }),
    ).toBe('/static/u/shot.png');
  });

  it('falls back to sourceUrl for video when preview is missing', () => {
    expect(
      resolveFileTileUrl({
        contentType: 'video/mp4',
        previewUrl: null,
        sourceUrl: '/u/clip.mp4',
      }),
    ).toBe('/static/u/clip.mp4');
  });

  it('does not use sourceUrl for non-media content types', () => {
    expect(
      resolveFileTileUrl({
        contentType: 'application/pdf',
        previewUrl: null,
        sourceUrl: '/u/doc.pdf',
      }),
    ).toBeUndefined();
  });
});
