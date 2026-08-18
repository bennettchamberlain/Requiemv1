import { Brackets } from 'typeorm';

import { SYSTEM_USER, type ServiceContext } from '@ci/common/context';

import type { Delta, DeltaEntity } from '../entities/DeltaEntity';

import { DeltaService } from './DeltaService';

const OWNER = 'user-owner';
const OTHER = 'user-other';

const OWN_CONTEXT = { userId: OWNER } as ServiceContext;
const OTHER_CONTEXT = { userId: OTHER } as ServiceContext;
const SYSTEM_CONTEXT = { userId: SYSTEM_USER } as ServiceContext;

function makeRow(overrides: Partial<DeltaEntity> = {}): DeltaEntity {
  return {
    deltaId: 'delta-1',
    entityId: null,
    relationshipId: null,
    nodeType: 'entity',
    entityType: 'Person',
    relationshipType: null,
    fromEntityId: null,
    toEntityId: null,
    changeType: 'updated',
    changedFields: {},
    changeSource: 'test',
    changeReason: null,
    summaryId: null,
    changedAt: new Date('2026-08-10T00:00:00Z'),
    changedByUserId: OWNER,
    ownerUserId: OWNER,
    ...overrides,
  } as DeltaEntity;
}

/**
 * A single-row predicate for the closed set of WHERE fragments DeltaService
 * actually emits. Real filtering (not just "was this string passed") is what
 * lets these tests catch a scoping regression instead of a call-shape one:
 * a guard that references the wrong param, or checks the wrong field, still
 * "gets called" but would fail these assertions.
 */
function matches(row: DeltaEntity, fragment: string, params?: Record<string, unknown>): boolean {
  const isNull = fragment.match(/^delta\.(\w+) IS NULL$/);

  if (isNull) {
    return (row as unknown as Record<string, unknown>)[isNull[1]] == null;
  }

  const cmp = fragment.match(/^delta\.(\w+) (=|>=|<=) :(\w+)$/);

  if (!cmp) {
    throw new Error(`DeltaService.spec query-builder mock: unhandled fragment "${fragment}"`);
  }

  const [, field, op, paramName] = cmp;
  const expected = params?.[paramName];
  const actual = (row as unknown as Record<string, unknown>)[field];

  if (op === '=') {return actual === expected;}

  if (op === '>=') {return (actual as Date) >= (expected as Date);}

  if (op === '<=') {return (actual as Date) <= (expected as Date);}

  return false;
}

interface FakeQueryBuilder {
  where: jest.Mock;
  andWhere: jest.Mock;
  orderBy: jest.Mock;
  take: jest.Mock;
  getMany: jest.Mock;
  getCount: jest.Mock;
}

/**
 * Fakes just enough of TypeORM's QueryBuilder to run DeltaService's actual
 * clauses (including the Brackets OR-group in findEvolutionForEntity)
 * against an in-memory row set, so assertions exercise real filtering
 * behavior rather than call-shape alone.
 */
function makeQueryBuilder(rows: DeltaEntity[]): FakeQueryBuilder {
  let filtered = [...rows];
  let orderDir: 'ASC' | 'DESC' | null = null;
  let limit: number | undefined;

  const applyFragment = (fragment: string, params?: Record<string, unknown>) => {
    filtered = filtered.filter((row) => matches(row, fragment, params));
  };

  const applyBrackets = (brackets: Brackets) => {
    const orClauses: Array<{ fragment: string; params?: Record<string, unknown> }> = [];
    const subBuilder = {
      where: (fragment: string, params?: Record<string, unknown>) => {
        orClauses.push({ fragment, params });

        return subBuilder;
      },
      orWhere: (fragment: string, params?: Record<string, unknown>) => {
        orClauses.push({ fragment, params });

        return subBuilder;
      },
    };

    (brackets as unknown as { whereFactory: (qb: unknown) => void }).whereFactory(subBuilder);

    filtered = filtered.filter((row) => orClauses.some((clause) => matches(row, clause.fragment, clause.params)));
  };

  const applyWhere = (fragmentOrBrackets: string | Brackets, params?: Record<string, unknown>): FakeQueryBuilder => {
    if (fragmentOrBrackets instanceof Brackets) {
      applyBrackets(fragmentOrBrackets);
    } else {
      applyFragment(fragmentOrBrackets, params);
    }

    return qb;
  };

  // A named return type (rather than `typeof qb`) on every method breaks what
  // would otherwise be a self-referential type-inference cycle: each method
  // returns `qb` for chaining, and `qb`'s own type would need to already be
  // known to type-check that return.
  const qb: FakeQueryBuilder = {
    where: jest.fn(applyWhere),
    andWhere: jest.fn(applyWhere),
    orderBy: jest.fn((_field: string, dir: 'ASC' | 'DESC'): FakeQueryBuilder => {
      orderDir = dir;

      return qb;
    }),
    take: jest.fn((n: number): FakeQueryBuilder => {
      limit = n;

      return qb;
    }),
    getMany: jest.fn(async () => {
      let result = [...filtered];

      if (orderDir) {
        result = result.sort((a, b) => {
          const cmp = a.changedAt.getTime() - b.changedAt.getTime();

          return orderDir === 'DESC' ? -cmp : cmp;
        });
      }

      return typeof limit === 'number' ? result.slice(0, limit) : result;
    }),
    getCount: jest.fn(async () => filtered.length),
  };

  return qb;
}

function makeService(rows: DeltaEntity[] = []) {
  const store = [...rows];

  const findOne = jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
    return (
      store.find((row) =>
        Object.entries(where).every(([key, value]) => (row as unknown as Record<string, unknown>)[key] === value),
      ) ?? null
    );
  });

  const find = jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
    const deltaIdFilter = where.deltaId as { _type?: string; _value?: string[] } | string[] | undefined;
    // TypeORM's `In(ids)` operator — recover the id list without depending on
    // its internal shape any more than necessary.
    const ids: string[] = Array.isArray(deltaIdFilter)
      ? deltaIdFilter
      : ((deltaIdFilter as { value?: string[] })?.value ?? []);

    return store.filter((row) => {
      if (!ids.includes(row.deltaId)) {return false;}

      return Object.entries(where)
        .filter(([key]) => key !== 'deltaId')
        .every(([key, value]) => (row as unknown as Record<string, unknown>)[key] === value);
    });
  });

  const update = jest.fn(async (whereClause: Record<string, unknown>, patch: Record<string, unknown>) => {
    const deltaIdFilter = whereClause.deltaId as { value?: string[] } | string[];
    const ids: string[] = Array.isArray(deltaIdFilter) ? deltaIdFilter : (deltaIdFilter?.value ?? []);

    let affected = 0;

    for (const row of store) {
      if (!ids.includes(row.deltaId)) {continue;}

      const scopeOk = Object.entries(whereClause)
        .filter(([key]) => key !== 'deltaId')
        .every(([key, value]) => (row as unknown as Record<string, unknown>)[key] === value);

      if (!scopeOk) {continue;}

      Object.assign(row, patch);
      affected += 1;
    }

    return { affected };
  });

  const create = jest.fn((data: Record<string, unknown>) => data);
  const save = jest.fn(async (record: Record<string, unknown>) => {
    const row = makeRow(record as Partial<DeltaEntity>);
    store.push(row);

    return row;
  });

  let lastQb: ReturnType<typeof makeQueryBuilder> | undefined;
  const createQueryBuilder = jest.fn(() => {
    lastQb = makeQueryBuilder(store);

    return lastQb;
  });

  const repository = { findOne, find, update, create, save, createQueryBuilder };
  const logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn() };

  const service = new DeltaService(repository as never, logger as never);

  return { service, repository, store, getLastQb: () => lastQb };
}

describe('DeltaService — tenancy scoping', () => {
  describe('findById', () => {
    it('returns the record to its owner', async () => {
      const { service } = makeService([makeRow({ deltaId: 'd1', ownerUserId: OWNER })]);

      const result = await service.findById(OWN_CONTEXT, 'd1');

      expect(result?.deltaId).toBe('d1');
    });

    it('rejects a different user requesting the same delta id', async () => {
      const { service } = makeService([makeRow({ deltaId: 'd1', ownerUserId: OWNER })]);

      const result = await service.findById(OTHER_CONTEXT, 'd1');

      expect(result).toBeNull();
    });

    it('lets SYSTEM_USER read across owners', async () => {
      const { service } = makeService([makeRow({ deltaId: 'd1', ownerUserId: OWNER })]);

      const result = await service.findById(SYSTEM_CONTEXT, 'd1');

      expect(result?.deltaId).toBe('d1');
    });
  });

  describe('findByIds', () => {
    it('null-fills the slots of ids owned by someone else, keeping input order', async () => {
      const { service } = makeService([
        makeRow({ deltaId: 'mine', ownerUserId: OWNER }),
        makeRow({ deltaId: 'theirs', ownerUserId: OTHER }),
      ]);

      const result = await service.findByIds(OWN_CONTEXT, ['theirs', 'mine']);

      expect(result).toHaveLength(2);
      expect(result[0]).toBeNull();
      expect(result[1]?.deltaId).toBe('mine');
    });
  });

  describe('findDeltas', () => {
    it('excludes another owner\'s row for a non-system caller', async () => {
      const { service } = makeService([
        makeRow({ deltaId: 'mine', ownerUserId: OWNER }),
        makeRow({ deltaId: 'theirs', ownerUserId: OTHER }),
      ]);

      const result = await service.findDeltas(OWN_CONTEXT);

      expect(result.map((d) => d.deltaId)).toEqual(['mine']);
    });

    it('does not scope by owner for SYSTEM_USER', async () => {
      const { service } = makeService([
        makeRow({ deltaId: 'mine', ownerUserId: OWNER }),
        makeRow({ deltaId: 'theirs', ownerUserId: OTHER }),
      ]);

      const result = await service.findDeltas(SYSTEM_CONTEXT);

      expect(result.map((d) => d.deltaId).sort()).toEqual(['mine', 'theirs']);
    });

    it('combines owner scope with the caller\'s explicit filters (entityId + unsummarizedOnly)', async () => {
      const { service } = makeService([
        makeRow({ deltaId: 'a', ownerUserId: OWNER, entityId: 'e1', summaryId: null }),
        makeRow({ deltaId: 'b', ownerUserId: OWNER, entityId: 'e1', summaryId: 'sum-1' }),
        makeRow({ deltaId: 'c', ownerUserId: OWNER, entityId: 'e2', summaryId: null }),
        makeRow({ deltaId: 'd', ownerUserId: OTHER, entityId: 'e1', summaryId: null }),
      ]);

      const result = await service.findDeltas(OWN_CONTEXT, { entityId: 'e1', unsummarizedOnly: true });

      expect(result.map((d) => d.deltaId)).toEqual(['a']);
    });
  });

  describe('findEvolutionForEntity', () => {
    it('matches the entity as subject, source, or target (OR), still scoped to the owner', async () => {
      const { service } = makeService([
        makeRow({ deltaId: 'as-subject', ownerUserId: OWNER, entityId: 'e1' }),
        makeRow({ deltaId: 'as-from', ownerUserId: OWNER, fromEntityId: 'e1' }),
        makeRow({ deltaId: 'as-to', ownerUserId: OWNER, toEntityId: 'e1' }),
        makeRow({ deltaId: 'unrelated', ownerUserId: OWNER, entityId: 'e2' }),
        makeRow({ deltaId: 'someone-elses', ownerUserId: OTHER, entityId: 'e1' }),
      ]);

      const result = await service.findEvolutionForEntity(OWN_CONTEXT, 'e1');

      expect(result.map((d) => d.deltaId).sort()).toEqual(['as-from', 'as-subject', 'as-to']);
    });

    it('rejects reading another owner\'s entity evolution entirely', async () => {
      const { service } = makeService([makeRow({ deltaId: 'theirs', ownerUserId: OTHER, entityId: 'e1' })]);

      const result = await service.findEvolutionForEntity(OWN_CONTEXT, 'e1');

      expect(result).toEqual([]);
    });
  });

  describe('markAsSummarized', () => {
    it('stamps only the ids owned by the caller and reports the true affected count', async () => {
      const { service, store } = makeService([
        makeRow({ deltaId: 'mine-1', ownerUserId: OWNER, summaryId: null }),
        makeRow({ deltaId: 'mine-2', ownerUserId: OWNER, summaryId: null }),
        makeRow({ deltaId: 'theirs', ownerUserId: OTHER, summaryId: null }),
      ]);

      const affected = await service.markAsSummarized(OWN_CONTEXT, {
        deltaIds: ['mine-1', 'mine-2', 'theirs'],
        summaryId: 'sum-9',
      });

      expect(affected).toBe(2);
      expect(store.find((r) => r.deltaId === 'theirs')?.summaryId).toBeNull();
      expect(store.find((r) => r.deltaId === 'mine-1')?.summaryId).toBe('sum-9');
    });

    it('lets SYSTEM_USER stamp across owners', async () => {
      const { service, store } = makeService([makeRow({ deltaId: 'theirs', ownerUserId: OTHER, summaryId: null })]);

      const affected = await service.markAsSummarized(SYSTEM_CONTEXT, {
        deltaIds: ['theirs'],
        summaryId: 'sum-9',
      });

      expect(affected).toBe(1);
      expect(store[0]?.summaryId).toBe('sum-9');
    });
  });

  describe('countUnsummarized', () => {
    it('counts only the caller\'s own unsummarized deltas', async () => {
      const { service } = makeService([
        makeRow({ deltaId: 'a', ownerUserId: OWNER, summaryId: null }),
        makeRow({ deltaId: 'b', ownerUserId: OWNER, summaryId: 'done' }),
        makeRow({ deltaId: 'c', ownerUserId: OTHER, summaryId: null }),
      ]);

      await expect(service.countUnsummarized(OWN_CONTEXT)).resolves.toBe(1);
      await expect(service.countUnsummarized(SYSTEM_CONTEXT)).resolves.toBe(2);
    });
  });
});

describe('DeltaService — create', () => {
  it('persists the record and maps it through the egress type', async () => {
    const { service, repository } = makeService();

    const dto = {
      entityId: 'e1',
      nodeType: 'entity' as const,
      changeType: 'created' as const,
      changedFields: { name: { old: undefined, new: 'Alice' } },
      ownerUserId: OWNER,
    };

    const result: Delta = await service.create(OWN_CONTEXT, dto);

    expect(repository.save).toHaveBeenCalledTimes(1);
    expect(result.entityId).toBe('e1');
    expect(result.ownerUserId).toBe(OWNER);
    expect(typeof result.deltaId).toBe('string');
    expect(result.deltaId.length).toBeGreaterThan(0);
  });
});
