import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, type EntityManager } from 'typeorm';

import type { UserServiceContext } from '@ci/common/context';
import { LoggerService } from '@ci/common/logging';
import { EventService } from '@ci/domains/events';

import { IMPORT_QUEUE, IMPORT_STAGE_WEIGHTS, type ImportStageKindName } from '../constants';
import { ImportRunEntity, type ImportRun, type ImportRunSource } from '../entities/ImportRunEntity';
import { ImportStageEntity, type ImportStage } from '../entities/ImportStageEntity';
import { ImportStageEvent } from '../events';

import { StagedSourceService } from './StagedSourceService';
import type { StageOutcome } from '../types';

export interface StartRunInput {
  /** The staged upload this run consumes. Claimed as part of starting. */
  dropId: string;

  /** Display label for the run list. Defaults to the drop's original filename. */
  label?: string | null;

  source?: ImportRunSource;

  /**
   * Stage kinds to execute, in order. Defaults to {@link DEFAULT_STAGES}.
   * Naming them explicitly is how a re-run of a failed push will skip
   * re-reading a 40GB tree.
   */
  stages?: readonly ImportStageKindName[];
}

export interface StartRunResult {
  run: ImportRun;
  stages: ImportStage[];
}

/**
 * What a run does when the caller does not say.
 *
 * `push` is deliberately absent until its runner exists. A run that listed a
 * stage nothing can execute would either strand at that stage or "skip" it and
 * report a complete import over data that never reached `ci.*` — and the second
 * is worse, because it looks like success. The kind is already in the schema and
 * in {@link IMPORT_STAGE_WEIGHTS}; it joins this list with its runner.
 */
const DEFAULT_STAGES: readonly ImportStageKindName[] = ['unpack', 'parse'];

/**
 * The run/stage spine: what a person sees while their export imports.
 *
 * Two rules shape everything here.
 *
 * **The stage rows are the truth; the run row is a cache.** `import_runs.status`
 * and `.percent` are derived from the run's stages and recomputed on every
 * transition, because the run list renders dozens of rows per poll and joining
 * every stage of every run to answer "how far along?" is the query that makes a
 * progress bar expensive to look at. Nothing ever reads the cache to decide
 * whether work remains.
 *
 * **A stage that half-worked is not a failure.** A Takeout holding six sources
 * where one parser chokes has imported five of them; rolling that up as `failed`
 * is what teaches people to re-run the whole archive. Such a run ends `partial`,
 * which is terminal and success-ish, and the stage's `detail` carries what was
 * missed.
 */
@Injectable()
export class ImportRunService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly eventService: EventService,
    private readonly stagedSources: StagedSourceService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(ImportRunService.name);
  }

  // -------------------------------------------------------------------------
  // Starting
  // -------------------------------------------------------------------------

  /**
   * Create a run, materialize its stages, claim the drop, and enqueue the first
   * stage.
   *
   * All of it in ONE transaction. The claim is what makes two clicks on
   * "import" produce one run instead of two runs racing for the same bytes, and
   * it can only do that if a lost claim takes the run row with it — otherwise
   * the loser leaves an orphan run pointing at a drop it does not own. The claim
   * cannot come first, because `staged_sources.run_id` is a foreign key into the
   * run that does not exist yet.
   *
   * The enqueue happens AFTER the transaction commits. A job enqueued inside it
   * can be picked up by a worker before the commit lands, and that worker would
   * read no run at all.
   */
  async startRun(ctx: UserServiceContext, input: StartRunInput): Promise<StartRunResult> {
    const kinds = input.stages ?? DEFAULT_STAGES;

    if (kinds.length === 0) {
      throw new ConflictException('A run needs at least one stage');
    }

    const result = await this.dataSource.transaction(async (manager) => {
      const uploads = await manager.query<Array<{ original_filename: string | null; status: string }>>(
        `SELECT original_filename, status
           FROM ci_import.staged_sources
          WHERE user_id = $1::uuid AND drop_id = $2`,
        [ctx.userId, input.dropId],
      );

      if (uploads.length === 0) {
        throw new NotFoundException(`No staged upload ${input.dropId}`);
      }

      // Refusals must tell the truth: an expired upload's bytes are GONE (the
      // purge took them), which is a different answer from "another run beat
      // you to it" — the first means re-upload, the second means look at your
      // runs.
      if (uploads[0].status === 'expired') {
        throw new ConflictException(
          `Upload ${input.dropId} expired before it was imported. Upload the archive again.`,
        );
      }

      const runRows = await manager.query<Array<{ id: string }>>(
        `INSERT INTO ci_import.import_runs (user_id, label, source, status, requested_stages)
              VALUES ($1::uuid, $2, $3, 'queued', $4::text[])
           RETURNING id`,
        [ctx.userId, input.label ?? uploads[0].original_filename, input.source ?? 'wizard', kinds],
      );

      const runId = runRows[0].id;

      // Constrained to `staged`, so the UPDATE is the race guard: the second
      // caller affects no rows and this transaction rolls back, taking its run
      // with it.
      // CTE-wrapped so the OUTER command is a SELECT. TypeORM's Postgres driver
      // special-cases UPDATE/DELETE and resolves `[rows, rowCount]`, so a bare
      // `UPDATE ... RETURNING` hands back an array whose FIRST element is the
      // rows array — making `length === 0` never true. Same trap, and same fix,
      // as `PipelineRunService.finishRun`.
      const claim = await manager.query<unknown[]>(
        `WITH claimed AS (
           UPDATE ci_import.staged_sources
              SET status = 'claimed', run_id = $1::uuid, claimed_at = now(), updated_at = now()
            WHERE user_id = $2::uuid AND drop_id = $3 AND status = 'staged'
        RETURNING id)
         SELECT id FROM claimed`,
        [runId, ctx.userId, input.dropId],
      );

      if (claim.length === 0) {
        throw new ConflictException(`Upload ${input.dropId} has already been claimed by another import run`);
      }

      const stages = await this.materializeStages(manager, runId, kinds);

      const run = await manager.findOneOrFail(ImportRunEntity, { where: { id: runId } });

      return { run, stages };
    });

    await this.enqueueStage(ctx.userId, result.run.id, result.stages[0]);

    this.logger.log('Started import run', {
      runId: result.run.id,
      userId: ctx.userId,
      dropId: input.dropId,
      stages: kinds,
    });

    return result;
  }

  /**
   * Write one `import_stages` row per requested kind.
   *
   * `ON CONFLICT (run_id, seq) DO NOTHING` so materializing is idempotent: a
   * restart between the run insert and this one re-runs it harmlessly rather
   * than duplicating the stage bar.
   */
  private async materializeStages(
    manager: EntityManager,
    runId: string,
    kinds: readonly ImportStageKindName[],
  ): Promise<ImportStage[]> {
    for (const [index, kind] of kinds.entries()) {
      await manager.query(
        `INSERT INTO ci_import.import_stages (run_id, seq, kind, status, weight)
              VALUES ($1::uuid, $2, $3, 'queued', $4)
         ON CONFLICT (run_id, seq) DO NOTHING`,
        [runId, index, kind, IMPORT_STAGE_WEIGHTS[kind]],
      );
    }

    return manager.find(ImportStageEntity, { where: { runId }, order: { seq: 'ASC' } });
  }

  // -------------------------------------------------------------------------
  // Reading
  // -------------------------------------------------------------------------

  async getRun(ctx: UserServiceContext, runId: string): Promise<ImportRun | null> {
    return this.dataSource.getRepository(ImportRunEntity).findOne({
      where: { id: runId, userId: ctx.userId },
    });
  }

  async getStage(stageId: string): Promise<ImportStage | null> {
    return this.dataSource.getRepository(ImportStageEntity).findOne({ where: { id: stageId } });
  }

  async stagesFor(runId: string): Promise<ImportStage[]> {
    return this.dataSource.getRepository(ImportStageEntity).find({ where: { runId }, order: { seq: 'ASC' } });
  }

  // -------------------------------------------------------------------------
  // Transitions
  // -------------------------------------------------------------------------

  /**
   * Mark a stage running.
   *
   * Constrained to `queued`, so a redelivered pg-boss job cannot restart a stage
   * another worker already owns, and the caller learns it lost by getting
   * `false` rather than by trampling a run in flight.
   */
  async beginStage(stageId: string): Promise<boolean> {
    // CTE-wrapped — see the note on the claim in `startRun`. Without it this
    // returns `[[], 0]`, whose length is 2, and every redelivered job would
    // "win" the claim and unpack the same 40GB archive again.
    const rows = await this.dataSource.query<unknown[]>(
      `WITH claimed AS (
         UPDATE ci_import.import_stages
            SET status = 'running', started_at = COALESCE(started_at, now())
          WHERE id = $1::uuid AND status = 'queued'
      RETURNING id)
       SELECT id FROM claimed`,
      [stageId],
    );

    if (rows.length === 0) {
      return false;
    }

    await this.dataSource.query(
      `UPDATE ci_import.import_runs
          SET status = 'running', started_at = COALESCE(started_at, now())
        WHERE id = (SELECT run_id FROM ci_import.import_stages WHERE id = $1::uuid)
          AND finished_at IS NULL`,
      [stageId],
    );

    return true;
  }

  /** Update a running stage's counters. Also refreshes the run's percent cache. */
  async recordProgress(
    stageId: string,
    update: { processed: number; total?: number | null; phase?: string },
  ): Promise<void> {
    await this.dataSource.query(
      `UPDATE ci_import.import_stages
          SET processed = $2,
              total = COALESCE($3, total),
              phase = COALESCE($4, phase),
              items_per_sec = CASE
                WHEN started_at IS NULL THEN items_per_sec
                WHEN EXTRACT(EPOCH FROM (now() - started_at)) <= 0 THEN items_per_sec
                ELSE $2 / EXTRACT(EPOCH FROM (now() - started_at))
              END
        WHERE id = $1::uuid`,
      [stageId, update.processed, update.total ?? null, update.phase ?? null],
    );

    await this.refreshRunRollup(stageId);
  }

  /** Finish a stage that did its work, wholly or partly. */
  async completeStage(stageId: string, outcome: StageOutcome): Promise<void> {
    await this.dataSource.query(
      // Every parameter cast explicitly: `$2` feeds both `processed` and the
      // COALESCE for `total`, and Postgres refuses to deduce one type for a
      // parameter used in two positions ("inconsistent types deduced").
      `UPDATE ci_import.import_stages
          SET status = 'completed',
              processed = $2::bigint,
              total = COALESCE($3::bigint, $2::bigint),
              detail = $4::jsonb,
              finished_at = now(),
              duration_ms = CASE
                WHEN started_at IS NULL THEN duration_ms
                ELSE (EXTRACT(EPOCH FROM (now() - started_at)) * 1000)::bigint
              END
        WHERE id = $1::uuid`,
      [stageId, outcome.processed, outcome.total, JSON.stringify(outcome.detail ?? {})],
    );

    await this.refreshRunRollup(stageId);
  }

  /** Fail a stage, and with it the run. */
  async failStage(stageId: string, error: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE ci_import.import_stages
          SET status = 'failed', error = $2, finished_at = now()
        WHERE id = $1::uuid`,
      [stageId, error],
    );

    await this.dataSource.query(
      `UPDATE ci_import.import_runs
          SET status = 'failed', error = $2, finished_at = now()
        WHERE id = (SELECT run_id FROM ci_import.import_stages WHERE id = $1::uuid)
          AND finished_at IS NULL`,
      [stageId, error],
    );

    // A failed run must never consume its source. Releasing frees an inbox
    // path for a fresh claim and RE-STAGES an upload (fresh TTL, no run) so
    // the file reappears on every surface instead of stranding invisibly;
    // once bytes have moved to scratch, release no-ops and they wait for a
    // retry.
    const runRows = await this.dataSource.query<Array<{ run_id: string }>>(
      `SELECT run_id FROM ci_import.import_stages WHERE id = $1::uuid`,
      [stageId],
    );

    if (runRows.length > 0) {
      await this.stagedSources.release(runRows[0].run_id);
    }

    await this.refreshRunRollup(stageId);
  }

  /**
   * Enqueue the stage after `seq`, or finish the run when there is none.
   *
   * Returns the stage that was enqueued, so a caller (or a test) can tell
   * "moved on" from "that was the last one" without re-reading the run.
   */
  async advance(userId: string, runId: string, afterSeq: number): Promise<ImportStage | null> {
    const next = await this.dataSource.getRepository(ImportStageEntity).findOne({
      where: { runId, status: 'queued' },
      order: { seq: 'ASC' },
    });

    if (next == null || next.seq <= afterSeq) {
      await this.finishRun(runId);

      return null;
    }

    await this.enqueueStage(userId, runId, next);

    return next;
  }

  /**
   * Close a run whose stages are all done, choosing between `completed` and
   * `partial` from what the stages recorded.
   */
  async finishRun(runId: string): Promise<void> {
    const stages = await this.stagesFor(runId);
    const anyPartial = stages.some((stage) => stage.detail?.partial === true);
    const anyFailed = stages.some((stage) => stage.status === 'failed');

    const status = anyFailed ? 'failed' : anyPartial ? 'partial' : 'completed';

    await this.dataSource.query(
      `UPDATE ci_import.import_runs
          SET status = $2, percent = 100, finished_at = now()
        WHERE id = $1::uuid AND finished_at IS NULL`,
      [runId, status],
    );

    // A completed-or-partial run has consumed its staged source: the bytes now
    // live in the corpus, and the moved copy goes with the run's scratch.
    // Placed here rather than in the listener because finishRun is reached by
    // the listener AND the recovery machinery, so a crash between the last
    // stage and close-out still consumes on resume. Idempotent.
    if (status === 'completed' || status === 'partial') {
      await this.stagedSources.markConsumed(runId);
    } else {
      await this.stagedSources.release(runId);
    }

    this.logger.log('Finished import run', { runId, status });
  }

  /**
   * Stop a run the user no longer wants.
   *
   * Only `queued` stages are cancelled. A stage already running owns a worker
   * and a scratch directory, and marking its row `cancelled` underneath it would
   * make the row lie while the work continued — the worker notices the run is
   * cancelled at its next transition and stops there.
   */
  async cancel(ctx: UserServiceContext, runId: string): Promise<boolean> {
    const rows = await this.dataSource.query<unknown[]>(
      `WITH cancelled AS (
         UPDATE ci_import.import_runs
            SET status = 'cancelled', finished_at = now()
          WHERE id = $1::uuid AND user_id = $2::uuid AND finished_at IS NULL
      RETURNING id)
       SELECT id FROM cancelled`,
      [runId, ctx.userId],
    );

    if (rows.length === 0) {
      return false;
    }

    await this.dataSource.query(
      `UPDATE ci_import.import_stages
          SET status = 'cancelled', finished_at = now()
        WHERE run_id = $1::uuid AND status = 'queued'`,
      [runId],
    );

    // Cancelled runs never consume: an inbox claim is released, an upload is
    // re-staged. A source already moved to scratch stays for a retry.
    await this.stagedSources.release(runId);

    this.logger.log('Cancelled import run', { runId, userId: ctx.userId });

    return true;
  }

  /** True once the run has been cancelled or otherwise closed out. */
  async isFinished(runId: string): Promise<boolean> {
    const rows = await this.dataSource.query<Array<{ finished: boolean }>>(
      `SELECT finished_at IS NOT NULL AS finished FROM ci_import.import_runs WHERE id = $1::uuid`,
      [runId],
    );

    return rows.length === 0 || rows[0].finished;
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private async enqueueStage(userId: string, runId: string, stage: ImportStage): Promise<void> {
    await this.eventService.send(
      ImportStageEvent,
      { runId, stageId: stage.id, userId },
      { queue: IMPORT_QUEUE },
    );
  }

  /**
   * Recompute `import_runs.percent` from the run's stages.
   *
   * Weighted by stage, and a stage with no known total contributes its weight
   * only once it completes — an indeterminate stage that guessed at a fraction
   * is how a bar ends up moving backwards when the real total arrives.
   */
  private async refreshRunRollup(stageId: string): Promise<void> {
    await this.dataSource.query(
      `WITH stage AS (
         SELECT run_id FROM ci_import.import_stages WHERE id = $1::uuid
       ),
       rollup AS (
         SELECT s.run_id,
                SUM(s.weight) AS total_weight,
                SUM(
                  s.weight * CASE
                    WHEN s.status IN ('completed', 'skipped') THEN 1.0
                    WHEN s.total IS NULL OR s.total = 0 THEN 0.0
                    ELSE LEAST(s.processed::float / s.total::float, 1.0)
                  END
                ) AS done_weight
           FROM ci_import.import_stages s
          WHERE s.run_id = (SELECT run_id FROM stage)
          GROUP BY s.run_id
       )
       UPDATE ci_import.import_runs r
          SET percent = LEAST(100, GREATEST(0, ROUND(100 * rollup.done_weight / NULLIF(rollup.total_weight, 0))))
         FROM rollup
        WHERE r.id = rollup.run_id
          AND r.finished_at IS NULL`,
      [stageId],
    );
  }
}
