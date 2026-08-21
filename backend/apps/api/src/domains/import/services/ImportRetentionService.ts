import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { LoggerService } from '@ci/common/logging';
import config from '@ci/configuration';

import { FILE_CLASSIFICATIONS } from '../push/canonical';

import { pushableRunSql, unstoredMediaExistsSql } from './ImportRunService';
import { ImportScratchService } from './ImportScratchService';
import { SOURCE_STATUSES_SPENT_WITH_RUN } from './StagedSourceService';

/**
 * The run states from which no further work can start on its own.
 *
 * `partial` belongs here: it is a terminal SUCCESS-ish state — an export whose
 * sixth parser choked still imported the other five — and excluding it would
 * mean the most common outcome of a large multi-source Takeout is the one that
 * never reclaims. `queued` and `running` are absent by construction.
 *
 * Terminal status is NECESSARY but never SUFFICIENT: `import_runs.status` is a
 * derived cache over `import_stages` (see the class note on
 * `ImportRunService`), so every predicate below also asks the stage rows.
 */
const TERMINAL_RUN_STATUSES = ['completed', 'failed', 'partial', 'cancelled'] as const;

/** A stage in either of these has work that has not finished. */
const LIVE_STAGE_STATUSES = ['queued', 'running'] as const;

/** The staging tables the payload sweep empties, in cascade-safe order. */
const PAYLOAD_TABLES = ['staged_items', 'staged_entities'] as const;

type PayloadTable = (typeof PAYLOAD_TABLES)[number];

/** One run the sweep is considering, with enough context to log about it. */
interface RetentionCandidate {
  readonly id: string;
  readonly userId: string;
  readonly label: string | null;
  readonly status: string;
  readonly finishedAt: Date | null;
}

export interface RetentionSweepResult {
  /** Runs whose `staged_*` payload was deleted but whose history was kept. */
  readonly payloadPurgedRuns: number;
  /** Staged rows deleted by the payload sweep and the history sweep together. */
  readonly stagedRowsDeleted: number;
  /** `import_runs` rows deleted (each cascading its stages and any remainder). */
  readonly runsDeleted: number;
  /** `staged_sources` rows retired with those runs — the ones SET NULL would have orphaned. */
  readonly sourceRowsDeleted: number;
  /** Runs the sweep declined to touch, keyed by the reason it declined. */
  readonly skipped: Readonly<Record<string, number>>;
}

/**
 * Bound `ci_import`.
 *
 * ### The gap this closes
 *
 * `staged_items` / `staged_entities` / `staged_relationships` all reference
 * `import_runs(id) ON DELETE CASCADE`, and the schema header calls staging "a
 * scratchpad for one run, not a second copy of the user's data". Nothing
 * deleted a run outside tests: no cron, no `DELETE` route, no non-test
 * `DELETE FROM ci_import.*`. `StagedUploadPurgeCron` reclaims upload BYTES and
 * stamps their rows `expired` rather than removing them; completion-time
 * cleanup is filesystem-only
 * (`ImportStageListener` → `ImportScratchService.reclaim`). So every parsed
 * record's staging row — its metadata JSONB, its original location, its
 * content hash — outlived the `ci.*` row it produced, permanently, and the
 * only thing that removed it was deleting the user's account.
 *
 * ### Two windows, because staging and history are not the same thing
 *
 * Measured on a dev appliance that imported one real Google Takeout three
 * times: `ci_import` 1678 MB against ci.*'s 1274 MB — the scratchpad was
 * larger than the durable data it produced, and 56% of the database.
 * `staged_items` was 1578 MB over 1.94M rows (852 bytes per parsed record with
 * indexes; one 780,946-item run ≈ 640 MB). `import_runs` + `import_stages` for
 * the same 24 runs: 240 kB total.
 *
 * The import UI reads the cheap half and never the expensive one — the run
 * list, the stage bar, `import_stages.detail->>'pushed'` for the record count
 * (`ImportRunService.recordsFor`), `declared_sources` for the picker's
 * "imported ✓". Not one of those touches a `staged_*` row. So history can
 * survive the payload it describes, and the two get windows three orders of
 * magnitude apart in cost: `stagingDays` (7) for the scratchpad,
 * `runHistoryDays` (90) for the audit trail.
 *
 * ### What is never taken
 *
 * The TTL is the disk dial. The safety is the eligibility predicate, and it
 * holds at any TTL, including 0:
 *
 *  - **Nothing in flight.** Terminal status, `finished_at` set and older than
 *    the cutoff, `updated_at` older than the cutoff, and NO stage in `queued`
 *    or `running`. The status column is a cache; the stage rows are the truth.
 *  - **Nothing resumable.** A run with any `pending` staged row is what the
 *    Sync card offers and `startPush` acts on; a run with any `failed` staged
 *    row is what `ImportRunService.retryFailedPush` exists for. Either
 *    one keeps its payload — deleting it would turn a recoverable import into
 *    a silent no-op. A `failed`-row run still reclaims, whole, at
 *    `runHistoryDays`; a still-pushable one never does, per below.
 *  - **Nothing whose bytes are only on disk.** The unstored-media invariant
 *    (`unstoredMediaExistsSql`, shared verbatim with
 *    `ImportRunService.hasUnstoredMedia`) is what stops a scratch tree being
 *    reclaimed while a staged media row's photo lives only inside it.
 *    Deleting that row would answer the question `false` forever after, which
 *    is how the bytes get destroyed. Both candidate queries exclude such runs,
 *    and the sweep reports them by count so a pinned-open run is a signal
 *    rather than an absence.
 *  - **Nothing that still has a scratch tree.** `ImportStageListener`
 *    deliberately KEEPS the tree for a run that staged no records — for an
 *    inbox unit that tree is the user's only copy, acquired by rename. The
 *    tree's path is `<scratchDir>/<userId>/<runId>`, so the run row is the
 *    only index into it: delete the row and the archive is unattributable
 *    forever. Both passes skip such runs and log the directory.
 *  - **No source row that still names bytes.** The history sweep does take a
 *    retired run's `staged_sources` rows — `ON DELETE SET NULL` would otherwise
 *    orphan one per completed run forever — but only the spent ones. A `staged`
 *    or `claimed` row's archive is sitting in the uploads directory this
 *    second, so it survives its run. See
 *    {@link ImportRetentionService.retireRun}.
 *
 * ### The one thing age alone never takes
 *
 * A run that PARSED but was never PUSHED is kept whole, forever, at any TTL.
 * `ImportRunService.pushableRunSql` is the Sync card's offer; the history sweep
 * negates that same expression, so the two can never disagree about whether a
 * payload is still wanted.
 *
 * This is a deliberate unbounded exception, not an omission, and the reasoning
 * is that by the time the history window elapses those staged rows are the ONLY
 * copy of the parse: the scratch tree was reclaimed at completion and the
 * uploaded archive was purged at 24h by `StagedUploadPurgeCron`. The two
 * alternatives are both worse. Deleting the payload leaves the Sync card
 * offering a push over nothing — a live button in front of destroyed data.
 * Expiring the OFFER at the same age silently discards a finished parse the
 * user could still complete for free, which is the same data loss with a
 * tidier UI.
 *
 * So the payload waits for a decision only a person can make (push it, or
 * delete the run), and every sweep reports it under `push_pending` so an
 * exception that never expires is at least never invisible.
 *
 * Deletes are batched per run rather than issued as one statement, because one
 * statement here is a 780k-row transaction on the appliance's only database.
 */
@Injectable()
export class ImportRetentionService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly scratch: ImportScratchService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(ImportRetentionService.name);
  }

  /**
   * One nightly pass: reclaim drained payload, then expire old history.
   *
   * Payload first. A run old enough for both windows has its `staged_*` rows
   * deleted in bounded batches by the first pass, so the `DELETE` the second
   * pass issues against `import_runs` cascades over almost nothing.
   */
  async sweep(now: Date = new Date()): Promise<RetentionSweepResult> {
    const { enabled, stagingDays, runHistoryDays, maxRunsPerSweep } = config.import.retention;

    if (!enabled) {
      return {
        payloadPurgedRuns: 0,
        stagedRowsDeleted: 0,
        runsDeleted: 0,
        sourceRowsDeleted: 0,
        skipped: {},
      };
    }

    const skipped: Record<string, number> = {};
    const skip = (reason: string, candidate: RetentionCandidate, detail?: object): void => {
      skipped[reason] = (skipped[reason] ?? 0) + 1;
      this.logger.warn('Import retention skipped a run', {
        reason,
        runId: candidate.id,
        userId: candidate.userId,
        label: candidate.label,
        ...detail,
      });
    };

    let stagedRowsDeleted = 0;
    let payloadPurgedRuns = 0;

    // Before anything is deleted, say what CANNOT be. A run whose media never
    // reached MediaStage is pinned open until someone runs it, and it is
    // excluded from both candidate queries — so without this it would be
    // silently absent from the sweep forever rather than reported as stuck.
    for (const candidate of await this.mediaBlockedRuns(cutoff(now, stagingDays), maxRunsPerSweep)) {
      skip('unstored_media', candidate, {
        message:
          'Staged media rows still carry bytes that only exist in this run’s scratch tree, so its ' +
          'staging cannot be reclaimed. Run the media stage for this run.',
      });
    }

    for (const candidate of await this.drainedRuns(cutoff(now, stagingDays), maxRunsPerSweep)) {
      const blocked = await this.blockedByBytes(candidate, skip);

      if (blocked) {
        continue;
      }

      const deleted = await this.deletePayload(candidate.id);

      stagedRowsDeleted += deleted;
      payloadPurgedRuns += 1;

      this.logger.log('Reclaimed import staging for a drained run', {
        runId: candidate.id,
        userId: candidate.userId,
        label: candidate.label,
        status: candidate.status,
        finishedAt: candidate.finishedAt,
        stagedRowsDeleted: deleted,
      });
    }

    let runsDeleted = 0;
    let sourceRowsDeleted = 0;
    const historyCutoff = cutoff(now, runHistoryDays);

    // Same reason as the media report above: these runs are kept FOREVER, and
    // an exception nobody can see is one nobody will ever resolve.
    for (const candidate of await this.pushableRuns(historyCutoff, maxRunsPerSweep)) {
      skip('push_pending', candidate, {
        message:
          'This run parsed but was never pushed, so its staged rows are the only copy of that parse ' +
          'and the Sync card is still offering them. Sync it — that is the only way this payload ' +
          'is ever reclaimed, because nothing deletes a run on the user’s behalf.',
      });
    }

    for (const candidate of await this.expiredRuns(historyCutoff, maxRunsPerSweep)) {
      const blocked = await this.blockedByBytes(candidate, skip);

      if (blocked) {
        continue;
      }

      // Whatever the payload sweep declined to take (a run that kept `failed`
      // rows for a retry nobody ran) goes now, in the same bounded batches, so
      // the run delete itself cascades over an empty tail.
      stagedRowsDeleted += await this.deletePayload(candidate.id);

      const sourcesRetired = await this.retireRun(candidate.id);

      sourceRowsDeleted += sourcesRetired;
      runsDeleted += 1;

      this.logger.log('Expired an import run past the history window', {
        runId: candidate.id,
        userId: candidate.userId,
        label: candidate.label,
        status: candidate.status,
        finishedAt: candidate.finishedAt,
        sourceRowsDeleted: sourcesRetired,
      });
    }

    if (payloadPurgedRuns > 0 || runsDeleted > 0 || Object.keys(skipped).length > 0) {
      this.logger.log('Import retention sweep finished', {
        payloadPurgedRuns,
        stagedRowsDeleted,
        runsDeleted,
        sourceRowsDeleted,
        skipped,
        stagingDays,
        runHistoryDays,
      });
    }

    return { payloadPurgedRuns, stagedRowsDeleted, runsDeleted, sourceRowsDeleted, skipped };
  }

  /**
   * Delete a run and the source rows that only ever described it.
   *
   * `import_runs` cascades to `import_stages` and every `staged_*` table, but
   * `staged_sources.run_id` is `ON DELETE SET NULL` — so the history sweep used
   * to blank the run id and leave the registry row standing. Nothing collects
   * it afterwards: `releaseUpload` is a user action, `purgeExpired` only reads
   * `origin = 'upload' AND status = 'staged'`, and `sweepUploadOrphans`
   * reclaims BYTES from the uploads directory, never rows. One row per
   * completed run and one per released inbox claim therefore accumulated with
   * no upper bound, which is the half of "bound `ci_import`" the run delete
   * alone did not meet.
   *
   * CASCADE would be the wrong repair. The SET NULL is what stops a run delete
   * taking the registry row of bytes that still exist, so the fix is a
   * predicate, not a constraint change: only the statuses in
   * {@link SOURCE_STATUSES_SPENT_WITH_RUN} — `consumed`, `moved`, `released`,
   * `expired` — go with the run. A `staged` or `claimed` row names bytes at
   * `source_path` right now (an upload the user still holds), so it survives
   * with a null run id exactly as before, and the uploads-dir orphan sweep
   * stays its backstop.
   *
   * Both deletes in one transaction. A source row whose run vanished between
   * the two statements has already lost the only thing that identifies it, so
   * they must not be separable.
   *
   * Returns the number of source rows retired.
   */
  private async retireRun(runId: string): Promise<number> {
    return this.dataSource.transaction(async (manager) => {
      // CTE-wrapped so the outer command is a SELECT, for the same driver
      // reason as `deleteBatched` below.
      const [row] = await manager.query<Array<{ deleted: number }>>(
        `WITH gone AS (
           DELETE FROM ci_import.staged_sources
            WHERE run_id = $1::uuid AND status = ANY($2::text[])
          RETURNING id
         )
         SELECT count(*)::int AS deleted FROM gone`,
        [runId, [...SOURCE_STATUSES_SPENT_WITH_RUN]],
      );

      await manager.query(`DELETE FROM ci_import.import_runs WHERE id = $1::uuid`, [runId]);

      return row?.deleted ?? 0;
    });
  }

  /**
   * The one guard SQL cannot express: does this run still own a scratch tree?
   *
   * `stat`, not a query, which is why it is here and not in the candidate
   * predicate — and why it is the one skip that can consume a sweep's budget.
   * Acceptable because it is rare and loud: `ImportStageListener` keeps a tree
   * only for a run that staged no records, and every such run logs a warning
   * naming the directory. The unstored-media case, which is neither rare nor
   * self-clearing, is filtered in SQL instead.
   *
   * Returns true when the run must be left alone.
   */
  private async blockedByBytes(
    candidate: RetentionCandidate,
    skip: (reason: string, candidate: RetentionCandidate, detail?: object) => void,
  ): Promise<boolean> {
    if (await this.scratch.exists(candidate.userId, candidate.id)) {
      skip('scratch_tree_present', candidate, {
        scratchDir: this.scratch.dirFor(candidate.userId, candidate.id),
        message:
          'The run still owns a scratch tree, so its row is the only index into those bytes. ' +
          'Reclaim or move the tree before this run can be retired.',
      });

      return true;
    }

    return false;
  }

  /**
   * Terminal runs, past the staging window, with a payload and nothing left to
   * do with it.
   *
   * `updated_at` is checked alongside `finished_at` so a run touched recently
   * for any reason — a rollup refresh, a reopen that lost its race — falls out
   * of the window it would otherwise sit inside.
   *
   * The unstored-media guard is applied HERE, inside the query, rather than in
   * TypeScript after the fact. A run whose media never reached `MediaStage` is
   * blocked until an operator acts, and — being old — it sorts to the FRONT of
   * this queue: filtering it after the `LIMIT` would let one stuck run consume
   * every sweep's budget and silently starve every run behind it.
   * {@link ImportRetentionService.mediaBlockedRuns} reports them separately so
   * excluding them here does not also make them invisible.
   */
  private async drainedRuns(cutoffAt: Date, limit: number): Promise<RetentionCandidate[]> {
    return this.selectRuns(
      `${TERMINAL_AND_QUIET}
       AND (EXISTS (SELECT 1 FROM ci_import.staged_items i WHERE i.run_id = r.id)
         OR EXISTS (SELECT 1 FROM ci_import.staged_entities e WHERE e.run_id = r.id))
       AND NOT EXISTS (
             SELECT 1 FROM ci_import.staged_items i
              WHERE i.run_id = r.id AND i.push_status IN ('pending', 'failed'))
       AND NOT EXISTS (
             SELECT 1 FROM ci_import.staged_entities e
              WHERE e.run_id = r.id AND e.push_status IN ('pending', 'failed'))
       AND NOT ${unstoredMediaExistsSql('r.id', '$5')}`,
      cutoffAt,
      limit,
    );
  }

  /**
   * Terminal runs past the history window.
   *
   * The backstop: a run that kept `failed` staged rows for a retry that never
   * came is exactly what it is for — that payload is reachable only through
   * `retryFailedPush`, which the user has had the whole window to click.
   *
   * But NOT a run whose payload is still PUSHABLE. `NOT pushableRunSql` is the
   * exact complement of what the Sync card offers, shared verbatim with it, so
   * this sweep cannot delete rows the card is still promising to push — see the
   * "never collected at all" note on the class.
   */
  private async expiredRuns(cutoffAt: Date, limit: number): Promise<RetentionCandidate[]> {
    return this.selectRuns(
      `${TERMINAL_AND_QUIET}
       AND NOT ${pushableRunSql('r')}
       AND NOT ${unstoredMediaExistsSql('r.id', '$5')}`,
      cutoffAt,
      limit,
    );
  }

  /**
   * Terminal runs past the history window that {@link expiredRuns} refuses
   * because their parse has never been pushed. The complement of the guard it
   * applies — reported, by the same rule as the media-blocked runs, so an
   * unbounded exception is a standing signal rather than a silent absence.
   */
  private async pushableRuns(cutoffAt: Date, limit: number): Promise<RetentionCandidate[]> {
    return this.selectRuns(
      `${TERMINAL_AND_QUIET}
       AND ${pushableRunSql('r')}
       AND NOT ${unstoredMediaExistsSql('r.id', '$5')}`,
      cutoffAt,
      limit,
    );
  }

  /**
   * Terminal runs past the staging window that BOTH sweeps refuse, because
   * their staged media rows are the only record of bytes sitting in a scratch
   * tree. The complement of the guard both candidate queries apply — reported
   * so a stuck run is a signal rather than an absence.
   */
  private async mediaBlockedRuns(cutoffAt: Date, limit: number): Promise<RetentionCandidate[]> {
    return this.selectRuns(
      `${TERMINAL_AND_QUIET} AND ${unstoredMediaExistsSql('r.id', '$5')}`,
      cutoffAt,
      limit,
    );
  }

  /**
   * Every caller's `where` must reference all five parameters — Postgres
   * rejects a bind list longer than the statement's highest `$n`, so `$5` (the
   * file classifications) is not optional here. That is a constraint worth
   * having: it is what stops a new sweep being added that forgets the
   * unstored-media guard.
   */
  private async selectRuns(where: string, cutoffAt: Date, limit: number): Promise<RetentionCandidate[]> {
    const rows = await this.dataSource.query<
      Array<{ id: string; userId: string; label: string | null; status: string; finishedAt: Date | null }>
    >(
      `SELECT r.id, r.user_id AS "userId", r.label, r.status, r.finished_at AS "finishedAt"
         FROM ci_import.import_runs r
        WHERE ${where}
        ORDER BY r.finished_at ASC
        LIMIT $4`,
      [cutoffAt, [...TERMINAL_RUN_STATUSES], [...LIVE_STAGE_STATUSES], limit, [...FILE_CLASSIFICATIONS]],
    );

    return rows;
  }

  /**
   * Delete one run's staged rows in bounded batches.
   *
   * Items before entities: `staged_relationships` cascades from both, and
   * `entity_mappings` from `staged_entities`, so emptying items first leaves
   * the entity pass with the smallest possible fan-out.
   *
   * The table name is interpolated because it is a literal from
   * {@link PAYLOAD_TABLES} and Postgres takes no parameter in that position;
   * the run id and the batch size are bound. The statement is CTE-wrapped so
   * the outer command is a SELECT — a bare `DELETE … RETURNING` resolves as
   * `[rows, rowCount]` through this driver, the same reason every write in
   * `ImportRunService` is shaped this way.
   */
  private async deletePayload(runId: string): Promise<number> {
    let total = 0;

    for (const table of PAYLOAD_TABLES) {
      total += await this.deleteBatched(table, runId);
    }

    return total;
  }

  private async deleteBatched(table: PayloadTable, runId: string): Promise<number> {
    const batchSize = config.import.retention.deleteBatchSize;
    let total = 0;

    for (;;) {
      const [row] = await this.dataSource.query<Array<{ deleted: number }>>(
        `WITH doomed AS (
           SELECT id FROM ci_import.${table} WHERE run_id = $1::uuid LIMIT $2
         ), gone AS (
           DELETE FROM ci_import.${table} t USING doomed d WHERE t.id = d.id RETURNING t.id
         )
         SELECT count(*)::int AS deleted FROM gone`,
        [runId, batchSize],
      );

      const deleted = row?.deleted ?? 0;

      total += deleted;

      if (deleted < batchSize) {
        return total;
      }
    }
  }
}

/**
 * `$1` = cutoff, `$2` = terminal statuses, `$3` = live stage statuses.
 *
 * Shared VERBATIM by both sweeps so the payload window and the history window
 * can never disagree about what "finished" means — the same reason
 * `PUSH_ELIGIBLE_WHERE` is one constant in `ImportRunService`.
 */
const TERMINAL_AND_QUIET = `
      r.status = ANY($2::text[])
  AND r.finished_at IS NOT NULL
  AND r.finished_at < $1::timestamptz
  AND r.updated_at < $1::timestamptz
  AND NOT EXISTS (
        SELECT 1 FROM ci_import.import_stages s
         WHERE s.run_id = r.id AND s.status = ANY($3::text[]))`;

function cutoff(now: Date, days: number): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}
