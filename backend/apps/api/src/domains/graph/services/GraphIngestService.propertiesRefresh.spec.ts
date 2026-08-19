import {
  makeFakeNodeRepository,
  makeFakeRelationshipRepository,
} from './__testHelpers__/fakeGraphRepositories';
import { GraphIngestService, type GraphEntityInputDto } from './GraphIngestService';

const USER = '00000000-0000-0000-0000-0000000000aa';
const EXISTING_ID = '00000000-0000-0000-0000-0000000000d1';
const KEY = 'ent:7';
const SOURCE = 'importer';

/**
 * Coverage for the refresh half of the entity upsert: a source that learns
 * something new about a thing it already ingested must be able to say so.
 *
 * This path used to be ON CONFLICT DO NOTHING, which froze an entity's
 * name/properties at whatever the FIRST ingest said — so an importer entity
 * that accumulated a second price (the same burger bought again, at a different
 * amount) could never reach the graph. The refresh is deliberately conditional:
 * a resync is overwhelmingly rows that haven't changed, and rewriting those
 * would churn the table for nothing.
 */
function makeService(stored: Record<string, unknown>) {
  const seed = [
    {
      entityId: EXISTING_ID,
      entityType: 'Food',
      name: 'Burger',
      description: null,
      properties: stored,
      linkedTable: `import:${SOURCE}`,
      linkedId: GraphIngestService.linkedIdFor(KEY),
      userId: USER,
    },
  ];

  const node = makeFakeNodeRepository({ seed });
  const rel = makeFakeRelationshipRepository();

  const service = new GraphIngestService(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    node.repo as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rel.repo as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { upsertForEntities: jest.fn() } as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn() } as any,
    // The delta writer, doubled to match the repositories above: this suite runs
    // against fakes and asserts on what the upsert REFRESHES, not on what the
    // delta ledger records. It became a constructor argument when the
    // graph_delta triggers were dropped and the application took over the write.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { record: jest.fn(), recordMany: jest.fn() } as any,
  );

  return { service, node };
}

function entity(properties: Record<string, unknown>, name = 'Burger'): GraphEntityInputDto {
  return { key: KEY, entityType: 'Food', name, sourceSystem: SOURCE, properties };
}

describe('GraphIngestService entity property refresh', () => {
  it('carries a grown property list onto the existing row, keeping its id', async () => {
    const { service, node } = makeService({ 'Item Prices': ['10.19'] });

    const result = await service.ingest(
      { userId: USER },
      { entities: [entity({ 'Item Prices': ['10.19', '15.92'] })], relationships: [] },
    );

    expect(result.errors).toEqual([]);
    // Same row, not a second one — everything already pointing at it still does.
    expect(result.entities).toEqual([{ key: KEY, entityId: EXISTING_ID }]);
    expect(node.inserted).toHaveLength(0);
    expect(node.updated).toHaveLength(1);
    expect([...node.store.values()][0].properties).toEqual({ 'Item Prices': ['10.19', '15.92'] });
  });

  it('leaves an unchanged row untouched', async () => {
    const { service, node } = makeService({ 'Item Prices': ['10.19'], mentions: 3 });

    await service.ingest(
      { userId: USER },
      { entities: [entity({ 'Item Prices': ['10.19'], mentions: 3 })], relationships: [] },
    );

    expect(node.updated).toHaveLength(0);
    expect(node.inserted).toHaveLength(0);
  });

  it('does not treat a difference in property key ORDER as a change', async () => {
    // jsonb hands properties back in Postgres' key order, not the order the
    // source sent them; comparing raw JSON would call every row stale forever.
    const { service, node } = makeService({ b: 2, a: 1 });

    await service.ingest({ userId: USER }, { entities: [entity({ a: 1, b: 2 })], relationships: [] });

    expect(node.updated).toHaveLength(0);
  });

  it('refreshes a renamed entity', async () => {
    const { service, node } = makeService({ 'Item Prices': ['10.19'] });

    await service.ingest(
      { userId: USER },
      { entities: [entity({ 'Item Prices': ['10.19'] }, 'Cheeseburger')], relationships: [] },
    );

    expect(node.updated).toHaveLength(1);
    expect([...node.store.values()][0].name).toBe('Cheeseburger');
  });
});
