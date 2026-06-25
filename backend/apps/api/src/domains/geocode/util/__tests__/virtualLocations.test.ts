import { isVirtualLocation } from '../virtualLocations';

describe('isVirtualLocation', () => {
  it('returns false for null/empty/blank input', () => {
    expect(isVirtualLocation(null)).toBe(false);
    expect(isVirtualLocation(undefined)).toBe(false);
    expect(isVirtualLocation('')).toBe(false);
    expect(isVirtualLocation('   ')).toBe(false);
  });

  it('catches exact meeting-app / TBD tokens (case-insensitive)', () => {
    for (const token of ['zoom', 'Teams', 'GOOGLE MEET', 'tbd', 'n/a', 'phone call', 'online', 'remote']) {
      expect(isVirtualLocation(token)).toBe(true);
    }
  });

  it('catches meeting links and URLs embedded in a longer string', () => {
    expect(isVirtualLocation('Zoom: https://zoom.us/j/123456')).toBe(true);
    expect(isVirtualLocation('Join at meet.google.com/abc-defg-hij')).toBe(true);
    expect(isVirtualLocation('https://example.com/whatever')).toBe(true);
    expect(isVirtualLocation('teams.microsoft.com/l/meetup')).toBe(true);
  });

  it('catches a bare phone / dial-in number', () => {
    expect(isVirtualLocation('+1 (415) 555-0100')).toBe(true);
    expect(isVirtualLocation('555-867-5309')).toBe(true);
  });

  it('catches conservative casual non-address labels', () => {
    expect(isVirtualLocation("Mom's")).toBe(true);
    expect(isVirtualLocation("Dave's")).toBe(true);
    expect(isVirtualLocation('the usual spot')).toBe(true);
    expect(isVirtualLocation('my place')).toBe(true);
    expect(isVirtualLocation('here')).toBe(true);
    expect(isVirtualLocation('to be determined')).toBe(true);
  });

  it('does NOT over-block real addresses or named places', () => {
    const realPlaces = [
      '1600 Amphitheatre Pkwy, Mountain View, CA',
      '123 Main St',
      'Golden Gate Park',
      'Blue Bottle Coffee',
      "Joe's Pizza, 7 Carmine St, New York", // possessive but has address signals
      'Central Library',
      'SFO Airport',
      'Stanford University',
      "Mom's Diner on 5th Ave", // possessive name WITH address signal -> real
      'St. Patrick Cathedral',
    ];

    for (const place of realPlaces) {
      expect(isVirtualLocation(place)).toBe(false);
    }
  });

  it('exempts a possessive-looking label the moment an address signal appears', () => {
    // Bare "Dave's" is blocked, but with a street/number it is a real place.
    expect(isVirtualLocation("Dave's")).toBe(true);
    expect(isVirtualLocation("Dave's, 42 Elm Street")).toBe(false);
    expect(isVirtualLocation("Dave's Cafe")).toBe(false);
  });
});
