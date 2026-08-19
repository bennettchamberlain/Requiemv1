import { describe, expect, it } from 'vitest';

import { fitSignature, pinsInBounds, routePoints, type BoundsLike } from './pinSet';

function pin(id: string, lat: number, lng: number) {
  return { id, coords: { lat, lng } };
}

/** Stand-in for Leaflet's LatLngBounds: a plain rectangle. */
function box(minLat: number, minLng: number, maxLat: number, maxLng: number): BoundsLike {
  return {
    contains: ([lat, lng]) => lat >= minLat && lat <= maxLat && lng >= minLng && lng <= maxLng,
  };
}

describe('pinsInBounds', () => {
  it('keeps only the pins inside the viewport', () => {
    const pins = [pin('a', 37.77, -122.42), pin('b', 51.5, -0.12), pin('c', 37.8, -122.3)];

    expect(pinsInBounds(pins, box(37, -123, 38, -122)).map((p) => p.id)).toEqual(['a', 'c']);
  });

  it('returns an empty set when nothing is on screen — never the whole set', () => {
    expect(pinsInBounds([pin('a', 37.77, -122.42)], box(0, 0, 1, 1))).toEqual([]);
  });

  it('preserves order, so the route and the fit signature stay stable', () => {
    const pins = [pin('a', 1, 1), pin('b', 2, 2), pin('c', 3, 3)];

    expect(pinsInBounds(pins, box(0, 0, 10, 10)).map((p) => p.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('routePoints', () => {
  const pins = Array.from({ length: 120 }, (_, index) => pin(`p${index}`, index, index));

  it('caps the route at `max` points — one billed directions call per pair', () => {
    expect(routePoints(pins, 50)).toHaveLength(50);
  });

  it('keeps the MOST RECENT stretch (pins are time-ascending)', () => {
    const points = routePoints(pins, 3);

    expect(points).toEqual([
      [117, 117],
      [118, 118],
      [119, 119],
    ]);
  });

  it('returns everything when the set is under the cap', () => {
    expect(routePoints([pin('a', 1, 2), pin('b', 3, 4)], 50)).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  it('handles an empty set', () => {
    expect(routePoints([], 50)).toEqual([]);
  });
});

describe('fitSignature', () => {
  it('is empty for an empty set, so nothing is fitted to nothing', () => {
    expect(fitSignature([])).toBe('');
  });

  it('is stable for the same set', () => {
    const pins = [pin('a', 1, 1), pin('b', 2, 2)];

    expect(fitSignature(pins)).toBe(fitSignature([...pins]));
  });

  it('changes when the set grows — a new filter refits the viewport', () => {
    const pins = [pin('a', 1, 1), pin('b', 2, 2)];

    expect(fitSignature([...pins, pin('c', 3, 3)])).not.toBe(fitSignature(pins));
  });

  it('changes when the endpoints change at the same size', () => {
    expect(fitSignature([pin('a', 1, 1), pin('b', 2, 2)])).not.toBe(
      fitSignature([pin('a', 1, 1), pin('z', 2, 2)]),
    );
  });
});
