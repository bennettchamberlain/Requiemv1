import { ForbiddenException } from '@nestjs/common';

import { IngestResetService } from '../IngestResetService';

/**
 * The reset TRUNCATES — it cannot take one account's rows and leave another's —
 * and it sits behind ordinary user auth, because this appliance has no admin
 * role. So any signed-in caller who knew the confirm literal could delete every
 * other account's imported memory in one request, and the literal proves only
 * that they meant it, not that it was theirs to mean.
 *
 * The guard is therefore about WHOSE data is in range, and these specs pin both
 * halves: it runs on the personal appliance it was written for, and it refuses
 * where it would take somebody else's rows with it.
 */

const stubLogger = () =>
  ({ setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), debug: jest.fn() }) as never;

const CALLER = '00000000-0000-0000-0000-0000000000aa';

/**
 * A DataSource whose EXISTS probes answer from `foreign`, and whose transaction
 * body runs against a manager that counts everything as empty.
 */
function build(foreign: string[] = []) {
  const queries: string[] = [];

  const manager = {
    query: jest.fn(async (sql: string) => {
      queries.push(sql);

      if (sql.startsWith('SELECT count(*)')) {
        return [{ count: '0' }];
      }

      return [[], 0];
    }),
  };

  const dataSource = {
    query: jest.fn<Promise<Array<{ present: boolean }>>, [string, unknown[]?]>(async (sql: string) => {
      const table = /FROM "(\w+)"\."(\w+)"/.exec(sql);

      if (table == null) {
        return [{ present: false }];
      }

      return [{ present: foreign.includes(`${table[1]}.${table[2]}`) }];
    }),
    transaction: jest.fn(async (body: (m: unknown) => Promise<unknown>) => body(manager)),
  };

  return { service: new IngestResetService(dataSource as never, stubLogger()), dataSource, manager };
}

describe('IngestResetService', () => {
  it('resets when the caller is the only person with data — the personal appliance', async () => {
    const { service, manager } = build();

    const result = await service.reset({ userId: CALLER });

    expect(result.truncated).toEqual(
      expect.arrayContaining(['ci.events', 'ci.communications', 'ci_search.embeddings']),
    );
    expect(manager.query).toHaveBeenCalledWith(expect.stringContaining('TRUNCATE TABLE'));
  });

  it('refuses, and truncates nothing, when another account still holds rows', async () => {
    const { service, manager } = build(['ci.events']);

    await expect(service.reset({ userId: CALLER })).rejects.toBeInstanceOf(ForbiddenException);

    // Not "refused after the fact": nothing ran at all.
    expect(manager.query).not.toHaveBeenCalled();
  });

  it('names the tables that stopped it, so the refusal is actionable', async () => {
    const { service } = build(['ci.communications', 'ci_search.vectors']);

    await expect(service.reset({ userId: CALLER })).rejects.toThrow(/ci\.communications, ci_search\.vectors/);
  });

  it('checks the search index too, not only the ingest destinations', async () => {
    // The reset truncates the whole ci_search index, so another account's
    // embeddings go with it even when the ingest tables are all this caller's.
    const { service } = build(['ci_search.embeddings']);

    await expect(service.reset({ userId: CALLER })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('scopes every probe to the caller', async () => {
    const { service, dataSource } = build();

    await service.reset({ userId: CALLER });

    for (const call of dataSource.query.mock.calls) {
      expect(call[0]).toContain('user_id <> $1::uuid');
      expect(call[1]).toEqual([CALLER]);
    }
  });
});
