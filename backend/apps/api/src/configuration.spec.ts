import { resolveGeocodingPortalBaseUrl } from './configuration';

/**
 * Covers the geocoding portalBaseUrl fallback (previously an inline `if` at
 * module-parse time with zero coverage): an explicit GEOCODING_PORTAL_BASE_URL
 * wins, otherwise the box's existing Portal URL (ciPortal.url / CI_CLOUD_URL)
 * is reused so a box that already talks to Portal needs no extra env var.
 */
describe('resolveGeocodingPortalBaseUrl', () => {
  it('keeps an explicitly configured portalBaseUrl as-is', () => {
    expect(resolveGeocodingPortalBaseUrl('https://geocode.example.com', 'https://cloud.example.com')).toBe(
      'https://geocode.example.com',
    );
  });

  it('falls back to ciPortal.url when portalBaseUrl is unset (empty string)', () => {
    expect(resolveGeocodingPortalBaseUrl('', 'https://cloud.example.com')).toBe('https://cloud.example.com');
  });

  it('resolves to an empty string when neither is configured', () => {
    expect(resolveGeocodingPortalBaseUrl('', undefined)).toBe('');
  });

  it('does not fall back when ciPortal.url is undefined but portalBaseUrl is set', () => {
    expect(resolveGeocodingPortalBaseUrl('https://geocode.example.com', undefined)).toBe(
      'https://geocode.example.com',
    );
  });
});
