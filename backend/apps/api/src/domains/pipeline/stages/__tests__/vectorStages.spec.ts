import { ContentVectorStage } from '../index/vectorStages';

const USER = '00000000-0000-0000-0000-0000000000aa';

function makeStage(rows: Array<Record<string, unknown>>, failOnInsert = false) {
  const query = jest.fn(async (sql: string) => {
    if (/FROM ci\.content/i.test(sql)) {
      return rows;
    }

    if (failOnInsert && /INSERT INTO ci_search\.vectors/i.test(sql)) {
      throw new Error('vector column rejected');
    }

    return [];
  });
  const logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn() };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stage = new ContentVectorStage({ query } as any, logger as any);

  return { stage, query };
}

describe('VectorStageBase (via ContentVectorStage)', () => {
  it('writes a weighted tsvector per row and records done', async () => {
    const { stage, query } = makeStage([{ id: 'c1', title: 'Hello', text: 'World' }]);

    const results = await stage.run({ userId: USER }, ['c1']);

    expect(results.get('c1')).toEqual({ outcome: 'done' });
    const insert = query.mock.calls.find(([sql]) => /INSERT INTO ci_search\.vectors/i.test(sql as string));
    expect(insert).toBeDefined();
    const [sql, params] = insert as unknown as [string, unknown[]];
    // Same statement family as VectorService.upsert: conflict on the
    // (entity_type, entity_id) key, weighted setweight expression inline.
    expect(sql.replace(/\s+/g, ' ')).toContain('ON CONFLICT (entity_type, entity_id)');
    expect(params).toContain('content');
    expect(params).toContain('c1');
    expect(params[params.length - 1]).toBe(USER);
  });

  it('records skipped: empty for a row with no weighted texts, and writes nothing for it', async () => {
    const { stage, query } = makeStage([{ id: 'c1', title: null, text: null }]);

    const results = await stage.run({ userId: USER }, ['c1']);

    expect(results.get('c1')).toEqual({ outcome: 'skipped', reason: 'empty' });
    expect(query.mock.calls.some(([sql]) => /INSERT/i.test(sql as string))).toBe(false);
  });

  it('answers for an id whose row is gone rather than staying silent', async () => {
    const { stage } = makeStage([]);

    const results = await stage.run({ userId: USER }, ['ghost']);

    expect(results.get('ghost')).toEqual({ outcome: 'skipped', reason: 'source_row_missing' });
  });

  it('a write failure is per row, with the reason recorded, and does not abort the slice', async () => {
    const { stage } = makeStage(
      [
        { id: 'c1', title: 'One' },
        { id: 'c2', title: 'Two' },
      ],
      true,
    );

    const results = await stage.run({ userId: USER }, ['c1', 'c2']);

    expect(results.get('c1')).toMatchObject({ outcome: 'failed', reason: 'vector_write_failed' });
    expect(results.get('c2')).toMatchObject({ outcome: 'failed', reason: 'vector_write_failed' });
  });

  it('returns an empty map for an empty slice without touching the database', async () => {
    const { stage, query } = makeStage([]);

    const results = await stage.run({ userId: USER }, []);

    expect(results.size).toBe(0);
    expect(query).not.toHaveBeenCalled();
  });
});
