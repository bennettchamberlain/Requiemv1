import fs from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import config from '@ci/configuration';

import { DatabaseVolumeFullError, isOutOfDiskError, readDatabaseSpace } from '../databaseSpace';

/**
 * The half of an import's disk budget nothing measured.
 *
 * `archive/unpack` has preflighted free space since it existed — on the SCRATCH
 * filesystem, where the extracted tree goes. The records themselves land in
 * Postgres, on a separate and much smaller volume, and a 2.7GB Takeout filled a
 * 96GB VM during the PUSH. Because the write failed underneath the container
 * runtime, what surfaced was an OCI error; nothing the import said mentioned
 * disk at all.
 */

let previousDataDir: string;

beforeEach(() => {
  previousDataDir = config.import.databaseDataDir;
});

afterEach(() => {
  (config.import as { databaseDataDir: string }).databaseDataDir = previousDataDir;
});

/** A manager answering the two statements `readDatabaseSpace` issues. */
function manager(overrides: { bytes?: string; dataDirectory?: string | null; throws?: boolean } = {}) {
  return {
    query: jest.fn(async (sql: string) => {
      if (overrides.throws) {
        throw new Error('connection terminated');
      }

      if (sql.includes('pg_database_size')) {
        return [{ bytes: overrides.bytes ?? '1234' }];
      }

      return overrides.dataDirectory == null ? [] : [{ data_directory: overrides.dataDirectory }];
    }),
  };
}

describe('readDatabaseSpace', () => {
  it('reads the size and the free space of the volume Postgres itself names', async () => {
    // `SHOW data_directory` is right with no configuration at all whenever the
    // api and the database share a filesystem namespace.
    const dir = await mkdtemp(path.join(os.tmpdir(), 'ci-dbspace-'));
    const space = await readDatabaseSpace(manager({ bytes: '9000', dataDirectory: dir }) as never);

    expect(space.databaseBytes).toBe(9000);
    expect(space.dataDir).toBe(dir);
    expect(space.freeBytes).toBeGreaterThan(0);
  });

  it('prefers the configured mount, which is how a containerized api sees the same volume', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'ci-dbspace-mount-'));

    (config.import as { databaseDataDir: string }).databaseDataDir = dir;

    const space = await readDatabaseSpace(
      manager({ dataDirectory: '/var/lib/postgresql/data-not-visible-here' }) as never,
    );

    expect(space.dataDir).toBe(dir);
  });

  it('says "cannot tell" rather than "full" when the volume is not visible', async () => {
    // The shipped topology: separate containers, no shared mount. Reporting
    // this as no-space would refuse every import on every appliance.
    const space = await readDatabaseSpace(
      manager({ dataDirectory: '/var/lib/postgresql/data-not-visible-here' }) as never,
    );

    expect(space.freeBytes).toBeNull();
    expect(space.dataDir).toBeNull();
  });

  it('never throws — a broken probe must not be what fails a running import', async () => {
    const space = await readDatabaseSpace(manager({ throws: true }) as never);

    expect(space).toEqual({ databaseBytes: 0, freeBytes: null, dataDir: null });
  });
});

describe('isOutOfDiskError', () => {
  it('recognizes SQLSTATE 53100 at either level the driver reports it', () => {
    expect(isOutOfDiskError({ code: '53100' })).toBe(true);
    expect(isOutOfDiskError({ driverError: { code: '53100' } })).toBe(true);
  });

  it('recognizes a bare ENOSPC and the message Postgres writes', () => {
    expect(isOutOfDiskError({ code: 'ENOSPC' })).toBe(true);
    expect(
      isOutOfDiskError(new Error('could not extend file "base/16384/2619": No space left on device')),
    ).toBe(true);
  });

  it('does not mistake an ordinary failure for a full disk', () => {
    expect(isOutOfDiskError({ code: '23505' })).toBe(false);
    expect(isOutOfDiskError(new Error('null value in column "user_id"'))).toBe(false);
    expect(isOutOfDiskError(undefined)).toBe(false);
  });
});

describe('DatabaseVolumeFullError', () => {
  it('names the volume and says what survived, because the OCI error said neither', () => {
    const error = new DatabaseVolumeFullError({
      databaseBytes: 94_000_000_000,
      freeBytes: 100_000_000,
      dataDir: '/var/lib/postgresql/data',
    });

    expect(error.message).toContain('/var/lib/postgresql/data');
    expect(error.message).toContain('0.1GB free');
    expect(error.message).toContain('94.0GB');
    expect(error.message).toMatch(/Nothing already saved was lost/);
  });

  it('reads sensibly when the free space could not be measured', () => {
    const error = new DatabaseVolumeFullError({ databaseBytes: 0, freeBytes: null, dataDir: null });

    expect(error.message).toContain('unknown free');
  });
});

describe('statfs availability', () => {
  it('is present on this platform, or the whole probe is inert', () => {
    // Guarding the guard: `fs.statfsSync` arrived in Node 18.15/19.6, and its
    // absence would make every reading null rather than loudly wrong.
    expect(typeof fs.statfsSync).toBe('function');
  });
});
