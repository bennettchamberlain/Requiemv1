import { mkdtemp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import config from '@ci/configuration';

import { PathOutsideImportRootsError } from '../importRoots';
import { acquireLocalUnit } from '../localAcquire';

/**
 * The transactional move that consumes an inbox unit — the only code that
 * mutates the inbox. Every case here is a crash window or a safety property:
 * the recovery ordering decides whether a retry finishes the move, restarts
 * it, or leaves a newcomer alone, and getting one branch wrong either loses
 * bytes or moves bytes the run does not own.
 */

async function withUploads<T>(dir: string, run: () => Promise<T>): Promise<T> {
  const previous = config.import.uploadsDir;

  (config.import as { uploadsDir: string }).uploadsDir = dir;

  try {
    return await run();
  } finally {
    (config.import as { uploadsDir: string }).uploadsDir = previous;
  }
}

async function fixture(): Promise<{ inbox: string; scratch: string }> {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'ci-acquire-'));
  const inbox = path.join(parent, 'uploads');
  const scratch = path.join(parent, 'scratch');

  await mkdir(inbox);
  await mkdir(scratch);

  return { inbox, scratch };
}

const log = () => undefined;

describe('acquireLocalUnit', () => {
  it('moves a file into scratch by rename', async () => {
    const { inbox, scratch } = await fixture();
    const source = path.join(inbox, 'export.zip');

    await writeFile(source, 'bytes');

    await withUploads(inbox, async () => {
      const result = await acquireLocalUnit({ sourcePath: source, scratchDir: scratch, sizeBytes: 5, log });

      expect(result.method).toBe('rename');
      expect(await readFile(result.destPath, 'utf8')).toBe('bytes');
      await expect(stat(source)).rejects.toMatchObject({ code: 'ENOENT' });
    });
  });

  it('moves a directory tree the same way', async () => {
    const { inbox, scratch } = await fixture();
    const source = path.join(inbox, 'takeout');

    await mkdir(path.join(source, 'Mail'), { recursive: true });
    await writeFile(path.join(source, 'Mail', 'inbox.mbox'), 'mail');

    await withUploads(inbox, async () => {
      const result = await acquireLocalUnit({ sourcePath: source, scratchDir: scratch, sizeBytes: 4, log });

      expect(result.method).toBe('rename');
      expect(await readFile(path.join(result.destPath, 'Mail', 'inbox.mbox'), 'utf8')).toBe('mail');
      await expect(stat(source)).rejects.toMatchObject({ code: 'ENOENT' });
    });
  });

  it('recovers when a previous attempt already finalized', async () => {
    // Crash window: after the finalize rename, before the DB row moved. The
    // retry must NOT re-move — a same-named newcomer in the inbox belongs to a
    // later batch, not to this run.
    const { inbox, scratch } = await fixture();
    const newcomer = path.join(inbox, 'export.zip');

    await writeFile(path.join(scratch, 'export.zip'), 'moved-bytes');
    await writeFile(newcomer, 'newcomer-bytes');

    await withUploads(inbox, async () => {
      const result = await acquireLocalUnit({
        sourcePath: newcomer,
        scratchDir: scratch,
        sizeBytes: 5,
        log,
      });

      expect(result.method).toBe('recovered');
      expect(await readFile(result.destPath, 'utf8')).toBe('moved-bytes');
      // The newcomer is untouched.
      expect(await readFile(newcomer, 'utf8')).toBe('newcomer-bytes');
    });
  });

  it('finishes an interrupted move when the source is gone', async () => {
    // Crash window: after rename(source, tmp), before rename(tmp, dest).
    const { inbox, scratch } = await fixture();
    const source = path.join(inbox, 'export.zip');

    await writeFile(path.join(scratch, '.acquiring-export.zip'), 'bytes');

    await withUploads(inbox, async () => {
      const result = await acquireLocalUnit({ sourcePath: source, scratchDir: scratch, sizeBytes: 5, log });

      expect(result.method).toBe('recovered');
      expect(await readFile(result.destPath, 'utf8')).toBe('bytes');
      expect(await readdir(scratch)).toEqual(['export.zip']);
    });
  });

  it('scraps a partial copy when the source is still intact', async () => {
    // Crash window: a copy fallback died mid-write. The source is whole, so
    // the partial tmp is garbage and the move starts over.
    const { inbox, scratch } = await fixture();
    const source = path.join(inbox, 'export.zip');

    await writeFile(source, 'bytes');
    await writeFile(path.join(scratch, '.acquiring-export.zip'), 'partial');

    await withUploads(inbox, async () => {
      const result = await acquireLocalUnit({ sourcePath: source, scratchDir: scratch, sizeBytes: 5, log });

      expect(result.method).toBe('rename');
      expect(await readFile(result.destPath, 'utf8')).toBe('bytes');
    });
  });

  it('falls back to copy-then-delete across filesystems', async () => {
    const { inbox, scratch } = await fixture();
    const source = path.join(inbox, 'takeout');

    await mkdir(source);
    await writeFile(path.join(source, 'data.json'), 'data');

    // Simulate EXDEV on the source→tmp rename only; the tmp→dest finalize is
    // same-filesystem and must still work.
    let renames = 0;
    const exdevOnce: typeof rename = async (from, to) => {
      renames += 1;

      if (renames === 1) {
        const err = new Error('cross-device link') as Error & { code: string };

        err.code = 'EXDEV';
        throw err;
      }

      return rename(from, to);
    };

    await withUploads(inbox, async () => {
      const result = await acquireLocalUnit({
        sourcePath: source,
        scratchDir: scratch,
        sizeBytes: 4,
        log,
        renameImpl: exdevOnce,
      });

      expect(result.method).toBe('copy');
      expect(await readFile(path.join(result.destPath, 'data.json'), 'utf8')).toBe('data');
      // Deleted only after the copy completed.
      await expect(stat(source)).rejects.toMatchObject({ code: 'ENOENT' });
    });
  });

  it('refuses a source outside the staging area at the mutation site', async () => {
    // Defense in depth: the claim validated the path once, but a row edited to
    // point elsewhere must be refused HERE, where the moving and deleting
    // happens — and refused before anything is touched.
    const { inbox, scratch } = await fixture();
    const outside = await mkdtemp(path.join(os.tmpdir(), 'ci-outside-'));
    const victim = path.join(outside, 'passwd');

    await writeFile(victim, 'root:x:0:0');

    await withUploads(inbox, async () => {
      await expect(
        acquireLocalUnit({ sourcePath: victim, scratchDir: scratch, sizeBytes: 10, log }),
      ).rejects.toBeInstanceOf(PathOutsideImportRootsError);

      // Untouched.
      expect(await readFile(victim, 'utf8')).toBe('root:x:0:0');
    });

    await rm(outside, { recursive: true, force: true });
  });
});
