import { ExternalIdKindIntegrityService, VIOLATION_SAMPLE_LIMIT } from './ExternalIdKindIntegrityService';

type Rows = Record<string, unknown>[];

/**
 * Fake DataSource that routes on the shape of the SQL the service issues:
 * a GROUP BY over external_id_kind, an aggregate anti-join, and a sample
 * anti-join. Nothing here executes SQL — the queries themselves are exercised
 * against the real database by the integrity endpoint; what these tests pin is
 * the report the service composes and the SQL invariants that keep it from
 * crashing on a non-uuid external_id.
 */
function makeDataSource(responses: { counts: Rows; aggregate: Rows; sample: Rows }) {
  const seen: string[] = [];
  const query = jest.fn(async (sql: string) => {
    seen.push(sql);

    if (sql.includes('GROUP BY external_id_kind')) {
      return responses.counts;
    }

    if (sql.includes('COUNT(*)::bigint AS orphans')) {
      return responses.aggregate;
    }

    return responses.sample;
  });

  return { ds: { query } as never, seen };
}

function makeService(responses: { counts: Rows; aggregate: Rows; sample: Rows }) {
  const { ds, seen } = makeDataSource(responses);
  const logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const service = new ExternalIdKindIntegrityService(ds, logger as never);

  return { service, logger, seen };
}

describe('ExternalIdKindIntegrityService', () => {
  it('reports a clean corpus: counts per kind, zero violations, empty sample', async () => {
    // The figures measured on the appliance corpus while writing migration
    // 20260818235804.
    const { service, logger } = makeService({
      counts: [
        { kind: 'external_uri', count: '33499' },
        { kind: 'file', count: '11432' },
      ],
      aggregate: [{ orphans: '0', malformed: '0' }],
      sample: [],
    });

    await expect(service.check()).resolves.toMatchObject({
      counts: { file: 11432, externalUri: 33499, unclassified: 0 },
      orphanFileRows: 0,
      malformedFileRows: 0,
      sample: [],
    });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('counts rows with a non-null external_id and no kind as unclassified', async () => {
    const { service } = makeService({
      counts: [
        { kind: null, count: '7' },
        { kind: 'file', count: '2' },
      ],
      aggregate: [{ orphans: '0', malformed: '0' }],
      sample: [],
    });

    const report = await service.check();
    expect(report.counts).toEqual({ file: 2, externalUri: 0, unclassified: 7 });
  });

  it('flags the F22 mislabel: a source URI stamped file counts as orphaned AND malformed', async () => {
    const { service, logger } = makeService({
      counts: [{ kind: 'file', count: '3' }],
      aggregate: [{ orphans: '3', malformed: '3' }],
      sample: [
        {
          id: '0198f0a1-2b3c-7d4e-8f90-000000000001',
          external_id: 'audible:asin:B002V0QK4C',
          source_type: 'ci-import-tools',
          source_system: 'audible',
        },
      ],
    });

    const report = await service.check();
    expect(report.orphanFileRows).toBe(3);
    expect(report.malformedFileRows).toBe(3);
    expect(report.sample).toEqual([
      {
        id: '0198f0a1-2b3c-7d4e-8f90-000000000001',
        externalId: 'audible:asin:B002V0QK4C',
        sourceType: 'ci-import-tools',
        sourceSystem: 'audible',
      },
    ]);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('separates a dangling-but-uuid-shaped file id from a mislabelled one', async () => {
    // 5 orphans of which 2 are not even uuid-shaped: 2 are the mislabel
    // migration 20260818235804 repairs, 3 are file rows that were deleted.
    const { service } = makeService({
      counts: [{ kind: 'file', count: '100' }],
      aggregate: [{ orphans: '5', malformed: '2' }],
      sample: [],
    });

    const report = await service.check();
    expect(report.orphanFileRows).toBe(5);
    expect(report.malformedFileRows).toBe(2);
  });

  it('guards every ::uuid cast with the uuid shape test — a non-uuid external_id must not raise', async () => {
    // ci.content.external_id is TEXT and holds 'spotify:track:...' values. An
    // unguarded `external_id::uuid` turns this report into a 22P02 error, which
    // is precisely the population it exists to measure.
    const { service, seen } = makeService({
      counts: [],
      aggregate: [{ orphans: '0', malformed: '0' }],
      sample: [],
    });

    await service.check();

    const casting = seen.filter((sql) => sql.includes('::uuid'));
    expect(casting).toHaveLength(2);
    for (const sql of casting) {
      // The cast only ever appears inside a CASE whose WHEN is the shape test.
      // An `AND`-guarded cast is NOT good enough: Postgres may reorder AND
      // operands by cost and evaluate the cast first.
      expect(sql).toMatch(/CASE WHEN c\.external_id ~\* '\^\[0-9a-f][^']*' THEN c\.external_id::uuid END/);
      expect(sql).not.toMatch(/AND f\.id = c\.external_id::uuid/);
    }
  });

  it('bounds the sample so an appliance-wide regression cannot return a giant payload', async () => {
    const { service, seen } = makeService({
      counts: [],
      aggregate: [{ orphans: '40000', malformed: '40000' }],
      sample: [],
    });

    await service.check();
    expect(seen.some((sql) => sql.includes(`LIMIT ${VIOLATION_SAMPLE_LIMIT}`))).toBe(true);
  });

  it('tolerates an empty aggregate result rather than reporting NaN', async () => {
    const { service } = makeService({ counts: [], aggregate: [], sample: [] });

    await expect(service.check()).resolves.toMatchObject({
      counts: { file: 0, externalUri: 0, unclassified: 0 },
      orphanFileRows: 0,
      malformedFileRows: 0,
    });
  });
});
