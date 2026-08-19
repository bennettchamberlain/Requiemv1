import type { RequestContext } from '@ci/common/context';

import { GraphController } from '../GraphController';

/**
 * Graph search + node→record resolution.
 *
 *  - the entity-type filter must not exclude the type the user selected (the explorer→graph map
 *    is many-to-many, so `browser-activity` shares `Event` with `event` and shared `Content`
 *    with `note`);
 *  - a result set larger than the canvas cap is reported as truncated instead of being handed
 *    over as a silent slice;
 *  - `/graph/source` names the record behind a node so a click can open the shared detail drawer.
 */
describe('GraphController — search and node source', () => {
  const ctx = { userId: 'user-1' } as RequestContext;

  function graphNode(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      entity_id: 'entity-1',
      entity_type: 'Person',
      name: 'Frida Friend',
      description: null,
      properties: {},
      linked_table: null,
      linked_id: null,
      ...overrides,
    };
  }

  function searchDto(overrides: Record<string, unknown> = {}) {
    return {
      query: 'frida',
      limit: undefined,
      includeTypes: undefined,
      tags: undefined,
      connectors: undefined,
      people: undefined,
      places: undefined,
      eventTypes: undefined,
      hasLocation: false,
      from: undefined,
      to: undefined,
      ...overrides,
    } as Parameters<GraphController['searchGraph']>[1];
  }

  function setup(
    overrides: {
      searchNodesByPrefix?: jest.Mock;
      searchNodesByText?: jest.Mock;
      getNode?: jest.Mock;
      getEntityIdsByTagSources?: jest.Mock;
    } = {},
  ) {
    const graphQuery = {
      searchNodesByPrefix: overrides.searchNodesByPrefix ?? jest.fn(async () => []),
      searchNodesByText: overrides.searchNodesByText ?? jest.fn(async () => []),
      getNode: overrides.getNode ?? jest.fn(async () => null),
      getEntityIdsByTagSources: overrides.getEntityIdsByTagSources ?? jest.fn(async () => []),
      getRelationships: jest.fn(async () => []),
    };

    const controller = new GraphController(
      {} as never, // graphEvents
      graphQuery as never,
      {} as never, // graphUtility
      {} as never, // userContext
      { getEntitiesForTags: jest.fn(async () => []) } as never,
      { getEntitiesForEvents: jest.fn(async () => []) } as never,
      {} as never, // lifeStats
    );

    return { controller, graphQuery };
  }

  describe('entity-type filter', () => {
    // Regression: selecting "Events" excluded Event, because the deselected `browser-activity`
    // maps to Event too — the canvas answered an event search with Concepts.
    it('keeps the selected type even when a deselected type maps onto it', async () => {
      const eventNode = graphNode({ entity_id: 'event-1', entity_type: 'Event', name: 'Frida dinner' });
      const { controller } = setup({
        searchNodesByPrefix: jest.fn(async () => [eventNode]),
      });

      const res = await controller.searchGraph(ctx, searchDto({ includeTypes: ['event'] }));

      expect(res.nodes.map((node) => node.entity_id)).toEqual(['event-1']);
    });

    it('still drops types the user deselected', async () => {
      const contentNode = graphNode({ entity_id: 'content-1', entity_type: 'Content' });
      const { controller } = setup({
        searchNodesByPrefix: jest.fn(async () => [contentNode]),
      });

      const res = await controller.searchGraph(ctx, searchDto({ includeTypes: ['event'] }));

      expect(res.nodes).toEqual([]);
    });
  });

  describe('result cap', () => {
    it('reports truncation and trims to the cap when more matched than fits', async () => {
      const matches = Array.from({ length: 6 }, (_, index) => graphNode({ entity_id: `entity-${index}` }));
      const { controller, graphQuery } = setup({
        searchNodesByPrefix: jest.fn(async () => matches),
      });

      const res = await controller.searchGraph(ctx, searchDto({ limit: 5 }));

      expect(res.nodes).toHaveLength(5);
      expect(res.truncated).toBe(true);
      expect(res.limit).toBe(5);
      // The candidate fetch reaches one past the cap: that probe is what makes truncation
      // detectable rather than assumed.
      expect(graphQuery.searchNodesByPrefix).toHaveBeenCalledWith(
        'user-1',
        'frida',
        expect.objectContaining({ limit: 6 }),
      );
    });

    it('reports no truncation when everything matched fits', async () => {
      const { controller } = setup({
        searchNodesByPrefix: jest.fn(async () => [graphNode()]),
      });

      const res = await controller.searchGraph(ctx, searchDto({ limit: 5 }));

      expect(res.nodes).toHaveLength(1);
      expect(res.truncated).toBe(false);
    });
  });

  describe('node source', () => {
    const uuid = '11111111-1111-4111-8111-111111111111';
    const linkedUuid = '22222222-2222-4222-8222-222222222222';

    it('resolves an in-place entity (Person) to its own id', async () => {
      const { controller } = setup({
        getNode: jest.fn(async () => graphNode({ entity_id: uuid, entity_type: 'Person' })),
      });

      const res = await controller.getNodeSource(ctx, { entityId: uuid });

      expect(res.source).toEqual({ type: 'person', id: uuid });
    });

    // File nodes are the proof that entity_id and the record id are not the same thing: the
    // node mirrors a ci.files row addressed by linked_id.
    it('resolves a mirror node (File) through linked_id', async () => {
      const { controller } = setup({
        getNode: jest.fn(async () =>
          graphNode({ entity_id: uuid, entity_type: 'File', linked_table: 'files', linked_id: linkedUuid }),
        ),
      });

      const res = await controller.getNodeSource(ctx, { entityId: uuid });

      expect(res.source).toEqual({ type: 'file', id: linkedUuid });
    });

    it('returns no source for a graph type with no addressable record', async () => {
      const { controller } = setup({
        getNode: jest.fn(async () => graphNode({ entity_id: uuid, entity_type: 'Group' })),
      });

      const res = await controller.getNodeSource(ctx, { entityId: uuid });

      expect(res.source).toBeNull();
    });

    it('404s on an unknown node', async () => {
      const { controller } = setup();

      await expect(controller.getNodeSource(ctx, { entityId: uuid })).rejects.toThrow(/not found/i);
    });
  });
});
