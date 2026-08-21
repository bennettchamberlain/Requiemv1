import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { DataSource } from 'typeorm';

import config from '@ci/configuration';

import type { ImportStageKindName } from '../constants';
import { ImportRetentionService } from '../services/ImportRetentionService';
import { ImportScratchService } from '../services/ImportScratchService';
import { StagedWriter } from '../staging/StagedWriter';

import { createStagingHarness, importDatabase, type StagingHarness } from './support/stagingHarness';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * IMPORT RETENTION, AGAINST REAL POSTGRES.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Everything this sweep does is a `DELETE` and a foreign-key cascade, so a
 * mocked repository would agree with whatever the spec author believed about
 * both. `staged_relationships` cascades from `staged_items` AND
 * `staged_entities`, `entity_mappings` cascades from `staged_entities`, and
 * `import_stages` cascades from `import_runs` — four cascade edges whose whole
 * value is that the service does not have to name them. Asserting that against
 * a stub is asserting nothing.
 *
 * The two halves under test are the two windows:
 *
 *  - `stagingDays` — the scratchpad goes, the run row and its stages stay, so
 *    the import UI still renders the history.
 *  - `runHistoryDays` — the run row goes and takes everything with it.
 *
 * and, more important than either, the four things the sweep must never take:
 * a live run, a recent run, a run with resumable work (`pending`/`failed`
 * staged rows), and a run whose bytes still exist only on disk.
 */

const describeWithDatabase = importDatabase.available ? describe : describe.skip;

if (!importDatabase.available) {
  console.warn(`[import/importRetention.integration] SKIPPED — ${importDatabase.reason}`);
}

jest.setTimeout(60_000);

type Retention = (typeof config.import)['retention'];

const DAY_MS = 24 * 60 * 60 * 1000;

describeWithDatabase(`import retention (${importDatabase.target})`, () => {
  let harness: StagingHarness;
  let teardown: () => Promise<void>;
  let dataSource: DataSource;
  let userId: string;
  let retention: ImportRetentionService;
  let scratch: ImportScratchService;
  let scratchRoot: string;
  let originalRetention: Retention;
  let originalScratchDir: string;

  const stubLogger = () =>
    ({
      setContext: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      error: jest.fn(),
    }) as never;

  beforeAll(async () => {
    ({ harness, teardown } = await createStagingHarness());
    ({ dataSource, userId } = harness);

    scratchRoot = await mkdtemp(path.join(os.tmpdir(), 'ci-import-retention-'));

    originalRetention = config.import.retention;
    originalScratchDir = config.import.scratchDir;
    // A real directory this spec owns, so `ImportScratchService.exists` answers
    // about bytes the spec created rather than about the appliance's own tree.
    (config.import as { scratchDir: string }).scratchDir = scratchRoot;

    scratch = new ImportScratchService(stubLogger());
    retention = new ImportRetentionService(dataSource, scratch, stubLogger());
  });

  afterAll(async () => {
    (config.import as { retention: Retention }).retention = originalRetention;
    (config.import as { scratchDir: string }).scratchDir = originalScratchDir;

    await rm(scratchRoot, { recursive: true, force: true });

    // This spec seeds source rows the harness does not track (an inbox unit,
    // an upload it re-points at a run) and its sweeps deliberately leave some
    // of them behind, so it clears its own user's registry before teardown.
    await dataSource.query(`DELETE FROM ci_import.staged_sources WHERE user_id = $1::uuid`, [userId]);

    await teardown();
  });

  beforeEach(() => {
    setRetention({});
  });

  function setRetention(overrides: Partial<Retention>): void {
    (config.import as { retention: Retention }).retention = {
      enabled: true,
      stagingDays: 7,
      runHistoryDays: 90,
      maxRunsPerSweep: 200,
      deleteBatchSize: 5000,
      ...overrides,
    };
  }

  // ── seeding ───────────────────────────────────────────────────────────────

  /**
   * A run with a full staging payload: two items, an entity, an item→entity
   * edge, an item→item edge, and an entity mapping. Every cascade edge in the
   * schema is represented, so a sweep that deletes only what it names leaves
   * something behind and the counts say so.
   */
  async function seedRun(
    options: { classification?: string; stages?: readonly ImportStageKindName[] } = {},
  ): Promise<string> {
    // Explicit stages so the stage count is a constant this spec can assert on
    // rather than whatever the default list happens to be.
    const { run } = await harness.startRunForDrop(
      await harness.stageDrop('export.zip'),
      options.stages ?? ['unpack', 'parse', 'push'],
    );
    const runId = run.id;
    const writer = new StagedWriter(dataSource.manager, { userId, runId, dataSource: 'google_photos' });

    for (const name of ['one', 'two']) {
      writer.push({
        item: {
          // NOT a file classification by default: `photo`/`media`/`file` and
          // friends make `hasUnstoredMedia` true for any row with a location,
          // which is a guard this spec exercises deliberately and must not
          // trip over by accident.
          classification: options.classification ?? 'generic',
          timestamp: new Date('2012-07-04T10:00:00Z'),
          content: { filename: `${name}-${runId.slice(0, 8)}.jpg` },
          intermediateLocation: 'Photos from 2012/',
        },
      });
    }

    await writer.settled();

    const items = await dataSource.query<Array<{ id: string }>>(
      `SELECT id FROM ci_import.staged_items WHERE run_id = $1::uuid ORDER BY id`,
      [runId],
    );

    expect(items).toHaveLength(2);

    const [entity] = await dataSource.query<Array<{ id: string }>>(
      `INSERT INTO ci_import.staged_entities (run_id, user_id, type, name, identity_key, push_status)
       VALUES ($1::uuid, $2::uuid, 'Person', 'Ada', $3, 'pushed')
       RETURNING id`,
      [runId, userId, `ada-${runId}`],
    );

    await dataSource.query(
      `INSERT INTO ci_import.staged_relationships (run_id, item_id, entity_id, relation)
       VALUES ($1::uuid, $2::uuid, $3::uuid, 'depicts')`,
      [runId, items[0].id, entity.id],
    );
    await dataSource.query(
      `INSERT INTO ci_import.staged_relationships (run_id, item_id, related_item_id, relation)
       VALUES ($1::uuid, $2::uuid, $3::uuid, 'album')`,
      [runId, items[0].id, items[1].id],
    );
    await dataSource.query(
      `INSERT INTO ci_import.entity_mappings (staged_entity_id, user_id, server_entity_id)
       VALUES ($1::uuid, $2::uuid, gen_random_uuid())`,
      [entity.id, userId],
    );

    return runId;
  }

  /** Put every staged row of a run into a terminal push state. */
  async function drain(runId: string, status: 'pushed' | 'skipped' | 'failed' = 'pushed'): Promise<void> {
    for (const table of ['staged_items', 'staged_entities']) {
      await dataSource.query(
        `UPDATE ci_import.${table} SET push_status = $2, pushed_at = now() WHERE run_id = $1::uuid`,
        [runId, status],
      );
    }
  }

  /**
   * Close the run the way the stage runners do — every stage terminal, the run
   * row terminal — and then age it.
   */
  async function finish(runId: string, daysAgo: number, status = 'completed'): Promise<void> {
    const at = new Date(Date.now() - daysAgo * DAY_MS);

    await dataSource.query(
      `UPDATE ci_import.import_stages
          SET status = 'completed', finished_at = $2, updated_at = $2
        WHERE run_id = $1::uuid`,
      [runId, at],
    );
    await dataSource.query(
      `UPDATE ci_import.import_runs
          SET status = $3, percent = 100, finished_at = $2, updated_at = $2
        WHERE id = $1::uuid`,
      [runId, at, status],
    );
  }

  /** A drained, closed, aged run — the ordinary retention candidate. */
  async function retiredRun(daysAgo: number, status = 'completed'): Promise<string> {
    const runId = await seedRun();

    await drain(runId);
    await finish(runId, daysAgo, status);

    return runId;
  }

  // ── counting ──────────────────────────────────────────────────────────────

  async function counts(runId: string): Promise<Record<string, number>> {
    const [row] = await dataSource.query<Array<Record<string, number>>>(
      `SELECT (SELECT count(*)::int FROM ci_import.import_runs WHERE id = $1::uuid) AS runs,
              (SELECT count(*)::int FROM ci_import.import_stages WHERE run_id = $1::uuid) AS stages,
              (SELECT count(*)::int FROM ci_import.staged_items WHERE run_id = $1::uuid) AS items,
              (SELECT count(*)::int FROM ci_import.staged_entities WHERE run_id = $1::uuid) AS entities,
              (SELECT count(*)::int FROM ci_import.staged_relationships WHERE run_id = $1::uuid) AS relationships,
              (SELECT count(*)::int FROM ci_import.entity_mappings m
                 JOIN ci_import.staged_entities e ON e.id = m.staged_entity_id
                WHERE e.run_id = $1::uuid) AS mappings`,
      [runId],
    );

    return row;
  }

  /**
   * One `staged_sources` row by whatever still identifies it once its run is
   * gone — an upload's handle, an inbox unit's path. Deliberately not keyed on
   * `run_id`: the column is `ON DELETE SET NULL`, so a row that survives its
   * run is exactly the row this cannot find that way.
   */
  async function sourceRow(key: string): Promise<{ status: string; runId: string | null } | null> {
    const [row] = await dataSource.query<Array<{ status: string; runId: string | null }>>(
      `SELECT status, run_id AS "runId"
         FROM ci_import.staged_sources
        WHERE drop_id = $1 OR source_path = $1`,
      [key],
    );

    return row ?? null;
  }

  /** The handle of the upload a harness run claimed. */
  async function uploadDropFor(runId: string): Promise<string> {
    const [row] = await dataSource.query<Array<{ dropId: string }>>(
      `SELECT drop_id AS "dropId" FROM ci_import.staged_sources
        WHERE run_id = $1::uuid AND origin = 'upload'`,
      [runId],
    );

    return row.dropId;
  }

  const FULL = { runs: 1, stages: 3, items: 2, entities: 1, relationships: 2, mappings: 1 };
  const HISTORY_ONLY = { runs: 1, stages: 3, items: 0, entities: 0, relationships: 0, mappings: 0 };
  const GONE = { runs: 0, stages: 0, items: 0, entities: 0, relationships: 0, mappings: 0 };

  // ── what goes ─────────────────────────────────────────────────────────────

  describe('the staging window', () => {
    it('reclaims the payload of a drained run and keeps its history', async () => {
      const runId = await retiredRun(30);

      expect(await counts(runId)).toEqual(FULL);

      const result = await retention.sweep();

      expect(await counts(runId)).toEqual(HISTORY_ONLY);
      expect(result.payloadPurgedRuns).toBeGreaterThanOrEqual(1);
      expect(result.runsDeleted).toBe(0);
    });

    it('leaves history queryable — the run list reads stages, never staged rows', async () => {
      const runId = await retiredRun(30);

      await retention.sweep();

      const [row] = await dataSource.query<Array<{ status: string; percent: number }>>(
        `SELECT status, percent FROM ci_import.import_runs WHERE id = $1::uuid`,
        [runId],
      );

      expect(row).toEqual({ status: 'completed', percent: 100 });
      expect((await harness.service.stagesFor(runId)).length).toBe(3);
    });

    it('takes a partial run too — a partly-parsed export is terminal, not broken', async () => {
      const runId = await retiredRun(30, 'partial');

      await retention.sweep();

      expect(await counts(runId)).toEqual(HISTORY_ONLY);
    });

    it('does not re-select a run whose payload is already gone', async () => {
      await retiredRun(30);

      expect((await retention.sweep()).payloadPurgedRuns).toBeGreaterThanOrEqual(1);
      expect((await retention.sweep()).payloadPurgedRuns).toBe(0);
    });
  });

  describe('the history window', () => {
    it('deletes the run and cascades everything still hanging off it', async () => {
      const runId = await retiredRun(200);

      const result = await retention.sweep();

      expect(await counts(runId)).toEqual(GONE);
      expect(result.runsDeleted).toBeGreaterThanOrEqual(1);
    });

    it('is the backstop for a run the staging sweep declined — failed rows and all', async () => {
      const runId = await seedRun();

      await drain(runId, 'failed');
      await finish(runId, 200);

      // Inside the staging window's rules this run is untouchable: `failed`
      // rows are what retryFailedPush exists for.
      setRetention({ runHistoryDays: 365 });
      await retention.sweep();
      expect(await counts(runId)).toEqual(FULL);

      // Past the history window it goes anyway, so a retry nobody ran cannot
      // pin a payload open forever.
      setRetention({});
      await retention.sweep();
      expect(await counts(runId)).toEqual(GONE);
    });

    it('takes the retired run’s spent source rows with it', async () => {
      const runId = await retiredRun(200);
      const dropId = await uploadDropFor(runId);

      // What `finishRun` stamps on a run that pulled records: the archive went
      // into the run's scratch tree and was reclaimed with it.
      await harness.stagedSources.markConsumed(runId);

      // A second unit the same run unpacked. Inbox, so it has no handle at all
      // — the run id was the only thing identifying it, and `ON DELETE SET
      // NULL` used to take even that.
      const inboxPath = `/nonexistent/inbox/${runId}/unit`;

      await dataSource.query(
        `INSERT INTO ci_import.staged_sources (user_id, origin, source_path, kind, status, run_id)
         VALUES ($1::uuid, 'inbox', $2, 'directory', 'moved', $3::uuid)`,
        [userId, inboxPath, runId],
      );

      const result = await retention.sweep();

      expect(await counts(runId)).toEqual(GONE);
      expect(await sourceRow(dropId)).toBeNull();
      expect(await sourceRow(inboxPath)).toBeNull();
      expect(result.sourceRowsDeleted).toBeGreaterThanOrEqual(2);
    });

    it('leaves an upload the user still holds — even one naming the retired run', async () => {
      const runId = await retiredRun(200);

      await harness.stagedSources.markConsumed(runId);

      // Still `staged`: its archive is sitting in the uploads directory this
      // second. Pointed at the retired run so nothing but the STATUS can save
      // it — which is what `run_id ON DELETE SET NULL` is there to protect.
      const heldDropId = await harness.stageDrop('still-held.zip');

      await dataSource.query(`UPDATE ci_import.staged_sources SET run_id = $1::uuid WHERE drop_id = $2`, [
        runId,
        heldDropId,
      ]);

      await retention.sweep();

      expect(await counts(runId)).toEqual(GONE);
      expect(await sourceRow(heldDropId)).toEqual({ status: 'staged', runId: null });
    });
  });

  // ── what stays ────────────────────────────────────────────────────────────

  describe('what the sweep must never take', () => {
    it('leaves a run with work still in flight', async () => {
      const runId = await seedRun();

      await drain(runId);
      // Aged well past both windows, but never closed: `finished_at` is NULL
      // and a stage is still queued.
      await dataSource.query(
        `UPDATE ci_import.import_runs
            SET status = 'running', created_at = now() - interval '400 days',
                updated_at = now() - interval '400 days'
          WHERE id = $1::uuid`,
        [runId],
      );

      await retention.sweep();

      // Asserted about THIS run rather than about the sweep's totals: the
      // sweep is global, and a sibling test's run is not this test's subject.
      expect(await counts(runId)).toEqual(FULL);
    });

    it('leaves a run whose status is terminal but whose stages are not', async () => {
      const runId = await retiredRun(200);

      // The status column is a derived cache. A stage still `running` means
      // work is in flight whatever the cache says.
      await dataSource.query(
        `UPDATE ci_import.import_stages SET status = 'running'
          WHERE id = (SELECT id FROM ci_import.import_stages WHERE run_id = $1::uuid ORDER BY seq DESC LIMIT 1)`,
        [runId],
      );

      await retention.sweep();

      expect(await counts(runId)).toEqual(FULL);
    });

    it('leaves a recently finished run alone', async () => {
      const runId = await retiredRun(1);

      await retention.sweep();

      expect(await counts(runId)).toEqual(FULL);
    });

    it('leaves a run whose rows are still pending — that is the Sync card’s backlog', async () => {
      const runId = await seedRun();

      await drain(runId);
      await dataSource.query(
        `UPDATE ci_import.staged_items SET push_status = 'pending', pushed_at = NULL
          WHERE run_id = $1::uuid`,
        [runId],
      );
      await finish(runId, 30);

      await retention.sweep();

      expect(await counts(runId)).toEqual(FULL);
    });

    it('leaves a run whose rows failed — that is what retryFailedPush reads', async () => {
      const runId = await seedRun();

      await drain(runId, 'failed');
      await finish(runId, 30);

      await retention.sweep();

      expect(await counts(runId)).toEqual(FULL);
    });

    it('leaves a run still holding media whose bytes were never stored', async () => {
      // A staged photo with an intermediate location and no FileId: its bytes
      // exist only in the scratch tree, and this row is the record of that.
      const runId = await seedRun({ classification: 'photo' });

      await drain(runId);
      await finish(runId, 200);

      expect(await harness.service.hasUnstoredMedia(runId)).toBe(true);

      const result = await retention.sweep();

      expect(await counts(runId)).toEqual(FULL);
      expect(result.skipped.unstored_media).toBeGreaterThanOrEqual(1);
    });

    it('leaves a run that still owns a scratch tree — its row is the only index into those bytes', async () => {
      const runId = await retiredRun(200);

      await mkdir(scratch.dirFor(userId, runId), { recursive: true });

      const result = await retention.sweep();

      expect(await counts(runId)).toEqual(FULL);
      expect(result.skipped.scratch_tree_present).toBeGreaterThanOrEqual(1);

      // And once the tree is reclaimed, the same run retires normally.
      await rm(scratch.dirFor(userId, runId), { recursive: true, force: true });
      await retention.sweep();
      expect(await counts(runId)).toEqual(GONE);
    });
  });

  /**
   * The wizard's shape: `[unpack, parse]` only, its rows still `pending`, and
   * no push stage — so `PUSH_ELIGIBLE_WHERE` offers it on the Sync card. That
   * offer carries no age bound, which is why the sweep's must not either.
   */
  const PARSED_STAGES = ['unpack', 'parse'] as const;
  const PARSED_FULL = { ...FULL, stages: 2 };

  async function parsedNeverPushedRun(daysAgo: number): Promise<string> {
    const runId = await seedRun({ stages: PARSED_STAGES });

    await finish(runId, daysAgo);

    return runId;
  }

  describe('a parse that was never pushed', () => {
    it('survives the history window — deleting it would destroy the only copy', async () => {
      const runId = await parsedNeverPushedRun(200);

      // The premise, asserted rather than assumed: Sync is offering this run.
      expect(await harness.service.listUnpushed({ userId })).toContainEqual(
        expect.objectContaining({ run: expect.objectContaining({ id: runId }) }),
      );

      const result = await retention.sweep();

      expect(await counts(runId)).toEqual(PARSED_FULL);
      // And the offer is still honest afterwards.
      expect(await harness.service.listUnpushed({ userId })).toContainEqual(
        expect.objectContaining({ run: expect.objectContaining({ id: runId }) }),
      );
      expect(result.skipped.push_pending).toBeGreaterThanOrEqual(1);
    });

    it('survives at any TTL — the exception is the payload, not the dial', async () => {
      const runId = await parsedNeverPushedRun(200);

      setRetention({ stagingDays: 0, runHistoryDays: 0 });
      await retention.sweep();

      expect(await counts(runId)).toEqual(PARSED_FULL);
    });

    it('but the same run goes once its rows are pushed — nothing is left to offer', async () => {
      const runId = await parsedNeverPushedRun(200);

      // The ONLY difference from the run above. If the guard were "any parsed
      // run is immortal" rather than "a pushable payload is", this would stay.
      await drain(runId);

      await retention.sweep();

      // Run-scoped, not a sweep total: the two runs above are immortal by
      // design and are still in this database, being skipped every sweep.
      expect(await counts(runId)).toEqual(GONE);
    });
  });

  // ── the dials ─────────────────────────────────────────────────────────────

  describe('configuration', () => {
    it('does nothing at all when disabled', async () => {
      const runId = await retiredRun(200);

      setRetention({ enabled: false });

      expect(await retention.sweep()).toEqual({
        payloadPurgedRuns: 0,
        stagedRowsDeleted: 0,
        runsDeleted: 0,
        sourceRowsDeleted: 0,
        skipped: {},
      });
      expect(await counts(runId)).toEqual(FULL);
    });

    it('honours a shorter staging window', async () => {
      const runId = await retiredRun(2);

      setRetention({ stagingDays: 30 });
      await retention.sweep();
      expect(await counts(runId)).toEqual(FULL);

      setRetention({ stagingDays: 1 });
      await retention.sweep();
      expect(await counts(runId)).toEqual(HISTORY_ONLY);
    });

    it('deletes a large payload across several batches', async () => {
      const runId = await retiredRun(30);

      // Two items, one entity: a batch size of 1 forces three delete rounds
      // per table plus the terminating short read, which is the loop the
      // 780k-row runs actually take.
      setRetention({ deleteBatchSize: 1 });

      const result = await retention.sweep();

      expect(await counts(runId)).toEqual(HISTORY_ONLY);
      expect(result.stagedRowsDeleted).toBeGreaterThanOrEqual(3);
    });

    it('bounds one sweep to maxRunsPerSweep', async () => {
      await retiredRun(30);
      await retiredRun(30);

      setRetention({ maxRunsPerSweep: 1 });

      expect((await retention.sweep()).payloadPurgedRuns).toBe(1);
      expect((await retention.sweep()).payloadPurgedRuns).toBe(1);
      expect((await retention.sweep()).payloadPurgedRuns).toBe(0);
    });
  });
});
