import { describe, expect, it } from 'vitest';

import { RAIL_DESTINATIONS, isRailDestinationActive, visibleRailDestinations } from './railDestinations';

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
