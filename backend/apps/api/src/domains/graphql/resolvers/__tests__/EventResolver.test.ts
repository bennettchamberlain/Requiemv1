import { type RequestContext } from '@ci/common/context';
import { type Event } from '@ci/domains/memory';

import { EventType } from '../../types/EventType';
import { GlobalUID } from '../../types/GlobalUID';
import { EventResolver } from '../EventResolver';

const viewerCtx = { userId: 'viewer-1' } as unknown as RequestContext;

function makeEvent(overrides: Partial<Event> = {}): Event {
  return {
    id: 'e1',
    userId: 'viewer-1',
    category: null,
    title: 'Some event',
    description: null,
    eventType: null,
    startTime: new Date('2026-08-01T00:00:00Z'),
    endTime: null,
    durationMinutes: null,
    locationName: null,
    locationCoordinates: null,
    locationEntityId: null,
    participantEntityIds: null,
    organizerEntityId: null,
    sourceType: null,
    sourceSystem: null,
    externalSyncStatus: null,
    sourceId: null,
    confidenceScore: null,
    isRecurring: false,
    isAllDay: false,
    metadata: null,
    status: null,
    ...overrides,
  } as unknown as Event;
}

function makeResolver() {
  const eventService = {
    findAll: jest.fn().mockResolvedValue([] as Event[]),
    findInRange: jest.fn(),
    findById: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    reschedule: jest.fn(),
    getDistinctEventTypes: jest.fn(),
    getDistinctEventSources: jest.fn(),
  };
  const personLoader = { load: jest.fn(), loadMany: jest.fn().mockResolvedValue([]) };
  const placeLoader = { load: jest.fn() };
  const tagLoader = { load: jest.fn().mockResolvedValue([]) };
  const eventMediaLoader = { load: jest.fn() };
  const eventContentsLoader = { load: jest.fn().mockResolvedValue([]) };

  const resolver = new EventResolver(
    eventService as never,
    personLoader as never,
    placeLoader as never,
    tagLoader as never,
    eventMediaLoader as never,
    eventContentsLoader as never,
  );

  return { resolver, eventService, personLoader, placeLoader, tagLoader, eventMediaLoader, eventContentsLoader };
}

describe('EventResolver.events', () => {
  it('scopes findAll to the requesting viewer', async () => {
    const { resolver, eventService } = makeResolver();

    await resolver.events(viewerCtx, {});

    expect(eventService.findAll).toHaveBeenCalledWith({ userId: 'viewer-1' });
  });

  it('composes findAll + Paginator.paginate: slices the page, keeps the full-set totalCount, and GlobalUID-encodes cursors', async () => {
    const { resolver, eventService } = makeResolver();
    const events = [makeEvent({ id: 'e1' }), makeEvent({ id: 'e2' }), makeEvent({ id: 'e3' })];
    eventService.findAll.mockResolvedValue(events);

    const result = await resolver.events(viewerCtx, { first: 2 });

    // totalCount must reflect the FULL matching set, not just the returned
    // page — this is the exact contract that made SearchResolver's totalCount
    // fabrication (fixed in 9d13b92c5) a bug: it fed a partial window into a
    // paginator whose totalCount is items.length.
    expect(result.totalCount).toBe(3);
    expect(result.edges).toHaveLength(2);
    expect(result.edges[0].cursor).toBe(GlobalUID.encode('event', 'e1'));
    expect(result.edges[1].cursor).toBe(GlobalUID.encode('event', 'e2'));
    expect(result.pageInfo.hasNextPage).toBe(true);
    expect(result.pageInfo.hasPreviousPage).toBe(false);
  });

  it('pages past a cursor with after', async () => {
    const { resolver, eventService } = makeResolver();
    const events = [makeEvent({ id: 'e1' }), makeEvent({ id: 'e2' }), makeEvent({ id: 'e3' })];
    eventService.findAll.mockResolvedValue(events);

    const result = await resolver.events(viewerCtx, { first: 10, after: GlobalUID.encode('event', 'e1') });

    expect(result.edges.map((edge) => edge.node.id)).toEqual([
      GlobalUID.encode('event', 'e2'),
      GlobalUID.encode('event', 'e3'),
    ]);
    expect(result.pageInfo.hasNextPage).toBe(false);
  });

  it('returns an empty connection (not an error) when the user has no events', async () => {
    const { resolver, eventService } = makeResolver();
    eventService.findAll.mockResolvedValue([]);

    const result = await resolver.events(viewerCtx, {});

    expect(result).toEqual({
      edges: [],
      pageInfo: { hasNextPage: false, hasPreviousPage: false, startCursor: null, endCursor: null },
      totalCount: 0,
    });
  });
});

describe('EventResolver sub-resolvers: entityOwnerScope wiring', () => {
  // These ResolveFields intentionally resolve under the EVENT's owner, not
  // the viewer — the shared-search cross-user read entityOwnerScope exists
  // for. A regression that scoped these to the viewer instead would make a
  // shared search's organizer/location/tags silently come back empty; a
  // regression that scoped them to something OTHER than the true owner would
  // be a tenancy leak. Assert against a viewer that deliberately differs from
  // the event's owner so either mistake fails the test.

  it('organizer resolves against the event owner scope, not the viewer', async () => {
    const { resolver, personLoader } = makeResolver();
    const event = makeEvent({ id: 'e1', userId: 'owner-2', organizerEntityId: 'person-1' });
    const parent = EventType.toType(event);
    personLoader.load.mockResolvedValue({ id: 'person-1', name: 'Alice' });

    await resolver.organizer(viewerCtx, parent);

    expect(personLoader.load).toHaveBeenCalledWith({ userId: 'owner-2' }, 'person-1');
  });

  it('organizer falls back to the viewer scope when the event carries no owner', async () => {
    const { resolver, personLoader } = makeResolver();
    const event = makeEvent({ id: 'e1', userId: null as unknown as string, organizerEntityId: 'person-1' });
    const parent = EventType.toType(event);
    personLoader.load.mockResolvedValue({ id: 'person-1', name: 'Alice' });

    await resolver.organizer(viewerCtx, parent);

    expect(personLoader.load).toHaveBeenCalledWith({ userId: 'viewer-1' }, 'person-1');
  });

  it('location resolves against the event owner scope, not the viewer', async () => {
    const { resolver, placeLoader } = makeResolver();
    const event = makeEvent({ id: 'e1', userId: 'owner-2', locationEntityId: 'place-1' });
    const parent = EventType.toType(event);
    placeLoader.load.mockResolvedValue({ id: 'place-1', name: 'Home' });

    await resolver.location(viewerCtx, parent);

    expect(placeLoader.load).toHaveBeenCalledWith({ userId: 'owner-2' }, 'place-1');
  });

  it('tags resolves against the event owner scope, not the viewer', async () => {
    const { resolver, tagLoader } = makeResolver();
    const event = makeEvent({ id: 'e1', userId: 'owner-2' });
    const parent = EventType.toType(event);

    await resolver.tags(viewerCtx, parent);

    expect(tagLoader.load).toHaveBeenCalledWith({ userId: 'owner-2' }, { type: 'event', id: 'e1' });
  });

  it('media fields resolve against the event owner scope, not the viewer', async () => {
    const { resolver, eventMediaLoader } = makeResolver();
    const event = makeEvent({ id: 'e1', userId: 'owner-2' });
    const parent = EventType.toType(event);
    eventMediaLoader.load.mockResolvedValue(null);

    await resolver.previewUrl(viewerCtx, parent);

    expect(eventMediaLoader.load).toHaveBeenCalledWith({ userId: 'owner-2' }, 'e1');
  });
});
