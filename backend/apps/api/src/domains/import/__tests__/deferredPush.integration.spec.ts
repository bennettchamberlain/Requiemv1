import type { DataSource } from 'typeorm';

import type { ImportRunService } from '../services/ImportRunService';
import { StagedWriter } from '../staging/StagedWriter';

import { createStagingHarness, importDatabase, type StagingHarness } from './support/stagingHarness';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * THE WIZARD'S SYNC STEP: PUSH APPENDED AFTER THE FACT, AGAINST REAL POSTGRES.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The wizard uploads with `stages: ['unpack','parse']` and defers the push to a
 * final Sync click, which calls `startPush`. Everything that can go wrong with
 * that lives in ONE SQL statement — eligibility, the seq append, the reopen —
 * plus the ordering around it (percent refreshed before the enqueue). A mocked
 * repository would agree with whatever that statement claimed, so none of this
 * is mocked; connection, schema check and cleanup come from
 * `support/stagingHarness`.
 *
 * Isolation note: `startPush` with no filter acts on EVERY eligible run of the
 * harness user, and jest runs this file's tests sequentially. Tests that must
 * not see each other therefore either scope with `runIds` or are ordered so no
 * foreign eligible run exists when an unfiltered call runs — each such call
 * says so where it happens.
 *
 * The pending-rows eligibility clause checks items OR entities; these tests
 * stage items. The entity lane shares the same predicate shape and its pushing
 * is covered by pushStage.integration.spec.ts.
 */

const describeWithDatabase = importDatabase.available ? describe : describe.skip;

if (!importDatabase.available) {
  console.warn(`[import/deferredPush.integration] SKIPPED — ${importDatabase.reason}`);
}

jest.setTimeout(60_000);

describeWithDatabase(`deferred push (${importDatabase.target})`, () => {
  let harness: StagingHarness;
  let teardown: () => Promise<void>;
  let dataSource: DataSource;
  let events: { send: jest.Mock };
  let service: ImportRunService;
  let userId: string;

  beforeAll(async () => {
    ({ harness, teardown } = await createStagingHarness());
    ({ dataSource, events, service, userId } = harness);
  });

  afterAll(async () => {
    await teardown();
  });

  /** Begin + complete one stage, optionally with a detail payload. */
  async function driveStage(stageId: string, detail: Record<string, unknown> = {}): Promise<void> {
    expect(await service.beginStage(stageId)).toBe(true);
    await service.completeStage(stageId, { processed: 1, total: 1, detail });
  }

  /** Stage one pending item into a run, the way a parser would. */
  async function stageItem(runId: string, filename: string): Promise<void> {
    const writer = new StagedWriter(dataSource.manager, { userId, runId, dataSource: 'google_photos' });

    writer.push({
      item: {
        classification: 'photo',
        timestamp: new Date('2012-07-04T10:00:00Z'),
        content: { filename },
        intermediateLocation: 'Photos from 2012/',
      },
    });

    await writer.settled();
  }

  /**
   * A finished parse-only run with (by default) one pending staged item — the
   * state the wizard leaves a service in before Sync.
   */
  async function parsedRun(
    options: { stageRow?: boolean; parseDetail?: Record<string, unknown> } = {},
  ): Promise<{ runId: string; unpackId: string; parseId: string }> {
    const dropId = await harness.stageDrop('export.zip');
    const { run, stages } = await harness.startRunForDrop(dropId, ['unpack', 'parse']);

    await driveStage(stages[0].id);

    if (options.stageRow !== false) {
      await stageItem(run.id, `IMG-${run.id.slice(0, 8)}.jpg`);
    }

    await driveStage(stages[1].id, options.parseDetail ?? {});
    await service.advance(userId, run.id, stages[1].seq);

    return { runId: run.id, unpackId: stages[0].id, parseId: stages[1].id };
  }

  async function runRow(runId: string): Promise<{
    status: string;
    percent: number;
    finished_at: string | null;
    error: string | null;
    requested_stages: string[];
  }> {
    const [row] = await dataSource.query(
      `SELECT status, percent, finished_at, error, requested_stages
         FROM ci_import.import_runs WHERE id = $1::uuid`,
      [runId],
    );

    return row;
  }

  async function pushStagesOf(
    runId: string,
  ): Promise<Array<{ id: string; seq: number; status: string; weight: number }>> {
    return dataSource.query(
      `SELECT id, seq, status, weight FROM ci_import.import_stages
        WHERE run_id = $1::uuid AND kind = 'push' ORDER BY seq`,
      [runId],
    );
  }

  describe('the happy path', () => {
    let runId: string;

    it('a finished parse-only run shows up in listUnpushed with its pending counts', async () => {
      ({ runId } = await parsedRun());

      const before = await runRow(runId);

      expect(before.status).toBe('completed');
      expect(before.percent).toBe(100);

      const unpushed = await service.listUnpushed({ userId });
      const entry = unpushed.find((candidate) => candidate.run.id === runId);

      expect(entry).toBeDefined();
      expect(entry!.pendingItems).toBe(1);
      expect(entry!.pendingEntities).toBe(0);
    });

    it('startPush appends the stage, reopens the run at an honest percent, and enqueues', async () => {
      events.send.mockClear();

      // Unfiltered on purpose — this is the Sync button's exact call, and at
      // this point in the file the run above is the only eligible one.
      const started = await service.startPush({ userId });

      expect(started.map(({ run }) => run.id)).toEqual([runId]);

      const pushes = await pushStagesOf(runId);

      expect(pushes).toHaveLength(1);
      expect(pushes[0].seq).toBe(2);
      expect(pushes[0].status).toBe('queued');
      expect(pushes[0].weight).toBe(20);

      const after = await runRow(runId);

      expect(after.status).toBe('queued');
      expect(after.finished_at).toBeNull();
      expect(after.error).toBeNull();
      expect(after.requested_stages).toEqual(['unpack', 'parse', 'push']);
      // 30 (unpack done) + 50 (parse done) + 20·0 (push queued) over 100 — the
      // stale 100 from finishRun must be gone BEFORE anything could poll a
      // queued push under a full bar.
      expect(after.percent).toBe(80);

      expect(events.send).toHaveBeenCalledTimes(1);
      expect(events.send.mock.calls[0][1]).toMatchObject({ runId, stageId: pushes[0].id, userId });
    });

    it('a second Sync is a complete no-op', async () => {
      events.send.mockClear();

      const started = await service.startPush({ userId });

      expect(started).toEqual([]);
      expect(events.send).not.toHaveBeenCalled();

      // Still exactly one push stage, and exactly one 'push' in the bar.
      expect(await pushStagesOf(runId)).toHaveLength(1);
      expect((await runRow(runId)).requested_stages).toEqual(['unpack', 'parse', 'push']);
    });

    it('the appended stage drives to completion like any other', async () => {
      const [push] = await pushStagesOf(runId);

      await driveStage(push.id);
      await service.advance(userId, runId, push.seq);

      const finished = await runRow(runId);

      expect(finished.status).toBe('completed');
      expect(finished.percent).toBe(100);
      expect(finished.finished_at).not.toBeNull();
    });
  });

  describe('what Sync refuses to touch', () => {
    // Each exclusion scopes startPush with `runIds` so the assertion is about
    // THIS run's ineligibility, not about the file's current global state.

    it('a run still parsing', async () => {
      const dropId = await harness.stageDrop('mid-parse.zip');
      const { run, stages } = await harness.startRunForDrop(dropId, ['unpack', 'parse']);

      await driveStage(stages[0].id);
      await stageItem(run.id, 'mid-parse.jpg');
      expect(await service.beginStage(stages[1].id)).toBe(true); // running, never completed

      expect(await service.listUnpushed({ userId })).not.toContainEqual(
        expect.objectContaining({ run: expect.objectContaining({ id: run.id }) }),
      );
      expect(await service.startPush({ userId }, { runIds: [run.id] })).toEqual([]);
      expect(await pushStagesOf(run.id)).toHaveLength(0);
    });

    it('a run that already has a push stage — its recovery path is retryStage', async () => {
      const dropId = await harness.stageDrop('full-run.zip');
      const { run, stages } = await harness.startRunForDrop(dropId); // default: all three stages

      await driveStage(stages[0].id);
      await stageItem(run.id, 'full-run.jpg');
      await driveStage(stages[1].id);

      expect(await service.startPush({ userId }, { runIds: [run.id] })).toEqual([]);
      // Its one push stage is the materialized one, untouched.
      expect(await pushStagesOf(run.id)).toHaveLength(1);
      expect((await pushStagesOf(run.id))[0].seq).toBe(2);
    });

    it('a cancelled run', async () => {
      const dropId = await harness.stageDrop('cancelled.zip');
      const { run, stages } = await harness.startRunForDrop(dropId, ['unpack', 'parse']);

      await driveStage(stages[0].id);
      await stageItem(run.id, 'cancelled.jpg');
      await driveStage(stages[1].id);
      await service.cancel({ userId }, run.id);

      expect(await service.startPush({ userId }, { runIds: [run.id] })).toEqual([]);
      expect(await pushStagesOf(run.id)).toHaveLength(0);
    });

    it('a run whose parse staged nothing', async () => {
      const { runId: emptyRunId } = await parsedRun({ stageRow: false });

      expect(await service.listUnpushed({ userId })).not.toContainEqual(
        expect.objectContaining({ run: expect.objectContaining({ id: emptyRunId }) }),
      );
      expect(await service.startPush({ userId }, { runIds: [emptyRunId] })).toEqual([]);
    });
  });

  describe('scoping and re-derivation', () => {
    it('runIds restricts the push to the named run', async () => {
      const first = await parsedRun();
      const second = await parsedRun();

      const started = await service.startPush({ userId }, { runIds: [first.runId] });

      expect(started.map(({ run }) => run.id)).toEqual([first.runId]);
      expect(await pushStagesOf(first.runId)).toHaveLength(1);
      expect(await pushStagesOf(second.runId)).toHaveLength(0);

      // Sweep the leftover so later unfiltered calls in this file stay honest.
      const swept = await service.startPush({ userId });

      expect(swept.map(({ run }) => run.id)).toEqual([second.runId]);
    });

    it('a partial parse stays partial after its deferred push completes', async () => {
      const { runId } = await parsedRun({ parseDetail: { partial: true } });

      expect((await runRow(runId)).status).toBe('partial');

      const started = await service.startPush({ userId }, { runIds: [runId] });

      expect(started).toHaveLength(1);

      const [push] = await pushStagesOf(runId);

      await driveStage(push.id);
      await service.advance(userId, runId, push.seq);

      // finishRun re-derives over ALL stages: the parse that skipped a source
      // still happened, and the push finishing cannot upgrade it to complete.
      expect((await runRow(runId)).status).toBe('partial');
    });
  });
});
