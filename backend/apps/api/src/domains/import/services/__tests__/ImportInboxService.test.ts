import { chmod, mkdtemp, mkdir, stat, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import config from '@ci/configuration';

import { ImportInboxService, MAX_INBOX_BATCH_UNITS } from '../ImportInboxService';

/**
 * The inbox walk and the batch starter.
 *
 * Recognition is mocked: which importer claims which tree is the parsers'
 * business (covered where the parsers are tested); what is under test here is
 * the UNIT algebra — a recognized directory is ONE unit, an unrecognized one
 * is organization to recurse into, symlinks are never followed, and caps
 * truncate rather than error.
 */

jest.mock('../../datasources/registry', () => ({
  dataSourcesRecognize: jest.fn(async () => []),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { dataSourcesRecognize } = require('../../datasources/registry') as {
  dataSourcesRecognize: jest.Mock;
};

/** Answer `confidence` for any path whose basename is in `names`. */
function recognizeByName(names: Record<string, number>): void {
  dataSourcesRecognize.mockImplementation(async (_ctx: unknown, entry: { filename: string }) => {
    const confidence = names[entry.filename];

    if (confidence == null) {
      return [];
    }

    return [
      {
        data_source: { name: 'mock_source', title: 'Mock Source' },
        recognition: { confidence },
      },
    ];
  });
}

const stubLogger = () =>
  ({ setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), debug: jest.fn() }) as never;

function build(overrides?: { startRun?: jest.Mock; findActiveByPaths?: jest.Mock }) {
  const startRun = overrides?.startRun ?? jest.fn(async () => ({ run: { id: 'run-1', label: 'x' } }));
  const findActiveByPaths = overrides?.findActiveByPaths ?? jest.fn(async () => []);
  const service = new ImportInboxService(
    { startRun } as never,
    { findActiveByPaths } as never,
    stubLogger(),
  );

  return { service, startRun, findActiveByPaths };
}

const ctx = { userId: '00000000-0000-0000-0000-000000000001' };

async function withInbox<T>(dir: string, run: () => Promise<T>): Promise<T> {
  const previous = config.import.inboxDir;

  (config.import as { inboxDir: string }).inboxDir = dir;

  try {
    return await run();
  } finally {
    (config.import as { inboxDir: string }).inboxDir = previous;
  }
}

async function freshInbox(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), 'ci-inbox-scan-'));
}

beforeEach(() => {
  dataSourcesRecognize.mockReset();
  dataSourcesRecognize.mockImplementation(async () => []);
});

describe('ImportInboxService.scan', () => {
  it('reports unavailable when the inbox cannot be read, empty when it merely is', async () => {
    const inbox = await freshInbox();
    const { service } = build();

    await withInbox(path.join(inbox, 'not-creatable-\0'), async () => {
      const scan = await service.scan(ctx);

      expect(scan.available).toBe(false);
      expect(scan.units).toEqual([]);
    });

    await withInbox(inbox, async () => {
      const scan = await service.scan(ctx);

      expect(scan).toMatchObject({ available: true, units: [], truncated: false });
    });
  });

  it('creates a missing inbox world-writable with the sticky bit, like /tmp', async () => {
    // The api container runs as root: without the chmod the folder lands on
    // the host root-owned 755 and the desktop user cannot move archives in —
    // which is the entire point of the folder.
    const parent = await freshInbox();
    const inbox = path.join(parent, 'inbox');
    const { service } = build();

    await withInbox(inbox, async () => {
      const scan = await service.scan(ctx);

      expect(scan.available).toBe(true);
    });

    expect((await stat(inbox)).mode & 0o7777).toBe(0o1777);
  });

  it('leaves an existing inbox mode alone — a tightened operator mode stays tightened', async () => {
    const inbox = await freshInbox();

    await chmod(inbox, 0o750);

    const { service } = build();

    await withInbox(inbox, async () => {
      await service.scan(ctx);
    });

    expect((await stat(inbox)).mode & 0o7777).toBe(0o750);
  });

  it('lists files as units wherever they sit, skipping junk and dotfiles', async () => {
    const inbox = await freshInbox();

    await writeFile(path.join(inbox, 'contacts.vcf'), 'BEGIN:VCARD');
    await mkdir(path.join(inbox, 'phone', 'old'), { recursive: true });
    await writeFile(path.join(inbox, 'phone', 'old', 'sms.xml'), '<smses/>');
    await writeFile(path.join(inbox, '.DS_Store'), 'junk');
    await writeFile(path.join(inbox, '.hidden'), 'junk');

    const { service } = build();

    await withInbox(inbox, async () => {
      const scan = await service.scan(ctx);

      expect(scan.units.map((unit) => unit.path)).toEqual(['contacts.vcf', 'phone/old/sms.xml']);
      expect(scan.units[0]).toMatchObject({ kind: 'file', fileCount: 1 });
    });
  });

  it('treats a recognized directory as ONE unit, whole subtree', async () => {
    const inbox = await freshInbox();

    await mkdir(path.join(inbox, 'takeout', 'Mail'), { recursive: true });
    await writeFile(path.join(inbox, 'takeout', 'Mail', 'a.mbox'), 'aaaa');
    await writeFile(path.join(inbox, 'takeout', 'Mail', 'b.mbox'), 'bb');

    recognizeByName({ takeout: 0.9 });

    const { service } = build();

    await withInbox(inbox, async () => {
      const scan = await service.scan(ctx);

      expect(scan.units).toHaveLength(1);
      expect(scan.units[0]).toMatchObject({
        path: 'takeout',
        kind: 'directory',
        fileCount: 2,
        sizeBytes: 6,
      });
      expect(scan.units[0].recognized[0]).toMatchObject({ dataSource: 'mock_source' });
    });
  });

  it('recurses into an unrecognized directory instead of importing it blind', async () => {
    const inbox = await freshInbox();

    await mkdir(path.join(inbox, 'stuff'), { recursive: true });
    await writeFile(path.join(inbox, 'stuff', 'export.zip'), 'zip');

    // Low confidence: organization, not an export.
    recognizeByName({ stuff: 0.2 });

    const { service } = build();

    await withInbox(inbox, async () => {
      const scan = await service.scan(ctx);

      expect(scan.units.map((unit) => unit.path)).toEqual(['stuff/export.zip']);
    });
  });

  it('never follows symlinks, and counts what it skipped', async () => {
    const inbox = await freshInbox();
    const outside = await mkdtemp(path.join(os.tmpdir(), 'ci-outside-'));

    await writeFile(path.join(outside, 'secret.zip'), 'secret');
    await symlink(path.join(outside, 'secret.zip'), path.join(inbox, 'link.zip'));
    await symlink(outside, path.join(inbox, 'linkdir'));
    await writeFile(path.join(inbox, 'real.zip'), 'real');

    const { service } = build();

    await withInbox(inbox, async () => {
      const scan = await service.scan(ctx);

      expect(scan.units.map((unit) => unit.path)).toEqual(['real.zip']);
      expect(scan.skippedSymlinks).toBe(2);
    });
  });

  it('marks units an unfinished run already claims', async () => {
    const inbox = await freshInbox();
    const file = path.join(inbox, 'export.zip');

    await writeFile(file, 'bytes');

    const { service } = build({
      findActiveByPaths: jest.fn(async () => [{ sourcePath: file, runId: 'run-9' }]),
    });

    await withInbox(inbox, async () => {
      const scan = await service.scan(ctx);

      expect(scan.units[0].activeRunId).toBe('run-9');
    });
  });

  it('truncates at the unit cap rather than erroring', async () => {
    const inbox = await freshInbox();

    // 501 files with a fixed-width suffix so lexicographic order is total.
    for (let index = 0; index < 501; index += 1) {
      await writeFile(path.join(inbox, `f${String(index).padStart(4, '0')}.csv`), 'x');
    }

    const { service } = build();

    await withInbox(inbox, async () => {
      const scan = await service.scan(ctx);

      expect(scan.units).toHaveLength(500);
      expect(scan.truncated).toBe(true);
    });
  });
});

describe('ImportInboxService.startBatch', () => {
  it('starts one run per unit and isolates per-unit failures', async () => {
    const inbox = await freshInbox();

    await writeFile(path.join(inbox, 'good.vcf'), 'BEGIN:VCARD');
    await writeFile(path.join(inbox, 'claimed.zip'), 'bytes');

    let calls = 0;
    const startRun = jest.fn(async (_ctx: unknown, input: { localSource: { path: string } }) => {
      calls += 1;

      if (input.localSource.path.endsWith('claimed.zip')) {
        throw new Error('claimed.zip is already being imported by another run');
      }

      return { run: { id: `run-${calls}`, label: path.basename(input.localSource.path) } };
    });

    const { service } = build({ startRun });

    await withInbox(inbox, async () => {
      const batch = await service.startBatch(ctx, {
        units: ['good.vcf', 'claimed.zip', 'missing.zip'],
        source: 'api',
      });

      expect(batch.results).toHaveLength(3);
      expect(batch.results[0]).toMatchObject({ unit: 'good.vcf', runId: 'run-1' });
      expect(batch.results[1].error).toContain('already being imported');
      // Missing files answer like out-of-bounds ones — fail-closed, isolated.
      expect(batch.results[2].error).toBeTruthy();
      expect(batch.results[2].runId).toBeUndefined();
    });
  });

  it('refuses a traversal escape per unit, touching nothing outside', async () => {
    const inbox = await freshInbox();

    const { service, startRun } = build();

    await withInbox(inbox, async () => {
      const batch = await service.startBatch(ctx, {
        units: ['../../../etc/passwd'],
        source: 'api',
      });

      expect(batch.results[0].error).toBeTruthy();
      expect(startRun).not.toHaveBeenCalled();
    });
  });

  it('rejects a whole batch over the cap instead of silently truncating it', async () => {
    const inbox = await freshInbox();
    const { service, startRun } = build();

    await withInbox(inbox, async () => {
      await expect(
        service.startBatch(ctx, {
          units: Array.from({ length: MAX_INBOX_BATCH_UNITS + 1 }, (_, index) => `u${index}.zip`),
          source: 'api',
        }),
      ).rejects.toThrow(/at most/);
      expect(startRun).not.toHaveBeenCalled();
    });
  });

  it('imports everything the scan yields when no units are named, skipping claimed ones', async () => {
    const inbox = await freshInbox();
    const claimed = path.join(inbox, 'claimed.zip');

    await writeFile(path.join(inbox, 'a.vcf'), 'BEGIN:VCARD');
    await writeFile(claimed, 'bytes');

    const { service, startRun } = build({
      findActiveByPaths: jest.fn(async () => [{ sourcePath: claimed, runId: 'run-live' }]),
    });

    await withInbox(inbox, async () => {
      const batch = await service.startBatch(ctx, { source: 'api' });

      expect(batch.results.map((result) => result.unit)).toEqual(['a.vcf']);
      expect(startRun).toHaveBeenCalledTimes(1);
    });
  });
});
