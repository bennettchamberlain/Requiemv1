import { GraphIngestService } from './GraphIngestService';

const USER = '00000000-0000-0000-0000-0000000000aa';
const A = '00000000-0000-0000-0000-0000000000b1';
const B = '00000000-0000-0000-0000-0000000000b2';

/**
 * Coverage for the pre-resolved relationship endpoints added for
 * GraphEnrichmentService's family-edge path: a relationship may name its
 * endpoints by an existing graph node id (fromEntityId/toEntityId) instead of a
 * batch key, so an edge can be attached between two Person nodes the importer
 * already created without re-ingesting them.
 */
function makeService() {
  const relSave = jest.fn().mockResolvedValue(undefined);
  const nodeRepository = {
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    manager: { query: jest.fn().mockResolvedValue([]) },
  };
  const relationshipRepository = {
    // No existing edge -> a fresh insert path.
    findOne: jest.fn().mockResolvedValue(null),
    create: jest.fn((row) => row),
    save: relSave,
  };
  const entityIdentifierService = { upsertForEntity: jest.fn() };
  const logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn() };

  const service = new GraphIngestService(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    nodeRepository as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    relationshipRepository as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    entityIdentifierService as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    logger as any,
  );

  return { service, relSave };
}

describe('GraphIngestService pre-resolved relationship endpoints', () => {
  it('writes an edge between two existing nodes referenced by entity id, with no batch entities', async () => {
    const { service, relSave } = makeService();

    const result = await service.ingest(
      { userId: USER },
      {
        entities: [],
        relationships: [
          {
            fromKey: 'Liam',
            toKey: 'Sarah',
            type: 'SPOUSE',
            fromEntityId: A,
            fromEntityType: 'Person',
            toEntityId: B,
            toEntityType: 'Person',
          },
        ],
      },
    );

    expect(result.relationshipsProcessed).toBe(1);
    expect(result.errors).toEqual([]);

    const saved = relSave.mock.calls[0][0];
    expect(saved.fromNodeId).toBe(A);
    expect(saved.toNodeId).toBe(B);
    expect(saved.fromNodeType).toBe('Person');
    expect(saved.toNodeType).toBe('Person');
    expect(saved.type).toBe('SPOUSE');
  });
});
