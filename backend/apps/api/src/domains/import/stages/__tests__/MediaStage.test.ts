import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { StageRunContext } from '../../types';
import { MediaStage } from '../MediaStage';

/**
 * What matters here is the ledger, not the upload: this stage exists because
 * the bytes were being deleted with the scratch tree while the rows that
 * describe them claimed success, so the assertions are about a row ending up
 * pointing at a stored file — or, when it cannot, saying so once and not
 * spinning on it.
 */

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '33333333-3333-4333-8333-333333333333';

function makeStage(
  rows: Array<Record<string, unknown>>,
  upload?: jest.Mock,
  options: { sharedPathStillPending?: boolean } = {},
) {
  const updates: Array<{ sql: string; params: unknown[] }> = [];
  let served = false;

  const dataSource = {
    query: jest.fn(async (sql: string, params: unknown[]) => {
      if (sql.includes('UPDATE')) {
        updates.push({ sql, params });

        return [];
      }

      // The preflight's pending-bytes sum, from the rows' declared sizes.
      if (sql.includes('sum(size_bytes)')) {
        return [{ bytes: rows.reduce((sum, row) => sum + Number(row.sizeBytes ?? 0), 0) }];
      }

      // The reclaim's does-anything-else-still-need-this-file probe.
      if (sql.includes('SELECT 1 AS present')) {
        return options.sharedPathStillPending ? [{ present: 1 }] : [];
      }

      if (sql.includes('count(*)')) {
        // The uploaded/carried-over probe asks without the media predicate.
        if (sql.includes("FileMediaError' IS NOT NULL")) {
          return [{ count: 0 }];
        }

        return [{ count: rows.length }];
      }

      // The batch read: serve the rows once, then drain.
      if (served) {
        return [];
      }

      served = true;

      return rows;
    }),
  };

  const files = {
    uploadWithDedupInfo: upload ?? jest.fn(async () => ({ file: { id: 'file-1' }, deduped: false })),
  };

  const logger = {
    setContext: jest.fn(),
    log: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  };

  return {
    stage: new MediaStage(dataSource as never, files as never, logger as never),
    updates,
    files,
  };
}

function contextFor(scratchDir: string): StageRunContext {
  return {
    runId: RUN_ID,
    userId: USER_ID,
    stageId: '22222222-2222-4222-8222-222222222222',
    scratchDir,
    progress: jest.fn(async () => undefined),
    log: jest.fn(),
  } as unknown as StageRunContext;
}

describe('MediaStage', () => {
  let scratchDir: string;

  beforeEach(() => {
    scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-mediastage-'));
  });

  afterEach(() => {
    fs.rmSync(scratchDir, { recursive: true, force: true });
  });

  it('stores a media file and points the staged row at it', async () => {
    const photo = path.join(scratchDir, 'photo.jpg');
    fs.writeFileSync(photo, 'jpegbytes');

    const { stage, updates, files } = makeStage([
      { id: 'row-1', filename: 'photo.jpg', mediaType: 'image/jpeg', sizeBytes: 9, localPath: photo },
    ]);

    const outcome = await stage.run(contextFor(scratchDir));

    expect(files.uploadWithDedupInfo).toHaveBeenCalledWith(
      { userId: USER_ID },
      expect.objectContaining({ path: photo, contentType: 'image/jpeg' }),
    );
    // The whole point: the row now carries the id the push reads as FileId.
    expect(updates).toHaveLength(1);
    expect(updates[0].sql).toContain('FileId');
    expect(updates[0].params).toEqual(['row-1', 'file-1']);
    expect(outcome.detail).toMatchObject({ uploaded: 1, failed: 0 });
  });

  it('counts an already-stored file as deduped rather than uploaded', async () => {
    const photo = path.join(scratchDir, 'again.jpg');
    fs.writeFileSync(photo, 'same');

    const { stage } = makeStage(
      [{ id: 'row-2', filename: 'again.jpg', mediaType: 'image/jpeg', sizeBytes: 4, localPath: photo }],
      jest.fn(async () => ({ file: { id: 'file-existing' }, deduped: true })),
    );

    const outcome = await stage.run(contextFor(scratchDir));

    // Dedup is the store's answer, and it is what makes re-importing the same
    // archive cost nothing rather than duplicating every photo.
    expect(outcome.detail).toMatchObject({ uploaded: 0, deduped: 1, failed: 0 });
  });

  it('refuses a path outside the run scratch directory', async () => {
    // The path comes from a parser reading a user-supplied archive; without this
    // the stage would be a primitive for reading any file the API can see.
    const outside = path.join(os.tmpdir(), 'ci-mediastage-outsider.jpg');
    fs.writeFileSync(outside, 'nope');

    const { stage, updates, files } = makeStage([
      { id: 'row-3', filename: 'outsider.jpg', mediaType: 'image/jpeg', sizeBytes: 4, localPath: outside },
    ]);

    const outcome = await stage.run(contextFor(scratchDir));

    expect(files.uploadWithDedupInfo).not.toHaveBeenCalled();
    expect(updates[0].sql).toContain('FileMediaError');
    expect(outcome.partial).toBe(true);

    fs.rmSync(outside, { force: true });
  });

  it('records an unreadable file once instead of retrying it forever', async () => {
    const missing = path.join(scratchDir, 'gone.jpg');

    const { stage, updates } = makeStage([
      { id: 'row-4', filename: 'gone.jpg', mediaType: 'image/jpeg', sizeBytes: 1, localPath: missing },
    ]);

    const outcome = await stage.run(contextFor(scratchDir));

    // Stamped with the error key, which the selection query excludes — so the
    // next attempt skips it rather than spinning on the same dead path.
    expect(updates[0].sql).toContain('FileMediaError');
    expect(outcome.detail).toMatchObject({ failed: 1 });
    expect(outcome.partial).toBe(true);
  });

  it('finishes cleanly on an archive with no media at all', async () => {
    const { stage, files } = makeStage([]);

    const outcome = await stage.run(contextFor(scratchDir));

    expect(files.uploadWithDedupInfo).not.toHaveBeenCalled();
    expect(outcome.partial).toBeUndefined();
    expect(outcome.detail).toMatchObject({ uploaded: 0, failed: 0 });
  });

  it('reclaims the scratch copy once its store copy is durable', async () => {
    // The store copy and the scratch copy are the same bytes twice on one
    // volume; holding both for the whole stage is the 2× peak that ran a real
    // Takeout into the store's free-space floor.
    const photo = path.join(scratchDir, 'reclaim.jpg');
    fs.writeFileSync(photo, 'jpegbytes');

    const { stage, updates } = makeStage([
      { id: 'row-5', filename: 'reclaim.jpg', mediaType: 'image/jpeg', sizeBytes: 9, localPath: photo },
    ]);

    const outcome = await stage.run(contextFor(scratchDir));

    expect(outcome.detail).toMatchObject({ uploaded: 1, failed: 0 });
    // The row points at the stored file, and the scratch bytes are gone.
    expect(updates[0].params).toEqual(['row-5', 'file-1']);
    expect(fs.existsSync(photo)).toBe(false);
  });

  it('keeps the scratch copy when the upload fails, so a retry has bytes to read', async () => {
    const photo = path.join(scratchDir, 'kept.jpg');
    fs.writeFileSync(photo, 'jpegbytes');

    const { stage } = makeStage(
      [{ id: 'row-6', filename: 'kept.jpg', mediaType: 'image/jpeg', sizeBytes: 9, localPath: photo }],
      jest.fn(async () => {
        throw new Error('Storage backend has reached its minimum free drive threshold.');
      }),
    );

    const outcome = await stage.run(contextFor(scratchDir));

    expect(outcome.detail).toMatchObject({ failed: 1 });
    expect(fs.existsSync(photo)).toBe(true);
  });

  it('defers the reclaim while another unsettled row still points at the file', async () => {
    const shared = path.join(scratchDir, 'shared.jpg');
    fs.writeFileSync(shared, 'jpegbytes');

    const { stage } = makeStage(
      [{ id: 'row-7', filename: 'shared.jpg', mediaType: 'image/jpeg', sizeBytes: 9, localPath: shared }],
      undefined,
      { sharedPathStillPending: true },
    );

    const outcome = await stage.run(contextFor(scratchDir));

    // Uploaded fine — but the bytes stay for the sibling row that has not
    // settled yet. The last row standing (or end-of-run cleanup) reclaims.
    expect(outcome.detail).toMatchObject({ uploaded: 1 });
    expect(fs.existsSync(shared)).toBe(true);
  });

  it('refuses to start when the volume cannot hold the media plus the store reserve', async () => {
    const photo = path.join(scratchDir, 'huge.mp4');
    fs.writeFileSync(photo, 'mp4bytes');

    const { stage, files } = makeStage([
      // Declares 100GB of pending media…
      { id: 'row-8', filename: 'huge.mp4', mediaType: 'video/mp4', sizeBytes: 100e9, localPath: photo },
    ]);

    // …against a volume reporting ~1GB free.
    const statfs = jest.spyOn(fs, 'statfsSync').mockReturnValue({
      bavail: 1e9 / 4096,
      bsize: 4096,
      blocks: 2e12 / 4096,
    } as unknown as fs.StatsFsBase<number>);

    try {
      await expect(stage.run(contextFor(scratchDir))).rejects.toThrow(/not enough disk space/);
      // Fail LOUDLY and BEFORE work: nothing uploaded, nothing reclaimed —
      // the alternative was 5,318 quiet per-file failures on a real Takeout.
      expect(files.uploadWithDedupInfo).not.toHaveBeenCalled();
      expect(fs.existsSync(photo)).toBe(true);
    } finally {
      statfs.mockRestore();
    }
  });

  it('skips the preflight when the filesystem cannot be measured', async () => {
    const photo = path.join(scratchDir, 'nostat.jpg');
    fs.writeFileSync(photo, 'jpegbytes');

    const { stage } = makeStage([
      { id: 'row-9', filename: 'nostat.jpg', mediaType: 'image/jpeg', sizeBytes: 9, localPath: photo },
    ]);

    const statfs = jest.spyOn(fs, 'statfsSync').mockImplementation(() => {
      throw new Error('statfs unsupported');
    });

    try {
      // The guard must never be the thing that breaks an import.
      const outcome = await stage.run(contextFor(scratchDir));
      expect(outcome.detail).toMatchObject({ uploaded: 1, failed: 0 });
    } finally {
      statfs.mockRestore();
    }
  });
});
