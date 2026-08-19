import { describe, expect, it } from 'vitest';

import {
  RAIL_DESTINATIONS,
  isRailDestinationActive,
  mobilePrimaryTabCount,
  splitMobileDestinations,
  visibleRailDestinations,
} from './railDestinations';

describe('visibleRailDestinations', () => {
  it('keeps ungated rows and drops gated ones whose flag is off', () => {
    const visible = visibleRailDestinations((flag) => flag !== 'chat.page');

    expect(visible.map((destination) => destination.id)).toEqual([
      'plan',
      'today',
      'forecast',
      'memory',
      'saved-searches',
      'sources',
      'jobs',
      'stats',
    ]);
  });
});

describe('mobilePrimaryTabCount', () => {
  it('falls back to four destinations when the bar has no width yet', () => {
    expect(mobilePrimaryTabCount(0, 9)).toBe(4);
  });

  it('reserves the last slot for More', () => {
    // 320px / 64 = 5 slots → 4 destinations + More
    expect(mobilePrimaryTabCount(320, 9)).toBe(4);
    // A tablet-width mobile shell can show most of the rail
    expect(mobilePrimaryTabCount(768, 9)).toBe(9);
  });
});

describe('splitMobileDestinations', () => {
  it('walks the rail left to right and parks the rest under More', () => {
    const destinations = visibleRailDestinations(() => true);
    const { primary, overflow } = splitMobileDestinations(destinations, 4);

    expect(primary.map((destination) => destination.id)).toEqual(['plan', 'today', 'forecast', 'memory']);
    expect(overflow.map((destination) => destination.id)).toEqual([
      'saved-searches',
      'chat',
      'sources',
      'jobs',
      'stats',
    ]);
  });
});

describe('isRailDestinationActive', () => {
  const byId = Object.fromEntries(RAIL_DESTINATIONS.map((destination) => [destination.id, destination]));

  it('treats Memory hub and legacy people routes as Memory', () => {
    expect(isRailDestinationActive(byId.memory, '/memory/people')).toBe(true);
    expect(isRailDestinationActive(byId.memory, '/people/abc')).toBe(true);
    expect(isRailDestinationActive(byId.memory, '/today')).toBe(false);
  });

  it('treats Sources children as Sources', () => {
    expect(isRailDestinationActive(byId.sources, '/sources/connect')).toBe(true);
    expect(isRailDestinationActive(byId.sources, '/plan')).toBe(false);
  });
});
