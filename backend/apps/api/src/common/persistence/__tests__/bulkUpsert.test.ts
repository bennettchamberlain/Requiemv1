import type { Repository } from 'typeorm';

import { bulkInsertIdempotent } from '../bulkUpsert';

/**
 * Minimal row used by the fake repository. Mirrors the shape the ingest services
 * pass: a primary key plus the provenance triple.
 */
interface Row {
  id: string;
  sourceType: string | null;
  sourceSystem: string | null;
  sourceId: string | null;
  userId: string;
  // Source-derived mutable fields the communications upsert refreshes on conflict.
  direction?: string;
  participantsMetadata?: Record<string, unknown>;
}

const tripleKey = (r: { sourceType: string | null; sourceSystem: string | null; sourceId: string | null }) =>
  `${r.sourceType ?? ''}|${r.sourceSystem ?? ''}|${r.sourceId ?? ''}`;

/**
 * A fake TypeORM repository backed by an in-memory table that enforces the partial
 * unique index on the (source_type, source_system, source_id) triple WHERE
 * source_id IS NOT NULL — enough to exercise the helper's pre-check, ON CONFLICT
 * DO NOTHING insert, hydration SELECT, and inserted-flag logic. Reads are scoped to
 * `userId` (mirroring the scope option) and triples are matched with NULL = NULL.
 */
function makeFakeRepository(initial: Row[] = []) {
  const table = new Map<string, Row>(); // id -> row
  for (const row of initial) {
    table.set(row.id, row);
  }

  const existsByTriple = (r: Row): Row | undefined => {
    if (r.sourceId == null) {
      return undefined; // outside the partial index — never deduped
    }

    for (const row of table.values()) {
      if (row.sourceId != null && tripleKey(row) === tripleKey(r) && row.userId === r.userId) {
        return row;
      }
    }

    return undefined;
  };

  // Tracks WHERE predicates a SelectQueryBuilder accumulated, then resolves them
  // against the table on getMany(). We only need triple-OR + userId scoping, so we
  // capture the raw triples/pks the helper asks for via the bound parameters.
  function makeSelectQB() {
    const params: Record<string, unknown> = {};
    let scopedUserId: string | undefined;
    const qb: Record<string, unknown> = {};

    qb.andWhere = (_sql: string, p?: Record<string, unknown>) => {
      Object.assign(params, p ?? {});
      // Capture the scope userId binding (scope_userId).
      if (p && 'scope_userId' in p) {
        scopedUserId = p.scope_userId as string;
      }

      return qb;
    };

    qb.orWhere = qb.andWhere;
    qb.where = qb.andWhere;

    qb.getMany = async (): Promise<Row[]> => {
      // Reconstruct the set of requested triples from the bound params (pre_/post_).
      const triples: { sourceType: string | null; sourceSystem: string | null; sourceId: string | null }[] =
        [];
      for (const key of Object.keys(params)) {
        const m = key.match(/^(pre|post)_type_(\d+)$/);
        if (m) {
          const i = m[2];
          const prefix = m[1];
          triples.push({
            sourceType: params[`${prefix}_type_${i}`] as string | null,
            sourceSystem: params[`${prefix}_system_${i}`] as string | null,
            sourceId: params[`${prefix}_id_${i}`] as string | null,
          });
        }
      }

      const pks = (params.bulk_pks as string[] | undefined) ?? [];

      const matched = new Map<string, Row>();
      for (const row of table.values()) {
        if (scopedUserId != null && row.userId !== scopedUserId) {
          continue;
        }

        const byTriple =
          row.sourceId != null && triples.some((t) => t.sourceId != null && tripleKey(t) === tripleKey(row));
        const byPk = pks.includes(row.id);
        if (byTriple || byPk) {
          matched.set(row.id, row);
        }
      }

      return [...matched.values()];
    };

    // Brackets passed to andWhere/orWhere are functions; invoke them so their inner
    // orWhere calls register params.
    const wrap =
      (fn: (sql: unknown, p?: Record<string, unknown>) => unknown) =>
      (sqlOrBrackets: unknown, p?: Record<string, unknown>) => {
        if (
          sqlOrBrackets &&
          typeof (sqlOrBrackets as { whereFactory?: unknown }).whereFactory === 'function'
        ) {
          (sqlOrBrackets as { whereFactory: (b: unknown) => void }).whereFactory(qb);

          return qb;
        }

        return fn(sqlOrBrackets as string, p);
      };

    qb.andWhere = wrap(qb.andWhere as never);
    qb.orWhere = qb.andWhere;
    qb.where = qb.andWhere;

    return qb;
  }

  // Source-derived columns the DO UPDATE path refreshes; the fake copies these
  // from the incoming (EXCLUDED) row onto the existing row to mimic
  // `SET col = EXCLUDED.col`. (The helper only emits these for the columns the
  // caller lists; the fake refreshing the superset is sufficient for the tests.)
  const REFRESHABLE: (keyof Row)[] = ['direction', 'participantsMetadata'];

  function makeInsertQB() {
    let values: Row[] = [];
    let conflictAction = '';
    const iqb: Record<string, unknown> = {};
    iqb.insert = () => iqb;
    iqb.into = () => iqb;
    iqb.values = (v: Row[]) => {
      values = v;

      return iqb;
    };

    iqb.onConflict = (action: string) => {
      conflictAction = action;

      return iqb;
    };

    iqb.returning = () => iqb;
    iqb.execute = async () => {
      const doUpdate = / DO UPDATE /i.test(conflictAction);
      // Mirror Postgres RETURNING (xmax = 0) AS bulk_inserted under DO UPDATE.
      const insertedRaw: { id: string; bulk_inserted?: boolean }[] = [];
      for (const row of values) {
        const existing = row.sourceId != null ? existsByTriple(row) : undefined;

        if (existing) {
          if (doUpdate) {
            // ON CONFLICT DO UPDATE SET col = EXCLUDED.col — refresh on existing.
            for (const col of REFRESHABLE) {
              if (col in row) {
                (existing as Record<keyof Row, unknown>)[col] = row[col];
              }
            }

            insertedRaw.push({ id: existing.id, bulk_inserted: false });
          }

          // DO NOTHING — skip entirely (no RETURNING row).
          continue;
        }

        // Genuine insert (also covers the intra-batch dup guard the unique index
        // would catch; the helper already collapses dups before this point).
        table.set(row.id, row);
        insertedRaw.push({ id: row.id, bulk_inserted: true });
      }

      return { raw: insertedRaw };
    };

    return iqb;
  }

  const repo = {
    metadata: {
      tableName: 'fake',
      target: 'fake',
      primaryColumns: [{ databaseName: 'id' }],
    },
    create: (x: Partial<Row>) => x as Row,
    createQueryBuilder: (alias?: string) => (alias ? makeSelectQB() : makeInsertQB()),
  };

  return { repo: repo as unknown as Repository<Row>, table };
}

const opts = (repo: Repository<Row>, entities: Row[], conflictUpdateColumns?: string[]) => ({
  repository: repo,
  entities,
  primaryKey: 'id' as const,
  getTriple: (e: Row) => ({
    sourceType: e.sourceType,
    sourceSystem: e.sourceSystem,
    sourceId: e.sourceId,
  }),
  scope: { userId: entities[0]?.userId ?? 'user-1' },
  conflictTarget: '(source_type, source_system, source_id) WHERE source_id IS NOT NULL',
  tripleColumns: ['source_type', 'source_system', 'source_id'] as [string, string, string],
  ...(conflictUpdateColumns ? { conflictUpdateColumns } : {}),
});

const row = (over: Partial<Row>): Row => ({
  id: over.id ?? crypto.randomUUID(),
  sourceType: 'ci-import',
  sourceSystem: 'gmail',
  sourceId: null,
  userId: 'user-1',
  ...over,
});

describe('bulkInsertIdempotent', () => {
  it('inserts all new rows and flags every one as inserted, in input order', async () => {
    const { repo, table } = makeFakeRepository();
    const entities = [
      row({ id: 'a', sourceId: 's1' }),
      row({ id: 'b', sourceId: 's2' }),
      row({ id: 'c', sourceId: 's3' }),
    ];

    const results = await bulkInsertIdempotent(opts(repo, entities));

    expect(results.map((r) => r.entity.id)).toEqual(['a', 'b', 'c']);
    expect(results.map((r) => r.inserted)).toEqual([true, true, true]);
    expect(table.size).toBe(3);
  });

  it('is idempotent on re-push: existing triples return the existing row, no re-insert, inserted=false', async () => {
    const existing = row({ id: 'existing', sourceId: 's1' });
    const { repo, table } = makeFakeRepository([existing]);

    const results = await bulkInsertIdempotent(
      opts(repo, [row({ id: 'new-attempt', sourceId: 's1' }), row({ id: 'b', sourceId: 's2' })]),
    );

    // First row dedupes to the pre-existing row (existing id, not inserted).
    expect(results[0].entity.id).toBe('existing');
    expect(results[0].inserted).toBe(false);
    // Second is genuinely new.
    expect(results[1].entity.id).toBe('b');
    expect(results[1].inserted).toBe(true);
    expect(table.size).toBe(2); // existing + b, no duplicate
  });

  it('collapses an intra-batch duplicate triple to one inserted row and flags it once', async () => {
    const { repo, table } = makeFakeRepository();
    const results = await bulkInsertIdempotent(
      opts(repo, [row({ id: 'first', sourceId: 'dup' }), row({ id: 'second', sourceId: 'dup' })]),
    );

    // Both inputs resolve to the single inserted DB row...
    expect(results[0].entity.id).toBe('first');
    expect(results[1].entity.id).toBe('first');
    // ...but only one is flagged inserted (single *CreatedEvent).
    expect(results.filter((r) => r.inserted)).toHaveLength(1);
    expect(table.size).toBe(1);
  });

  it('always inserts rows without a source_id (outside the partial index), never deduped', async () => {
    const { repo, table } = makeFakeRepository();
    const results = await bulkInsertIdempotent(
      opts(repo, [row({ id: 'n1', sourceId: null }), row({ id: 'n2', sourceId: null })]),
    );

    expect(results.map((r) => r.inserted)).toEqual([true, true]);
    expect(table.size).toBe(2);
  });

  it('treats a NULL source_system as equal to a NULL source_system (IS NOT DISTINCT FROM)', async () => {
    const existing = row({ id: 'existing', sourceSystem: null, sourceId: 's1' });
    const { repo } = makeFakeRepository([existing]);

    const results = await bulkInsertIdempotent(
      opts(repo, [row({ id: 'dupe', sourceSystem: null, sourceId: 's1' })]),
    );

    expect(results[0].entity.id).toBe('existing');
    expect(results[0].inserted).toBe(false);
  });

  it('returns [] for an empty batch without touching the repository', async () => {
    const { repo } = makeFakeRepository();
    await expect(bulkInsertIdempotent(opts(repo, []))).resolves.toEqual([]);
  });
});

describe('bulkInsertIdempotent — DO UPDATE (conflictUpdateColumns) self-heal path', () => {
  const REFRESH = ['direction', 'participants_metadata'];

  it('refreshes the listed columns on a re-insert of the same triple (direction + participants)', async () => {
    // A row imported before the direction fix: stored inbound, empty participants.
    const existing = row({
      id: 'existing',
      sourceId: 's1',
      direction: 'inbound',
      participantsMetadata: {},
    });
    const { repo, table } = makeFakeRepository([existing]);

    // Re-sync sends the corrected direction + populated recipients for that triple.
    const results = await bulkInsertIdempotent(
      opts(
        repo,
        [
          row({
            id: 'new-attempt',
            sourceId: 's1',
            direction: 'outbound',
            participantsMetadata: { to: ['alice@example.com'] },
          }),
        ],
        REFRESH,
      ),
    );

    // Idempotent: dedupes to the pre-existing row, no duplicate inserted.
    expect(results[0].entity.id).toBe('existing');
    expect(table.size).toBe(1);
    // ...but the mutable, source-derived fields are now corrected.
    expect(results[0].entity.direction).toBe('outbound');
    expect(results[0].entity.participantsMetadata).toEqual({ to: ['alice@example.com'] });
    expect(table.get('existing')?.direction).toBe('outbound');
  });

  it('flags a refreshed (updated) row as inserted=false so NO new event fires', async () => {
    const existing = row({ id: 'existing', sourceId: 's1', direction: 'inbound' });
    const { repo } = makeFakeRepository([existing]);

    const results = await bulkInsertIdempotent(
      opts(repo, [row({ id: 'new-attempt', sourceId: 's1', direction: 'outbound' })], REFRESH),
    );

    // Updated, not inserted — caller must not emit a CommunicationCreatedEvent.
    expect(results[0].inserted).toBe(false);
  });

  it('flags a genuinely new row as inserted=true even on the DO UPDATE path', async () => {
    const { repo, table } = makeFakeRepository();

    const results = await bulkInsertIdempotent(
      opts(repo, [row({ id: 'fresh', sourceId: 's-new', direction: 'outbound' })], REFRESH),
    );

    expect(results[0].entity.id).toBe('fresh');
    expect(results[0].inserted).toBe(true);
    expect(table.size).toBe(1);
  });

  it('collapses an intra-batch duplicate triple to one row under DO UPDATE (no 21000, single insert flag)', async () => {
    // Postgres rejects affecting the same arbiter row twice in one DO UPDATE; the
    // helper must collapse the dup before the INSERT. Both inputs resolve to one
    // row, flagged inserted exactly once.
    const { repo, table } = makeFakeRepository();
    const results = await bulkInsertIdempotent(
      opts(
        repo,
        [
          row({ id: 'first', sourceId: 'dup', direction: 'inbound' }),
          row({ id: 'second', sourceId: 'dup', direction: 'outbound' }),
        ],
        REFRESH,
      ),
    );

    expect(results[0].entity.id).toBe('first');
    expect(results[1].entity.id).toBe('first');
    expect(results.filter((r) => r.inserted)).toHaveLength(1);
    expect(table.size).toBe(1);
  });

  it('keeps DO NOTHING callers unchanged: no conflictUpdateColumns means existing rows are never refreshed', async () => {
    const existing = row({ id: 'existing', sourceId: 's1', direction: 'inbound' });
    const { repo, table } = makeFakeRepository([existing]);

    // Same triple, corrected direction, but NO conflictUpdateColumns (Item/Event path).
    const results = await bulkInsertIdempotent(
      opts(repo, [row({ id: 'new-attempt', sourceId: 's1', direction: 'outbound' })]),
    );

    expect(results[0].entity.id).toBe('existing');
    expect(results[0].inserted).toBe(false);
    // Untouched — the legacy find-or-return path must not refresh.
    expect(results[0].entity.direction).toBe('inbound');
    expect(table.get('existing')?.direction).toBe('inbound');
    expect(table.size).toBe(1);
  });
});
