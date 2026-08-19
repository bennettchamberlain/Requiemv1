import { isUriLocation, isVirtualLocation } from '../virtualLocations';

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

describe('isUriLocation', () => {
  it('catches meeting-join links regardless of which app hosts them', () => {
    // The generic scheme grammar (RFC 3986 `scheme "://"`) is deliberate — see
    // the doc comment — so it does not need a per-app hostname list.
    expect(isUriLocation('https://khronosgroup.zoom.us/w/99353948195?tk=abc')).toBe(true);
    expect(isUriLocation('https://us02web.zoom.us/j/8842952968?pwd=xyz')).toBe(true);
    expect(isUriLocation('https://meet.google.com/abc-defg-hij')).toBe(true);
    expect(isUriLocation('https://teams.microsoft.com/l/meetup-join/abc')).toBe(true);
    expect(isUriLocation('http://example.com')).toBe(true);
  });

  it('catches a custom-scheme URI, e.g. an AltspaceVR event link', () => {
    expect(isUriLocation('altspace://account.altvr.com/api/events/1629227784846967373')).toBe(true);
  });

  it('tolerates surrounding whitespace', () => {
    expect(isUriLocation('  https://zoom.us/j/123  \n')).toBe(true);
  });

  it('returns false for a real place name, even one that contains a colon or slash', () => {
    expect(isUriLocation('1600 Amphitheatre Pkwy, Mountain View, CA')).toBe(false);
    expect(isUriLocation('Golden Gate Park')).toBe(false);
    expect(isUriLocation('Room 4/B')).toBe(false);
    expect(isUriLocation('9:00 AM Standup')).toBe(false);
    expect(isUriLocation('')).toBe(false);
  });

  it('does not flag a place name that merely mentions a URL in passing', () => {
    // The value must be NOTHING BUT the URI to be disqualified — mirrors
    // isCoordinateText's "nothing else" narrowness.
    expect(isUriLocation('Cafe, see https://cafe.example for menu')).toBe(false);
  });
});
