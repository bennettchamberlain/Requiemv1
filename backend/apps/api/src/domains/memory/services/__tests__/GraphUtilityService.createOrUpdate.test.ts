import { InMemoryRepository } from '../../../__tests__/support/inMemoryRepository';
import { GraphNodeEntity } from '../../entities/GraphNodeEntity';
import { RelationshipEntity } from '../../entities/RelationshipEntity';
import { GraphUtilityService } from '../GraphUtilityService';

/**
 * The write contract every graph-node producer relies on: on UPDATE, a field
 * left `undefined` keeps its stored value and `null` clears it.
 *
 * `linkedTable`/`linkedId` are why it matters. An importer upserts on
 * `(owner, entity_type, linked_table, linked_id)`, so a write that clears the
 * linked key — or changes the type — detaches the row, and the next import of
 * the same source mints a duplicate beside it. The `memory.remember` pipeline
 * used to turn every field its caller omitted into `null` on the way here.
 */

const OWNER = 'owner-1';
const NODE = 'node-1';
const EDGE = 'edge-1';

function storedNode(overrides: Partial<GraphNodeEntity> = {}): GraphNodeEntity {
  return Object.assign(new GraphNodeEntity(), {
    entity_id: NODE,
    owner_user_id: OWNER,
    entity_type: 'Person',
    outgoing_relationships: [],
    name: 'Alex Rivera',
    description: 'Google Contacts card',
    properties: { emails: ['alex@example.com'], planner: { trust_mode: 'ask' } },
    dossier: null,
    search_content: 'Alex Rivera alex@example.com',
    linked_table: 'import:google-contacts',
    linked_id: '6c1f7a52-9d1e-5b0a-8f3e-2a4b6c8d0e1f',
    is_active: true,
    is_archived: false,
    ...overrides,
  });
}

function storedEdge(overrides: Partial<RelationshipEntity> = {}): RelationshipEntity {
  return Object.assign(new RelationshipEntity(), {
    relationship_id: EDGE,
    owner_user_id: OWNER,
    from_entity_id: 'from-1',
    to_entity_id: 'to-1',
    relationship_type: 'KNOWS',
    properties: { since: '2019', source: 'google-contacts' },
    strength: 0.4,
    is_bidirectional: true,
    start_date: null,
    end_date: null,
    is_active: true,
    ...overrides,
  });
}

function setup(seed: { nodes?: GraphNodeEntity[]; edges?: RelationshipEntity[] } = {}) {
  const nodes = new InMemoryRepository<GraphNodeEntity>('entity_id');
  const edges = new InMemoryRepository<RelationshipEntity>('relationship_id');
  nodes.seed(...(seed.nodes ?? []));
  edges.seed(...(seed.edges ?? []));

  const service = new GraphUtilityService(nodes as never, edges as never, { setContext: jest.fn() } as never);

  return { service, nodes, edges };
}

describe('GraphUtilityService.createOrUpdateNode — updating an existing row', () => {
  it.each([
    ['name', 'name'],
    ['description', 'description'],
    ['searchContent', 'search_content'],
    ['linkedTable', 'linked_table'],
    ['linkedId', 'linked_id'],
  ] as const)(
    'keeps the stored %s when the write leaves it undefined, and clears it on an explicit null',
    async (field, column) => {
      const before = storedNode();

      const untouched = setup({ nodes: [before] });
      await untouched.service.createOrUpdateNode(OWNER, { entityId: NODE, [field]: undefined });
      expect(untouched.nodes.get(NODE)?.[column]).toEqual(before[column]);

      const cleared = setup({ nodes: [before] });
      await cleared.service.createOrUpdateNode(OWNER, { entityId: NODE, [field]: null });
      expect(cleared.nodes.get(NODE)?.[column]).toBeNull();
    },
  );

  it('keeps entity_type unless a type is given', async () => {
    const { service, nodes } = setup({ nodes: [storedNode()] });

    await service.createOrUpdateNode(OWNER, { entityId: NODE, name: 'Alex R.' });

    expect(nodes.get(NODE)?.entity_type).toBe('Person');
  });

  it('merges properties over the stored bag by default', async () => {
    const { service, nodes } = setup({ nodes: [storedNode()] });

    await service.createOrUpdateNode(OWNER, { entityId: NODE, properties: { occupation: 'dentist' } });

    expect(nodes.get(NODE)?.properties).toEqual({
      emails: ['alex@example.com'],
      planner: { trust_mode: 'ask' },
      occupation: 'dentist',
    });
  });

  it('replaces the bag when mergeProperties is false and properties are sent', async () => {
    const { service, nodes } = setup({ nodes: [storedNode()] });

    await service.createOrUpdateNode(OWNER, {
      entityId: NODE,
      properties: { occupation: 'dentist' },
      mergeProperties: false,
    });

    expect(nodes.get(NODE)?.properties).toEqual({ occupation: 'dentist' });
  });

  it('never empties the bag on mergeProperties: false alone — there is nothing to replace it with', async () => {
    const { service, nodes } = setup({ nodes: [storedNode()] });

    await service.createOrUpdateNode(OWNER, { entityId: NODE, name: 'Alex R.', mergeProperties: false });

    expect(nodes.get(NODE)?.properties).toEqual(storedNode().properties);
  });

  it('deletes removeProperties keys after merging, and on their own', async () => {
    const merged = setup({ nodes: [storedNode()] });
    await merged.service.createOrUpdateNode(OWNER, {
      entityId: NODE,
      properties: { occupation: 'dentist' },
      removeProperties: ['planner'],
    });
    expect(merged.nodes.get(NODE)?.properties).toEqual({
      emails: ['alex@example.com'],
      occupation: 'dentist',
    });

    const removalOnly = setup({ nodes: [storedNode()] });
    await removalOnly.service.createOrUpdateNode(OWNER, { entityId: NODE, removeProperties: ['emails'] });
    expect(removalOnly.nodes.get(NODE)?.properties).toEqual({ planner: { trust_mode: 'ask' } });
  });

  it('reports the write as an update of the same row', async () => {
    const { service, nodes } = setup({ nodes: [storedNode()] });

    const { node, created } = await service.createOrUpdateNode(OWNER, {
      entityId: NODE,
      entityType: 'Person',
    });

    expect(created).toBe(false);
    expect(node.entity_id).toBe(NODE);
    expect(nodes.all()).toHaveLength(1);
  });
});

describe('GraphUtilityService.createOrUpdateNode — inserting a new row', () => {
  it('defaults an omitted field exactly as it would a null one', async () => {
    const omitted = setup();
    const { node: fromUndefined } = await omitted.service.createOrUpdateNode(OWNER, {
      entityId: NODE,
      entityType: 'Concept',
      name: 'Pilates',
    });

    const nulled = setup();
    const { node: fromNull } = await nulled.service.createOrUpdateNode(OWNER, {
      entityId: NODE,
      entityType: 'Concept',
      name: 'Pilates',
      description: null,
      searchContent: null,
      linkedTable: null,
      linkedId: null,
    });

    expect(fromUndefined).toEqual(fromNull);
    expect(fromUndefined).toMatchObject({
      entity_type: 'Concept',
      name: 'Pilates',
      description: 'Pilates',
      search_content: 'Pilates',
      properties: {},
      linked_table: null,
      linked_id: null,
      is_active: true,
    });
  });

  it('still requires a type', async () => {
    const { service } = setup();

    await expect(service.createOrUpdateNode(OWNER, { entityId: NODE, name: 'Nameless' })).rejects.toThrow(
      'entityType is required',
    );
  });
});

describe('GraphUtilityService.createOrUpdateRelationship', () => {
  it('keeps the stored strength, direction and properties a write leaves undefined', async () => {
    const { service, edges } = setup({ edges: [storedEdge()] });

    await service.createOrUpdateRelationship(OWNER, {
      relationshipId: EDGE,
      fromEntityId: 'from-1',
      toEntityId: 'to-1',
      relationshipType: 'KNOWS',
    });

    expect(edges.get(EDGE)).toMatchObject({
      strength: 0.4,
      is_bidirectional: true,
      properties: { since: '2019', source: 'google-contacts' },
    });
  });

  it('merges properties by default and deletes removeProperties keys afterwards', async () => {
    const { service, edges } = setup({ edges: [storedEdge()] });

    await service.createOrUpdateRelationship(OWNER, {
      relationshipId: EDGE,
      fromEntityId: 'from-1',
      toEntityId: 'to-1',
      relationshipType: 'KNOWS',
      properties: { context: 'dentist' },
      removeProperties: ['source'],
    });

    expect(edges.get(EDGE)?.properties).toEqual({ since: '2019', context: 'dentist' });
  });

  it('gives a new relationship the insert defaults for everything omitted', async () => {
    const { service, edges } = setup();

    await service.createOrUpdateRelationship(OWNER, {
      relationshipId: EDGE,
      fromEntityId: 'from-1',
      toEntityId: 'to-1',
      relationshipType: 'KNOWS',
    });

    expect(edges.get(EDGE)).toMatchObject({ strength: 1, is_bidirectional: false, properties: {} });
  });
});
