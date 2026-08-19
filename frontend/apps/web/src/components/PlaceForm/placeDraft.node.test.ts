import { describe, expect, it } from 'vitest';

import {
  PLACE_KINDS,
  PLACE_KIND_LABELS,
  emptyPlaceDraft,
  parseCoordinates,
  placeDraftToInput,
  validatePlaceDraft,
  type PlaceDraft,
} from './placeDraft';

function draft(overrides: Partial<PlaceDraft> = {}): PlaceDraft {
  return { ...emptyPlaceDraft(), name: 'Blue Bottle', ...overrides };
}

describe('PLACE_KINDS', () => {
  it('has a label for every kind the server accepts', () => {
    for (const kind of PLACE_KINDS) {
      expect(PLACE_KIND_LABELS[kind]).toBeTruthy();
    }
  });
});

describe('parseCoordinates', () => {
  it('parses a full pair', () => {
    expect(parseCoordinates('37.7823', '-122.4076')).toEqual({ latitude: 37.7823, longitude: -122.4076 });
  });

  it('is null unless both parts are given', () => {
    expect(parseCoordinates('37.7823', '')).toBeNull();
    expect(parseCoordinates('', '-122.4076')).toBeNull();
  });

  it('rejects out-of-range and non-numeric values', () => {
    expect(parseCoordinates('91', '0')).toBeNull();
    expect(parseCoordinates('0', '-181')).toBeNull();
    expect(parseCoordinates('somewhere', '0')).toBeNull();
  });
});

describe('validatePlaceDraft', () => {
  it('passes a named place', () => {
    expect(validatePlaceDraft(draft())).toBeNull();
  });

  it('requires a name', () => {
    expect(validatePlaceDraft(draft({ name: '  ' }))).toBe('name');
  });

  it('rejects half a coordinate pair rather than dropping it silently', () => {
    expect(validatePlaceDraft(draft({ latitude: '37.7823' }))).toBe('coordinates');
  });
});

describe('placeDraftToInput', () => {
  it('omits blank optional fields instead of sending empty strings', () => {
    const input = placeDraftToInput(draft());

    expect(input).toEqual({
      name: 'Blue Bottle',
      description: undefined,
      placeKind: undefined,
      properties: undefined,
      latitude: undefined,
      longitude: undefined,
    });
  });

  it('never sends placeKind as an empty string — the resolver rejects unknown kinds', () => {
    expect(placeDraftToInput(draft({ placeKind: '' })).placeKind).toBeUndefined();
    expect(placeDraftToInput(draft({ placeKind: 'venue' })).placeKind).toBe('venue');
  });

  it('sends coordinates as typed top-level fields, not inside properties', () => {
    const input = placeDraftToInput(draft({ latitude: '37.7823', longitude: '-122.4076' }));

    expect(input.latitude).toBe(37.7823);
    expect(input.longitude).toBe(-122.4076);
    expect(input.properties).toBeUndefined();
  });

  it('puts the address on properties.address, where the detail drawer reads it', () => {
    expect(placeDraftToInput(draft({ address: '  66 Mint St  ' })).properties).toEqual({
      address: '66 Mint St',
    });
  });

  it('trims the name', () => {
    expect(placeDraftToInput(draft({ name: '  Blue Bottle  ' })).name).toBe('Blue Bottle');
  });

  it('throws rather than posting an unnamed place', () => {
    expect(() => placeDraftToInput(draft({ name: '' }))).toThrow(/needs a name/i);
  });
});
