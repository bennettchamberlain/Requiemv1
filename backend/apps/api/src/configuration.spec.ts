import { isGeocodingConfigured, resolveGeocodingPortalBaseUrl } from './configuration';

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

/**
 * A base URL with no device key used to produce zero warnings anywhere except
 * a private, latched, log-only line inside PortalGeocodeProvider — this is
 * the ONE function a boot-time warning, PortalGeocodeProvider's own gate, and
 * a per-place "pending enrichment" signal all share, so they cannot disagree
 * about what "configured" means.
 */
describe('isGeocodingConfigured', () => {
  it('is false for the default (portal) provider with neither a base URL nor a device key', () => {
    expect(
      isGeocodingConfigured({
        geocoding: { provider: 'portal', portalBaseUrl: '' },
        ciPortal: { apiKey: '' },
      }),
    ).toBe(false);
  });

  it('is false for portal with a base URL but no device key — the exact gap that produced zero warnings', () => {
    expect(
      isGeocodingConfigured({
        geocoding: { provider: 'portal', portalBaseUrl: 'https://hub.ci.computer' },
        ciPortal: { apiKey: '' },
      }),
    ).toBe(false);
  });

  it('is false for portal with a device key but no base URL', () => {
    expect(
      isGeocodingConfigured({
        geocoding: { provider: 'portal', portalBaseUrl: '' },
        ciPortal: { apiKey: 'device-key' },
      }),
    ).toBe(false);
  });

  it('is true for portal once both are set', () => {
    expect(
      isGeocodingConfigured({
        geocoding: { provider: 'portal', portalBaseUrl: 'https://hub.ci.computer' },
        ciPortal: { apiKey: 'device-key' },
      }),
    ).toBe(true);
  });

  it('checks apiKey, not the portal fields, when the provider is google', () => {
    expect(
      isGeocodingConfigured({
        geocoding: { provider: 'google', apiKey: '', portalBaseUrl: 'https://hub.ci.computer' },
        ciPortal: { apiKey: 'device-key' },
      }),
    ).toBe(false);
    expect(
      isGeocodingConfigured({
        geocoding: { provider: 'google', apiKey: 'google-key', portalBaseUrl: '' },
        ciPortal: { apiKey: '' },
      }),
    ).toBe(true);
  });
});
