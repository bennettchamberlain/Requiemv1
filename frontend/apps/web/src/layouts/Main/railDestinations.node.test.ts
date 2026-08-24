import { describe, expect, it } from 'vitest';

import { RAIL_DESTINATIONS, isRailDestinationActive, visibleRailDestinations } from './railDestinations';

describe('visibleRailDestinations', () => {
  it('keeps ungated rows and drops gated ones whose flag is off', () => {
    const visible = visibleRailDestinations((flag) => flag !== 'chat.page');

    expect(visible.map((destination) => destination.id)).toEqual([
      'plan',
      'calendar',
      'forecast',
      'memory',
      'saved-searches',
      'asks',
      'sources',
      'jobs',
      'stats',
    ]);
  });

  it('gates Forecast on `forecast.page` — the same flag the /forecast route checks', () => {
    const forecast = RAIL_DESTINATIONS.find((destination) => destination.id === 'forecast');

    expect(forecast?.flag).toBe('forecast.page');
    expect(forecast?.to).toBe('/forecast');
    expect(visibleRailDestinations((flag) => flag !== 'forecast.page').map((d) => d.id)).not.toContain(
      'forecast',
    );
    expect(visibleRailDestinations(() => true).map((d) => d.id)).toContain('forecast');
  });

  it('gates Asks on `ask` — the flag the /asks route itself checks', () => {
    // /asks was reachable only by typing the URL. The row has to ride the same
    // flag as the route: the route is not REGISTERED when `ask` is off, so a
    // row gated on anything else would render a link to a 404.
    const asks = RAIL_DESTINATIONS.find((destination) => destination.id === 'asks');

    expect(asks?.flag).toBe('ask');
    expect(asks?.to).toBe('/asks');
    expect(visibleRailDestinations((flag) => flag !== 'ask').map((d) => d.id)).not.toContain('asks');
    expect(visibleRailDestinations(() => true).map((d) => d.id)).toContain('asks');
  });
});

describe('isRailDestinationActive', () => {
  const byId = Object.fromEntries(RAIL_DESTINATIONS.map((destination) => [destination.id, destination]));

  it('treats Memory hub and legacy people routes as Memory', () => {
    expect(isRailDestinationActive(byId.memory, '/memory/people')).toBe(true);
    expect(isRailDestinationActive(byId.memory, '/people/abc')).toBe(true);
    expect(isRailDestinationActive(byId.memory, '/calendar')).toBe(false);
  });

  it('treats Calendar card deep-links as Calendar', () => {
    expect(isRailDestinationActive(byId.calendar, '/calendar')).toBe(true);
    expect(isRailDestinationActive(byId.calendar, '/calendar/a1')).toBe(true);
    expect(isRailDestinationActive(byId.calendar, '/forecast')).toBe(false);
  });

  it('treats Sources children as Sources', () => {
    expect(isRailDestinationActive(byId.sources, '/sources/connect')).toBe(true);
    expect(isRailDestinationActive(byId.sources, '/plan')).toBe(false);
  });
});
