import { EntityIdentifierService } from './EntityIdentifierService';

const OWNER = '00000000-0000-0000-0000-0000000000aa';
const ENTITY = '00000000-0000-0000-0000-0000000000bb';
const OTHER_ENTITY = '00000000-0000-0000-0000-0000000000cc';

interface Row {
  ownerUserId: string;
  entityId: string;
  kind: string;
  valueNormalized: string;
  rawValue?: string | null;
  label?: string | null;
  isPrimary?: boolean;
  source?: string | null;
  verifiedAt?: Date | null;
}

/**
 * An in-memory stand-in for `ci.entity_identifiers` keyed on the real unique
 * tuple (owner, kind, value_normalized), so first-writer-wins and the delete of
 * dropped rows are exercised rather than mocked away.
 */
function makeService(seed: Row[] = []) {
  const rows: Row[] = seed.map((row) => ({ ...row }));
  const deleted: unknown[] = [];

  const keyOf = (row: { kind: string; valueNormalized: string }) => `${row.kind}:${row.valueNormalized}`;

  const builder: Record<string, unknown> = {};
  builder.insert = () => builder;
  builder.into = () => builder;
  let pending: Row | null = null;
  builder.values = (row: Row) => {
    pending = row;

    return builder;
  };

  builder.orIgnore = () => builder;
  builder.execute = async () => {
    if (pending && !rows.some((row) => keyOf(row) === keyOf(pending!))) {
      // `verifiedAt` arrives as a `() => 'now()'` SQL fragment; store a date.
      rows.push({ ...pending, verifiedAt: new Date() });
    }

    pending = null;

    return { identifiers: [] };
  };

  const repository = {
    create: (row: Record<string, unknown>) => row,
    createQueryBuilder: () => builder,
    find: async ({ where }: { where: { ownerUserId: string; entityId: string } }) =>
      rows.filter((row) => row.ownerUserId === where.ownerUserId && row.entityId === where.entityId),
    findOne: async ({ where }: { where: { kind: string; valueNormalized: string } }) =>
      rows.find((row) => keyOf(row) === keyOf(where)) ?? null,
    update: async (where: { kind: string; valueNormalized: string }, patch: Record<string, unknown>) => {
      const row = rows.find((candidate) => keyOf(candidate) === keyOf(where));
      if (row) {
        Object.assign(row, patch);
      }

      return { affected: row ? 1 : 0 };
    },
    delete: async (keys: Array<{ kind: string; valueNormalized: string }>) => {
      deleted.push(...keys);
      for (const key of keys) {
        const index = rows.findIndex((row) => keyOf(row) === keyOf(key));
        if (index >= 0) {
          rows.splice(index, 1);
        }
      }

      return { affected: keys.length };
    },
    manager: { query: jest.fn() },
    metadata: { columns: { length: 5 } },
  };

  const logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn() };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = new EntityIdentifierService(repository as any, logger as any);

  return { service, rows, deleted };
}

describe('EntityIdentifierService.replaceForEntity', () => {
  it('adds new contact methods normalized, labelled, and user-verified', async () => {
    const { service, rows } = makeService();

    const { conflicts } = await service.replaceForEntity(
      OWNER,
      ENTITY,
      ['email', 'phone'],
      [
        { kind: 'email', value: '  Dana@Example.COM ', label: 'work' },
        { kind: 'phone', value: '+1 (415) 555-0100', label: 'mobile' },
      ],
    );

    expect(conflicts).toEqual([]);
    expect(rows).toEqual([
      expect.objectContaining({
        entityId: ENTITY,
        kind: 'email',
        valueNormalized: 'dana@example.com',
        rawValue: '  Dana@Example.COM ',
        label: 'work',
        isPrimary: true,
        source: 'user',
      }),
      expect.objectContaining({
        kind: 'phone',
        valueNormalized: '4155550100',
        label: 'mobile',
        isPrimary: true,
      }),
    ]);
  });

  it('deletes the rows of the reconciled kinds that are no longer listed', async () => {
    const { service, rows } = makeService([
      { ownerUserId: OWNER, entityId: ENTITY, kind: 'email', valueNormalized: 'old@example.com' },
      { ownerUserId: OWNER, entityId: ENTITY, kind: 'email', valueNormalized: 'keep@example.com' },
    ]);

    await service.replaceForEntity(OWNER, ENTITY, ['email'], [{ kind: 'email', value: 'keep@example.com' }]);

    expect(rows.map((row) => row.valueNormalized)).toEqual(['keep@example.com']);
  });

  it('leaves kinds outside the reconciled set alone', async () => {
    // The 'name' rows the duplicate detector relies on must survive an edit that
    // only touches emails.
    const { service, rows } = makeService([
      { ownerUserId: OWNER, entityId: ENTITY, kind: 'name', valueNormalized: 'dana smith' },
      { ownerUserId: OWNER, entityId: ENTITY, kind: 'phone', valueNormalized: '4155550100' },
    ]);

    await service.replaceForEntity(OWNER, ENTITY, ['email'], []);

    expect(rows.map((row) => row.kind).sort()).toEqual(['name', 'phone']);
  });

  it('reports a value claimed by another entity instead of stealing it', async () => {
    const { service, rows } = makeService([
      { ownerUserId: OWNER, entityId: OTHER_ENTITY, kind: 'email', valueNormalized: 'taken@example.com' },
    ]);

    const { conflicts } = await service.replaceForEntity(
      OWNER,
      ENTITY,
      ['email'],
      [{ kind: 'email', value: 'taken@example.com' }],
    );

    expect(conflicts).toEqual([{ kind: 'email', value: 'taken@example.com' }]);
    expect(rows[0]!.entityId).toBe(OTHER_ENTITY);
  });

  it('promotes an existing machine-asserted row to user-verified with the new label', async () => {
    const { service, rows } = makeService([
      {
        ownerUserId: OWNER,
        entityId: ENTITY,
        kind: 'email',
        valueNormalized: 'dana@example.com',
        label: null,
        source: 'import:google',
        verifiedAt: null,
      },
    ]);

    await service.replaceForEntity(
      OWNER,
      ENTITY,
      ['email'],
      [{ kind: 'email', value: 'dana@example.com', label: 'home' }],
    );

    expect(rows[0]).toEqual(expect.objectContaining({ label: 'home', source: 'user', isPrimary: true }));
    expect(rows[0]!.verifiedAt).toBeInstanceOf(Date);
  });

  it('marks exactly one primary per kind, defaulting to the first row', async () => {
    const { service, rows } = makeService();

    await service.replaceForEntity(
      OWNER,
      ENTITY,
      ['email'],
      [
        { kind: 'email', value: 'first@example.com' },
        { kind: 'email', value: 'second@example.com', isPrimary: true },
        { kind: 'email', value: 'third@example.com' },
      ],
    );

    expect(rows.map((row) => [row.valueNormalized, row.isPrimary])).toEqual([
      ['first@example.com', false],
      ['second@example.com', true],
      ['third@example.com', false],
    ]);
  });

  it('collapses values that normalize to the same identifier', async () => {
    const { service, rows } = makeService();

    await service.replaceForEntity(
      OWNER,
      ENTITY,
      ['email'],
      [
        { kind: 'email', value: 'Dana@Example.com' },
        { kind: 'email', value: 'dana@example.com' },
      ],
    );

    expect(rows).toHaveLength(1);
  });

  it('skips values that do not normalize to a usable identifier', async () => {
    const { service, rows } = makeService();

    await service.replaceForEntity(
      OWNER,
      ENTITY,
      ['email', 'phone'],
      [
        { kind: 'email', value: '   ' },
        { kind: 'phone', value: 'not-a-number' },
      ],
    );

    expect(rows).toEqual([]);
  });
});
