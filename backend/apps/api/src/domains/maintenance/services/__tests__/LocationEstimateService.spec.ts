import { ESTIMATED_CONFIDENCE, LocationEstimateService } from '../LocationEstimateService';

function makeLogger() {
  return { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn() };
}

function makeService(queryImpl: (...args: unknown[]) => Promise<unknown>) {
  const dataSource = { query: jest.fn(queryImpl) };
  const service = new LocationEstimateService(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    dataSource as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    makeLogger() as any,
  );

  return { service, dataSource };
}

const USER = '00000000-0000-0000-0000-0000000000aa';

describe('LocationEstimateService.countCandidates', () => {
  it('counts coordinate-less, non-estimated, physical-presence events for the user', async () => {
    const { service, dataSource } = makeService(async () => [{ count: '42' }]);

    const n = await service.countCandidates(USER, ['calendar', 'uber']);

    expect(n).toBe(42);
    const [sql, params] = dataSource.query.mock.calls[0];
    expect(sql).toContain('location_coordinates IS NULL');
    expect(sql).toContain('source_system = ANY($2)');
    expect(sql).toContain('is_deleted = false');
    expect(sql).toContain("<> 'estimated'");
    expect(params).toEqual([USER, ['calendar', 'uber']]);
  });
});

describe('LocationEstimateService.estimateBatch', () => {
  it('short-circuits (no UPDATE) when there are no candidates', async () => {
    const { service, dataSource } = makeService(async () => [{ count: '0' }]);

    const res = await service.estimateBatch(USER, {
      limit: 100,
      maxGapHours: 24,
      sourceSystems: ['calendar'],
    });

    expect(res).toEqual({ candidates: 0, estimated: 0 });
    expect(dataSource.query).toHaveBeenCalledTimes(1); // count only — no UPDATE issued
  });

  it('runs the bounded temporal-NN UPDATE and reports rows actually filled', async () => {
    let call = 0;
    const { service, dataSource } = makeService(async () => {
      call += 1;
      if (call === 1) {
        return [{ count: '5' }];
      } // countCandidates

      return [{ event_id: 'a' }, { event_id: 'b' }]; // UPDATE ... RETURNING
    });

    const res = await service.estimateBatch(USER, {
      limit: 100,
      maxGapHours: 24,
      sourceSystems: ['calendar', 'uber'],
    });

    expect(res).toEqual({ candidates: 5, estimated: 2 });

    const [sql, params] = dataSource.query.mock.calls[1] as [string, unknown[]];
    // params: [userId, sourceSystems, limit, maxGapSeconds, ESTIMATED_CONFIDENCE, maxGapHours]
    expect(params[0]).toBe(USER);
    expect(params[1]).toEqual(['calendar', 'uber']);
    expect(params[2]).toBe(100);
    expect(params[3]).toBe(24 * 3600);
    expect(params[4]).toBe(ESTIMATED_CONFIDENCE);
    expect(params[5]).toBe(24);

    // Safety invariants encoded in the SQL.
    expect(sql).toContain('location_coordinates IS NULL'); // never overwrite real coords
    expect(sql).toContain("|| jsonb_build_object('location_source', 'estimated')");
    expect(sql).toContain('is_inferred = true');
    expect(sql).toContain("'position'"); // prefers GPS donor
    expect(sql).toContain("(donor <> 'position')"); // position wins ties
  });

  it('converts a fractional maxGapHours to whole seconds', async () => {
    let call = 0;
    const { service, dataSource } = makeService(async () => (++call === 1 ? [{ count: '1' }] : []));

    await service.estimateBatch(USER, { limit: 10, maxGapHours: 1.5, sourceSystems: ['calendar'] });

    const params = dataSource.query.mock.calls[1][1] as unknown[];
    expect(params[3]).toBe(5400); // 1.5h -> 5400s
  });
});
