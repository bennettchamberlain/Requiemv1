import { Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';

import { Context, type RequestContext, toServiceContext } from '@ci/common/context';
import { READ_CAPABILITY, RequireCapability, WRITE_CAPABILITY } from '@ci/common/decorators';
import { JwtOrApiKeyAuthGuard } from '@ci/common/guards';
import { ValidationPipe } from '@ci/common/pipes';

import {
  type DeadLetterReplayResult,
  MAX_DEAD_LETTER_PAGE,
  MAX_RUN_PAGE,
  type PipelineDeadLetterView,
  type PipelineRunDetail,
  type PipelineRunSummary,
  PipelineRunService,
} from '../services/PipelineRunService';
import type { StageCoverage } from '../types';

/**
 * A query-string boolean.
 *
 * NOT `z.coerce.boolean()`, which is `Boolean(value)` and therefore maps the
 * string `"false"` to `true` — so `?activeOnly=false` would filter to active
 * runs only, the exact opposite of what it says. An explicit enum makes the
 * accepted spellings reviewable and rejects anything else with a 400 instead of
 * guessing.
 */
const queryBoolean = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1');

const runsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_RUN_PAGE).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  /** Only runs that have not been finalized — i.e. the one this user can't start another past. */
  activeOnly: queryBoolean.optional(),
});

type RunsQuery = z.infer<typeof runsQuerySchema>;

const deadLettersQuerySchema = z.object({
  /**
   * Filter by originating queue. Bound as a parameter, never interpolated, so an
   * arbitrary string is safe; bounded in length only to keep a pathological
   * value out of the query log.
   */
  queue: z.string().min(1).max(128).optional(),

  /** Filter by stage id. Letters from plain queue handlers carry no stage and are excluded by this. */
  stage: z.string().min(1).max(128).optional(),

  /** `true` → only already-replayed, `false` → only the replay queue, absent → both. */
  replayed: queryBoolean.optional(),

  limit: z.coerce.number().int().min(1).max(MAX_DEAD_LETTER_PAGE).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

type DeadLettersQuery = z.infer<typeof deadLettersQuerySchema>;

/** `GET /api/pipeline/state`. */
export interface PipelineStateResponse {
  stages: StageCoverage[];
}

/** `GET /api/pipeline/runs`. */
export interface PipelineRunsResponse {
  runs: PipelineRunSummary[];
}

/** `GET /api/pipeline/dead-letters`. */
export interface PipelineDeadLettersResponse {
  deadLetters: PipelineDeadLetterView[];
}

/**
 * The operator's window onto the pipeline: what has been processed, what is
 * running, what died, and the three buttons that steer it.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 *
 * Until this controller there was NO HTTP surface on this domain at all. The
 * ledger, the runs, the shards and the dead letters were all written and none of
 * them were readable: `IngestStatusService` counts the depth of one pg-boss
 * queue and `JobMonitorService` reads `pgboss.archive`, so neither can say
 * whether any particular row was ever processed — which is how `ci.content` sat
 * at zero embedded rows unnoticed. Every operational question ("is my import
 * finished?", "what failed?", "how do I stop this?") had a psql query for an
 * answer.
 *
 * ── Auth ───────────────────────────────────────────────────────────────────
 *
 * `JwtOrApiKeyAuthGuard` at the class level, matching `MaintenanceController`,
 * the neighbouring operator surface. No `@RequireScopes`: scope enforcement is
 * DENY-BY-DEFAULT, so a scope-limited api key (the memory-scoped chat agent, an
 * MCP key) cannot reach an un-annotated route at all — which is the correct
 * answer for a control plane. Granting it a scope would be the change that
 * opened it up.
 *
 * `@RequireCapability` is the second axis and does apply here, because it also
 * binds empty-scope (legacy, full-access) keys: reads need `read`, and the three
 * control routes plus replay need `write`, so a key the settings UI calls
 * read-only cannot cancel somebody's import. None of these are `full` —
 * `full` is for destructive operations, and nothing here deletes anything.
 *
 * `:id` is not validated in this file: `IdFormatGuard` is registered as a global
 * `APP_GUARD` and 404s any route parameter ending in `id` that is not a uuid, so
 * a malformed id never reaches a `::uuid` cast.
 *
 * ── Scoping ────────────────────────────────────────────────────────────────
 *
 * Every route is user-scoped in the service, by `user_id` in SQL rather than by
 * filtering after the fact. These tables hold verbatim payloads.
 */
@Controller('api/pipeline')
@UseGuards(JwtOrApiKeyAuthGuard)
export class PipelineController {
  constructor(private readonly pipelineRunService: PipelineRunService) {}

  /**
   * Per-stage ledger coverage: `done` / `skipped` / `failed` / `pending`
   * (plus `running`, `quarantined` and `stale`) and the stage's CURRENT version.
   *
   * This is the "is my import finished?" answer that has never existed. Read it
   * with two cautions, both of which the numbers themselves state:
   *
   *  - `total` counts LEDGER ROWS, not eligible source rows. A stage that has
   *    never run reports `total: 0` and `coverage: 0`, which is honest but is
   *    not the same as "0 % of your files". Eligibility needs the stage's source
   *    table and applicability predicate, which is the sweep's business.
   *  - `stale` is what a version bump would re-open: rows recorded below
   *    `stageVersion`, regardless of whether they came out `done`, `skipped` or
   *    `quarantined`. It is the number to look at before bumping a stage that
   *    bills an external provider.
   */
  @Get('state')
  @RequireCapability(READ_CAPABILITY)
  async getState(@Context() context: RequestContext): Promise<PipelineStateResponse> {
    const stages = await this.pipelineRunService.stageState(toServiceContext(context));

    return { stages };
  }

  /** This user's runs, newest first, each with its shard tally. */
  @Get('runs')
  @RequireCapability(READ_CAPABILITY)
  async listRuns(
    @Context() context: RequestContext,
    @Query(new ValidationPipe(runsQuerySchema)) query: RunsQuery,
  ): Promise<PipelineRunsResponse> {
    const runs = await this.pipelineRunService.listRuns(toServiceContext(context), {
      limit: query.limit,
      offset: query.offset,
      activeOnly: query.activeOnly,
    });

    return { runs };
  }

  /**
   * One run, expanded to its shards.
   *
   * The `cursor` on each shard is the keyset position — the last source id
   * handed out. Two reads a minute apart showing the same cursor on a `running`
   * shard is what "stuck" looks like, and `leaseExpired` says whether anything
   * still owns it.
   */
  @Get('runs/:id')
  @RequireCapability(READ_CAPABILITY)
  getRun(@Context() context: RequestContext, @Param('id') runId: string): Promise<PipelineRunDetail> {
    return this.pipelineRunService.getRun(toServiceContext(context), runId);
  }

  /**
   * Stop planning new work; let in-flight slices drain.
   *
   * Writes `desired_state` only. Nothing reaches into pg-boss to delete queued
   * jobs — that operation always races a worker that has already claimed one.
   * The control tick reads the intent between batches, so the effect is visible
   * within roughly one slice rather than instantly, and a 200 here means "the
   * intent is recorded", not "everything has stopped".
   */
  @Post('runs/:id/pause')
  @HttpCode(200)
  @RequireCapability(WRITE_CAPABILITY)
  pauseRun(@Context() context: RequestContext, @Param('id') runId: string): Promise<PipelineRunSummary> {
    return this.pipelineRunService.setDesiredState(toServiceContext(context), runId, 'paused');
  }

  /** Resume a paused run. Refused on a cancelled one — cancel is one-way. */
  @Post('runs/:id/resume')
  @HttpCode(200)
  @RequireCapability(WRITE_CAPABILITY)
  resumeRun(@Context() context: RequestContext, @Param('id') runId: string): Promise<PipelineRunSummary> {
    return this.pipelineRunService.setDesiredState(toServiceContext(context), runId, 'running');
  }

  /**
   * Cancel a run.
   *
   * Records the intent; the control tick marks shards cancelled and FINALIZES
   * the run. The run therefore stays active — `finishedAt` null, so this user
   * cannot start another one — until that happens, which is the schema's own
   * contract ("a cancelled run stays active until a worker finalizes it") and
   * what stops a cancel from orphaning in-flight batches.
   */
  @Post('runs/:id/cancel')
  @HttpCode(200)
  @RequireCapability(WRITE_CAPABILITY)
  cancelRun(@Context() context: RequestContext, @Param('id') runId: string): Promise<PipelineRunSummary> {
    return this.pipelineRunService.setDesiredState(toServiceContext(context), runId, 'cancelled');
  }

  /**
   * Dead letters, newest first, filterable by queue and stage.
   *
   * Each row carries its payload verbatim and its full error. That is what makes
   * the list usable and is also why the page is small — see
   * `MAX_DEAD_LETTER_PAGE`.
   */
  @Get('dead-letters')
  @RequireCapability(READ_CAPABILITY)
  async listDeadLetters(
    @Context() context: RequestContext,
    @Query(new ValidationPipe(deadLettersQuerySchema)) query: DeadLettersQuery,
  ): Promise<PipelineDeadLettersResponse> {
    const deadLetters = await this.pipelineRunService.listDeadLetters(toServiceContext(context), {
      queue: query.queue,
      stage: query.stage,
      replayed: query.replayed,
      limit: query.limit,
      offset: query.offset,
    });

    return { deadLetters };
  }

  /**
   * Re-emit one dead letter's preserved payload and stamp `replayed_at`.
   *
   * The payload goes back on the bus BYTE FOR BYTE — payload fidelity is the
   * whole reason the reaper stores it verbatim rather than logging a summary,
   * and this is the endpoint that cashes that in. 409 when the letter has
   * already been replayed (`replayed_at` is the idempotency flag that keeps a
   * replay-all from looping) and 400 when it carries no event name to re-emit
   * under.
   */
  @Post('dead-letters/:id/replay')
  @HttpCode(200)
  @RequireCapability(WRITE_CAPABILITY)
  replayDeadLetter(
    @Context() context: RequestContext,
    @Param('id') letterId: string,
  ): Promise<DeadLetterReplayResult> {
    return this.pipelineRunService.replayDeadLetter(toServiceContext(context), letterId);
  }
}
