import { describe, expect, it } from 'vitest';

import {
  RAIL_DESTINATIONS,
  allRailDestinations,
  isRailDestinationActive,
  visibleRailDestinations,
} from './railDestinations';

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
      'self',
    ]);
  });

  // Two peer rows for "talk to it" and "what it asked back" read as two
  // unrelated places. One group, one row.
  it('carries Asks inside the Chat group rather than as a peer row', () => {
    const visible = visibleRailDestinations(() => true);
    const ids = visible.map((destination) => destination.id);

    expect(ids).toContain('chat');
    expect(ids).not.toContain('asks');
    expect(visible.find((d) => d.id === 'chat')?.children?.map((c) => c.id)).toEqual(['asks']);
  });

  // Grouping is a layout decision; it must not become a second gate. /asks is
  // still a registered route when `chat.page` is off, so the row has to survive
  // its group head.
  it('promotes Asks back to a top-level row when the Chat group is gated off', () => {
    const visible = visibleRailDestinations((flag) => flag !== 'chat.page');
    const asks = visible.find((destination) => destination.id === 'asks');

    expect(asks?.to).toBe('/asks');
    expect(visible.find((destination) => destination.id === 'chat')).toBeUndefined();
  });

  it('drops Asks from the group when `ask` is off but keeps Chat', () => {
    const visible = visibleRailDestinations((flag) => flag !== 'ask');

    expect(visible.map((destination) => destination.id)).toContain('chat');
    expect(visible.find((d) => d.id === 'chat')?.children).toEqual([]);
    expect(allRailDestinations().map((d) => d.id)).toContain('asks');
  });

  it('marks a thread deep-link as Chat so the group stays lit', () => {
    const chat = visibleRailDestinations(() => true).find((destination) => destination.id === 'chat');

    expect(chat?.end).toBe(false);
    expect(isRailDestinationActive(chat!, '/chat/abc123')).toBe(true);
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
    const asks = allRailDestinations().find((destination) => destination.id === 'asks');

    expect(asks?.flag).toBe('ask');
    expect(asks?.to).toBe('/asks');
    expect(visibleRailDestinations((flag) => flag !== 'ask').flatMap((d) => d.children ?? [])).toEqual([]);
    expect(visibleRailDestinations((flag) => flag !== 'ask').map((d) => d.id)).not.toContain('asks');
  });
});

describe('isRailDestinationActive', () => {
  const byId = Object.fromEntries(allRailDestinations().map((destination) => [destination.id, destination]));

  it('treats Memory hub and legacy people routes as Memory', () => {
    expect(byId.memory.to).toBe('/memory');
    expect(isRailDestinationActive(byId.memory, '/memory')).toBe(true);
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
