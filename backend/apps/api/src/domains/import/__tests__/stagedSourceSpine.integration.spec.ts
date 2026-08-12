import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { DataSource } from 'typeorm';

import config from '@ci/configuration';

import { UnpackStage } from '../stages/UnpackStage';

import { createStagingHarness, importDatabase, type StagingHarness } from './support/stagingHarness';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * STAGED SOURCES END TO END, AGAINST REAL POSTGRES AND A REAL FILESYSTEM.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The claim is SQL racing an index, and its correctness story — a lost claim
 * takes its run row with it, a released UPLOAD is re-staged rather than
 * stranded, consumption is terminal-state-driven — is transaction behavior
 * only a real database demonstrates. The filesystem half (the move) runs
 * against real tmp directories through the real UnpackStage, because the
 * consume contract is "the source LEAVES its staging area", and only a
 * filesystem can say whether it did.
 *
 * Suites here skip without the DB env — see support/stagingHarness.
 */

const describeWithDatabase = importDatabase.available ? describe : describe.skip;

if (!importDatabase.available) {
  console.warn(`[import/stagedSourceSpine.integration] SKIPPED — ${importDatabase.reason}`);
}

jest.setTimeout(60_000);

describeWithDatabase(`staged source runs (${importDatabase.target})`, () => {
  let harness: StagingHarness;
  let teardown: () => Promise<void>;
  let dataSource: DataSource;
  let userId: string;
  let uploads: string;
  let scratchParent: string;
  let previousUploads: string;

  const createdRuns: string[] = [];

  beforeAll(async () => {
    ({ harness, teardown } = await createStagingHarness());
    ({ dataSource, userId } = harness);

    const parent = await mkdtemp(path.join(os.tmpdir(), 'ci-stagedspine-'));

    uploads = path.join(parent, 'uploads');
    scratchParent = path.join(parent, 'scratch');
    await mkdir(uploads);
    await mkdir(scratchParent);

    previousUploads = config.import.uploadsDir;
    (config.import as { uploadsDir: string }).uploadsDir = uploads;
  });

  afterAll(async () => {
    (config.import as { uploadsDir: string }).uploadsDir = previousUploads;

    // staged_sources rows survive their run's delete with run_id = NULL (the
    // no-orphaning rule), so the spec sweeps its own — scoped by the
    // harness's unique user — before the runs go.
    await dataSource.query(`DELETE FROM ci_import.staged_sources WHERE user_id = $1::uuid`, [userId]);

    for (const runId of createdRuns) {
      await dataSource.query(`DELETE FROM ci_import.import_runs WHERE id = $1::uuid`, [runId]);
    }

    await teardown();
  });

  function makeUnpackStage() {
    return new UnpackStage(
      harness.stagedSources,
      { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), debug: jest.fn() } as never,
    );
  }

  /** A REAL staged upload: bytes on disk under the uploads dir, plus its row. */
  async function seedUpload(filename = 'export.zip') {
    const dropId = `spine-${Math.random().toString(36).slice(2)}`;
    const dropDir = path.join(uploads, dropId);
    const sourcePath = path.join(dropDir, filename);

    await mkdir(dropDir, { recursive: true });
    await writeFile(sourcePath, 'bytes');

    await harness.stagedSources.registerUpload(
      { userId },
      { dropId, sourcePath, originalFilename: filename, sizeBytes: 5 },
    );

    return { dropId, sourcePath };
  }

  async function startUpload(dropId: string) {
    const result = await harness.service.startRun({ userId }, { dropId, source: 'api' });

    createdRuns.push(result.run.id);

    return result;
  }

  async function rowByDropId(dropId: string) {
    const rows = await dataSource.query<
      Array<{ status: string; run_id: string | null; expires_at: Date | null }>
    >(
      `SELECT status, run_id, expires_at FROM ci_import.staged_sources
        WHERE user_id = $1::uuid AND drop_id = $2`,
      [userId, dropId],
    );

    return rows[0] ?? null;
  }

  describe('the upload claim', () => {
    it('claims by dropId, and a second claim conflicts', async () => {
      const { dropId } = await seedUpload('twice.zip');

      await startUpload(dropId);
      await expect(startUpload(dropId)).rejects.toThrow(/already been claimed/);
    });

    it('re-stages a claimed upload when its run fails before the move — never strands it', async () => {
      // THE upload-release rule. A terminal `released` would make the file
      // invisible to the uploads list, untouchable by the purge, and
      // undeletable by the user; re-staging puts it back on every one of
      // those surfaces.
      const { dropId, sourcePath } = await seedUpload('fails.zip');
      const { run, stages } = await startUpload(dropId);

      await harness.service.failStage(stages[0].id, 'unreadable');

      const row = await rowByDropId(dropId);

      expect(row?.status).toBe('staged');
      expect(row?.run_id).toBeNull();
      expect(row?.expires_at).toBeInstanceOf(Date);
      // The bytes never left staging.
      expect((await stat(sourcePath)).size).toBe(5);
      // And the same dropId is importable again.
      const retry = await startUpload(dropId);

      expect(retry.run.id).not.toBe(run.id);
    });

    it('refuses an expired upload with the truth, not "already claimed"', async () => {
      const { dropId } = await seedUpload('expired.zip');

      await dataSource.query(
        `UPDATE ci_import.staged_sources SET status = 'expired' WHERE user_id = $1::uuid AND drop_id = $2`,
        [userId, dropId],
      );

      await expect(startUpload(dropId)).rejects.toThrow(/expired before it was imported/);
    });
  });

  describe('the move', () => {
    it('unpack moves the staged upload into scratch and marks it moved', async () => {
      const { dropId, sourcePath } = await seedUpload('upload-moves.bin');
      const { run, stages } = await startUpload(dropId);
      const scratchDir = path.join(scratchParent, run.id);

      await makeUnpackStage().run({
        userId,
        runId: run.id,
        stageId: stages[0].id,
        scratchDir,
        progress: async () => undefined,
      });

      // Consumed from staging — the file AND its now-empty <dropId>/ wrapper —
      // intact in scratch, registry says moved.
      await expect(stat(sourcePath)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(stat(path.dirname(sourcePath))).rejects.toMatchObject({ code: 'ENOENT' });
      expect(await readFile(path.join(scratchDir, 'upload-moves.bin'), 'utf8')).toBe('bytes');
      expect((await rowByDropId(dropId))?.status).toBe('moved');

      await rm(scratchDir, { recursive: true, force: true });
    });

    it('a retried stage whose claim was released finds no source and fails honestly', async () => {
      const { dropId } = await seedUpload('released-retry.zip');
      const { run, stages } = await startUpload(dropId);

      // The run failed pre-move and the upload was re-staged...
      await harness.service.failStage(stages[0].id, 'unreadable');

      // ...so a stale retry of ITS stage must not acquire the re-staged file
      // (a newer run may own it by now).
      await expect(
        makeUnpackStage().run({
          userId,
          runId: run.id,
          stageId: stages[0].id,
          scratchDir: path.join(scratchParent, run.id),
          progress: async () => undefined,
        }),
      ).rejects.toThrow(/no claimed source/);
    });
  });

  describe('consumption', () => {
    it('marks the claim consumed when the run finishes', async () => {
      const { dropId } = await seedUpload('finishes.zip');
      const { run } = await startUpload(dropId);

      await dataSource.query(
        `UPDATE ci_import.import_stages SET status = 'completed', finished_at = now() WHERE run_id = $1::uuid`,
        [run.id],
      );
      await harness.service.finishRun(run.id);

      expect((await rowByDropId(dropId))?.status).toBe('consumed');
    });

    it('never releases a claim that already moved — the bytes wait in scratch for a retry', async () => {
      const { dropId } = await seedUpload('moved-then-failed.zip');
      const { run, stages } = await startUpload(dropId);

      await dataSource.query(
        `UPDATE ci_import.staged_sources SET status = 'moved' WHERE run_id = $1::uuid`,
        [run.id],
      );

      await harness.service.failStage(stages[1].id, 'parser choked');

      expect((await rowByDropId(dropId))?.status).toBe('moved');
    });
  });
});
