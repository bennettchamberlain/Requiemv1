import type { EventPayloads, Events } from '@ci/domains/events';

import { GraphEventListener } from '../GraphEventListener';

type Payload = EventPayloads[Events.GRAPH_NODE_UPSERTED];

function makeListener(created: boolean, entityType: string | undefined = 'Concept') {
  const createOrUpdateNode = jest.fn(async () => ({
    node: { entity_id: 'entity-1', entity_type: entityType },
    created,
  }));
  const send = jest.fn(async () => ['job-1']);
  const logger = { setContext: jest.fn(), log: jest.fn(), debug: jest.fn(), error: jest.fn() };

  const listener = new GraphEventListener(
    { createOrUpdateNode } as never,
    { send } as never,
    logger as never,
  );

  return { listener, createOrUpdateNode, send, logger };
}

function payload(entityType?: string): Payload {
  return {
    ownerId: 'owner-1',
    node: {
      entityId: 'entity-1',
      entityType,
      name: 'Sourdough starter',
      description: 'Fed weekly',
      properties: {},
    },
  } as Payload;
}

describe('GraphEventListener.handleNodeUpserted', () => {
  it('emits ConceptCreatedEvent so the concept reaches the search index', async () => {
    const { listener, send } = makeListener(true, 'Concept');

    await listener.handleNodeUpserted(payload('Concept'));

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('concept.created', { conceptId: 'entity-1' });
  });

  it('emits the UPDATED event when the node already existed, so a renamed node is re-indexed', async () => {
    const { listener, send } = makeListener(false, 'Concept');

    await listener.handleNodeUpserted(payload('Concept'));

    expect(send).toHaveBeenCalledWith('concept.updated', { conceptId: 'entity-1' });
  });

  it('maps the graph vocabulary onto the owning domain (Contact -> person, Location -> place)', async () => {
    const contact = makeListener(true, 'Contact');
    await contact.listener.handleNodeUpserted(payload('Contact'));
    expect(contact.send).toHaveBeenCalledWith('person.created', { personId: 'entity-1' });

    const location = makeListener(true, 'Location');
    await location.listener.handleNodeUpserted(payload('Location'));
    expect(location.send).toHaveBeenCalledWith('place.created', { placeId: 'entity-1' });
  });

  it('emits nothing for types with no resolvable domain row (left to GraphNodeSearchIndexListener)', async () => {
    for (const type of ['Event', 'Item', 'Content', 'Organization']) {
      const { listener, send } = makeListener(true, type);

      await listener.handleNodeUpserted(payload(type));

      expect(send).not.toHaveBeenCalled();
    }
  });

  it('uses the persisted entity_type, not the payload type, when resolving the event', async () => {
    // createOrUpdateNode is the authority on the stored discriminator: an
    // entity.update may omit entityType entirely.
    const { listener, send } = makeListener(false, 'Person');

    await listener.handleNodeUpserted(payload(undefined));

    expect(send).toHaveBeenCalledWith('person.updated', { personId: 'entity-1' });
  });

  it('swallows a write failure without emitting a search event', async () => {
    const { listener, send, logger, createOrUpdateNode } = makeListener(true);
    createOrUpdateNode.mockRejectedValueOnce(new Error('boom'));

    await expect(listener.handleNodeUpserted(payload('Concept'))).resolves.toBeUndefined();

    expect(send).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalled();
  });
});
