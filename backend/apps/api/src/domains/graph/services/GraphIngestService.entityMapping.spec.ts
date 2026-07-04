import { GraphIngestService, type GraphEntityInputDto } from './GraphIngestService';

const USER = '00000000-0000-0000-0000-0000000000aa';
const EXISTING_ID = '00000000-0000-0000-0000-0000000000d1';

/**
 * Coverage for the key → entityId mapping returned to the caller: every input
 * entity that upserts — freshly created OR resolved to an existing row — must
 * appear in `result.entities` with the ci.entities UUID it landed on, so the
 * importer can cache the mapping. Failed entities are reported in `errors` and
 * excluded from the mapping.
 */
function makeService(opts: { existingKeys?: string[]; failingKeys?: string[] } = {}) {
  const existingLinkedIds = new Set((opts.existingKeys ?? []).map((k) => GraphIngestService.linkedIdFor(k)));
  const failingLinkedIds = new Set((opts.failingKeys ?? []).map((k) => GraphIngestService.linkedIdFor(k)));

  const nodeSave = jest.fn((row) => Promise.resolve(row));
  const nodeRepository = {
    findOne: jest.fn(({ where }: { where: { linkedId: string } }) => {
      if (failingLinkedIds.has(where.linkedId)) {
        return Promise.reject(new Error('db unavailable'));
      }

      return Promise.resolve(existingLinkedIds.has(where.linkedId) ? { entityId: EXISTING_ID } : null);
    }),
    create: jest.fn((row) => row),
    save: nodeSave,
    manager: { query: jest.fn().mockResolvedValue([]) },
  };
  const relationshipRepository = { findOne: jest.fn(), create: jest.fn(), save: jest.fn() };
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

  return { service, nodeSave };
}

function entity(key: string): GraphEntityInputDto {
  return {
    key,
    entityType: 'Person',
    name: key,
    sourceSystem: 'apple_contacts',
    properties: null,
  };
}

describe('GraphIngestService entity key mapping', () => {
  it('maps every input key to its UUID, covering created and resolved-existing rows', async () => {
    const { service, nodeSave } = makeService({ existingKeys: ['ent:1'] });

    const result = await service.ingest(
      { userId: USER },
      { entities: [entity('ent:1'), entity('ent:2')], relationships: [] },
    );

    expect(result.entitiesProcessed).toBe(2);
    expect(result.errors).toEqual([]);

    // 'ent:2' was freshly created — its UUID is whatever the save persisted.
    expect(nodeSave).toHaveBeenCalledTimes(1);
    const createdId = nodeSave.mock.calls[0][0].entityId;
    expect(createdId).toBeTruthy();

    expect(result.entities).toEqual([
      { key: 'ent:1', entityId: EXISTING_ID },
      { key: 'ent:2', entityId: createdId },
    ]);
  });

  it('resolves an existing row to its stable UUID on re-ingest without a save', async () => {
    const { service, nodeSave } = makeService({ existingKeys: ['ent:1'] });

    const result = await service.ingest({ userId: USER }, { entities: [entity('ent:1')], relationships: [] });

    expect(nodeSave).not.toHaveBeenCalled();
    expect(result.entities).toEqual([{ key: 'ent:1', entityId: EXISTING_ID }]);
  });

  it('excludes failed entities from the mapping and reports them in errors', async () => {
    const { service } = makeService({ existingKeys: ['ent:1'], failingKeys: ['ent:bad'] });

    const result = await service.ingest(
      { userId: USER },
      { entities: [entity('ent:1'), entity('ent:bad')], relationships: [] },
    );

    expect(result.entitiesProcessed).toBe(1);
    expect(result.errors).toEqual(['entity ent:bad: db unavailable']);
    expect(result.entities).toEqual([{ key: 'ent:1', entityId: EXISTING_ID }]);
  });
});
