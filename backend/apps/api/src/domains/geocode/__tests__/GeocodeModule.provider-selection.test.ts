import { selectGeocodeProviderClass } from '../index';
import { GoogleGeocodeProvider } from '../services/GoogleGeocodeProvider';
import { PortalGeocodeProvider } from '../services/PortalGeocodeProvider';

/**
 * Covers the real DI wiring the flagged live issue (reverse-geocoding provider
 * misconfiguration) lives in: `config.geocoding.provider === 'google' ?
 * GoogleGeocodeProvider : PortalGeocodeProvider`, previously inlined in the
 * `@Module` providers array at import time with no test proving it picks the
 * right class. Everything downstream (GeocodeService, GeocodeBatchListener) is
 * tested against a provider handed to it directly, so a flipped ternary here
 * would silently swap providers with nothing to catch it.
 */
describe('selectGeocodeProviderClass', () => {
  it('selects GoogleGeocodeProvider when provider is "google"', () => {
    expect(selectGeocodeProviderClass('google')).toBe(GoogleGeocodeProvider);
  });

  it('selects PortalGeocodeProvider for the "portal" default', () => {
    expect(selectGeocodeProviderClass('portal')).toBe(PortalGeocodeProvider);
  });

  it('falls back to PortalGeocodeProvider (the safe default) for any unrecognized value', () => {
    // The appliance must never silently start calling Google directly on a typo'd
    // or unset config value — the fallback has to be the no-provider-key-on-box side.
    expect(selectGeocodeProviderClass('bogus')).toBe(PortalGeocodeProvider);
    expect(selectGeocodeProviderClass('')).toBe(PortalGeocodeProvider);
  });
});
