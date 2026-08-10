import { randomBytes } from 'node:crypto';

import { Test, type TestingModule } from '@nestjs/testing';
import { DataSource, type QueryRunner } from 'typeorm';

import type { UserServiceContext } from '@ci/common/context';
import { LoggerService } from '@ci/common/logging';
import { EventService } from '@ci/domains/events';

import { DEFAULT_SLICE_SIZE, MAX_SLICES_PER_SWEEP } from '../constants';
import type { PipelineRunDesiredState } from '../entities/PipelineRunEntity';
import { PipelineSliceEvent, PipelineSweepEvent } from '../events';
import { PipelineSliceListener } from '../listeners/PipelineSliceListener';
import { PipelineDispatchService } from '../services/PipelineDispatchService';
import { PipelineRunService } from '../services/PipelineRunService';
import { PipelineStateService } from '../services/PipelineStateService';
import { STAGE_REGISTRY, StageRegistry } from '../services/StageRegistry';
import { TemporalRepairStage } from '../stages/clean/TemporalRepairStage';
import { ObjectPromoteStage } from '../stages/promote/ObjectPromoteStage';
import type { Stage, StageCoverage } from '../types';
import { STAGE_VERSIONS } from '../versions';

import { HarnessQueue, databaseAvailability, resolveConnection } from './harness/pipelineHarness';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * THE LOOP. Does the pipeline actually run, unattended, on the real archive?
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Everything under `domains/pipeline` was complete and INERT. Twelve stages are
 * declared, bound and resolving; `PipelineDispatchService.startSweep()` works;
 * `PipelineSliceListener` executes slices; `PipelineRunService` manages runs.
 * **Nothing called any of it.** There is no cron, no scheduled caller and no
 * controller route that reaches `startSweep`; the only `@Cron` in the domain is
 * the dead-letter reaper. `ci.pipeline_runs` has never held a row and
 * `ci.pipeline_state` is empty on the appliance this file was written against.
 *
 * The other suites in this directory each prove one piece:
 *
 *  - `pipeline.integration.spec.ts` — the ledger transitions and the keyset
 *    chain, over a throwaway table this repo seeded itself.
 *  - `realData.integration.spec.ts` — the PLAN of the staleness sweep against
 *    324,044 real events. One query, measured; no loop.
 *  - `PipelineSliceListener.spec.ts` — one slice, against fakes.
 *
 * None of them answers the operational question, which is whether a run that is
 * started and then left alone converges, stops, comes back when a version is
 * bumped, and can be paused and resumed without losing its place — on the
 * operator's own data, at the operator's own scale. That is what this file
 * measures, and the numbers it prints are the deliverable.
 *
 * ── The tick ───────────────────────────────────────────────────────────────
 *
 * The tick is defined HERE, as {@link ControlLoop.tick}, out of the pieces that
 * exist independently of any scheduler. It is deliberately the smallest thing
 * that can be called a control loop, and every line of it is the rebuild plan's
 * own contract (§9.1-§9.3):
 *
 *   1. read `ci.pipeline_runs.desired_state` — the CONTROL channel;
 *   2. `paused` / `cancelled` ⇒ plan nothing, touch nothing, return;
 *   3. read the keyset `cursor` from `ci.pipeline_shards` — THE CHECKPOINT;
 *   4. one `PipelineDispatchService.runSweepHop` from that cursor;
 *   5. work the slices it enqueued through the real `PipelineSliceListener`;
 *   6. write the advanced cursor back to the shard.
 *
 * Owning the tick is what makes the loop OBSERVABLE: a test that handed control
 * to a cron could assert that something happened, but not that a paused tick
 * dispatched nothing, that a converged tick dispatched nothing five times
 * running, or that a resumed tick started at exactly the cursor the paused one
 * left. Those are the assertions, and they need the tick to be a function.
 *
 * ── Where this DIVERGES from the shipped `PipelineControlService` ──────────
 *
 * That service was written in parallel with this file and lands beside it. The
 * two agree on everything §1-§5 asserts; they differ in ONE place, deliberately
 * documented here rather than smoothed over:
 *
 *  - **The cursor of record.** This tick stores the keyset position in
 *    `ci.pipeline_shards.cursor` and resumes from it.
 *    `PipelineControlService.claimStageShard` leaves that column NULL on purpose
 *    ("a Phase-1 sweep carries its keyset position in `pgboss.job.data`") and
 *    uses the shard row as a LEASE, calling `startSweep` — which restarts from
 *    cursor null every time. Both are correct, because the LEDGER is what makes
 *    a restart cheap: the anti-join steps over the finished prefix, and §5 here
 *    proves the stronger of the two properties (resume is exact even when the
 *    queued sweep jobs are gone). The weaker one costs a re-scan of the prefix
 *    per resume; on a converged 324k corpus that is one indexed anti-join per
 *    hop, measured in §6.
 *  - **Re-arming after convergence.** This tick re-arms a drained shard in place
 *    when the head goes stale (§4). The service instead FINALISES the run, which
 *    releases `pipeline_runs_active_uniq`, and a later tick opens a fresh one.
 *    Same observable behaviour — a version bump is picked up with no operator
 *    action — reached from opposite directions.
 *
 * ── What is real ───────────────────────────────────────────────────────────
 *
 * REAL: Postgres, and the operator's 324,044 imported events. `PipelineRunService`
 * (start, desired state, coverage), `PipelineStateService` (every statement),
 * `PipelineDispatchService.runSweepHop` (the keyset chain and its cursor-advance
 * assertion), `StageRegistry` (including its consistency guards),
 * `PipelineSliceListener` (claim → run → reconcile → complete), and TWO REAL
 * DECLARED STAGES doing their real work:
 *
 *  - `ObjectPromoteStage` — 2,777 real commerce events → real `ci.inventory`
 *    rows. Postgres-only, no provider, no bill. Small enough to drive to
 *    CONVERGENCE, which is what §2-§5 need.
 *  - `TemporalRepairStage` — all 324,044 real events. Used for the scale
 *    measurement in §6.
 *
 * FAKE: pg-boss, replaced by {@link HarnessQueue}; and the stage IDS, which are
 * throwaway (`test.loop_<hex>`). The id is only the third component of the
 * ledger's primary key — the source table, the applicability predicate, the SQL
 * and the `run()` body are the real stage's, unmodified. Two reasons for the
 * throwaway id, both borrowed from `realData.integration.spec.ts`: a leak from
 * this file is then trivially identifiable, and the stage version becomes a
 * plain mutable integer, which is what §4 needs. The real stages derive their
 * versions from a constant that THROWS if `STAGE_VERSIONS` disagrees, so they
 * cannot be bumped from a test — in production a bump is a commit plus a
 * restart, and the getter here is the honest model of that.
 *
 * NOT EXERCISED, and this is the one thing this file cannot prove: no metered
 * stage runs. `enrich.geocode` (95 real candidates) and
 * `enrich.position_reverse` egress through Portal to a paid provider, and
 * `index.embed` shares the one host Ollama process with interactive chat, HBPE
 * and the summary sidecar. Driving either in a test would be a bill or a
 * user-visible stall. The loop is stage-agnostic — one dispatcher, one worker,
 * one ledger — so what is proven here holds for them; what is NOT proven is
 * their `run()` bodies, which have their own specs.
 *
 * ── Why nothing here can touch the operator's data ─────────────────────────
 *
 * Same discipline as `realData.integration.spec.ts` and
 * `DeadLetterReaperListener.spec.ts`, and it has to be stronger here because
 * this file WRITES USER TABLES: `ci.inventory` (promote) and `ci.events`
 * (temporal repair). Every statement is funnelled through a single
 * {@link QueryRunner} inside a transaction that is **ALWAYS rolled back**.
 * Nothing is committed, no other session can observe any of it, there is nothing
 * to clean up, and a `kill -9` mid-run leaves the database untouched because the
 * aborted transaction takes the lot with it. {@link fingerprint} is taken from a
 * connection OUTSIDE every transaction before the first test and again after the
 * last, over `ci.events`, `ci.inventory`, `ci.pipeline_state`,
 * `ci.pipeline_runs` and `ci.pipeline_shards`, and the suite fails if any of
 * them moved.
 *
 * ── Skipping ───────────────────────────────────────────────────────────────
 *
 * SKIPPED, not failed, when no Postgres is reachable — decided synchronously at
 * collection time; see `harness/README.md`. A database that is reachable but
 * un-migrated FAILS, naming the fix.
 */

const availability = databaseAvailability();

const describeWithDatabase = availability.available ? describe : describe.skip;

if (!availability.available) {
  // Printed once per run so a skipped suite is never mistaken for a passing one.
  console.warn(`[enrichmentLoop.integration] SKIPPED — ${availability.reason}`);
}

// A dozen ticks over a real corpus, each doing five slices of real work, plus a
// scale section against 324,044 rows. Jest's 5 s default is not a budget worth
// having a flake over.
jest.setTimeout(900_000);

// ---------------------------------------------------------------------------
// What the loop is pointed at
// ---------------------------------------------------------------------------

/** Ledger `entity_type` for every row this suite writes. Both stages use it. */
const ENTITY_TYPE = 'event';

/**
 * Stage-id prefix. Greppable, and the key the final "did we leak?" check uses.
 * The suffix is random per run so two developers running this at once cannot
 * collide on `ci.pipeline_state`'s `(entity_type, entity_id, stage)` primary key.
 */
const STAGE_PREFIX = 'test.loop_';

/** Ids one tick can dispatch: one sweep hop's worth. 5 × 200 = 1,000. */
const IDS_PER_TICK = MAX_SLICES_PER_SWEEP * DEFAULT_SLICE_SIZE;

/**
 * Ticks §6 runs against the full 324k corpus.
 *
 * Three, not one: the first pays for a cold cache and an empty-ledger plan, and
 * a single sample of anything is an anecdote. Deliberately small — §6 measures
 * the cost of a tick and PROJECTS the convergence, it does not drive 324 ticks
 * inside a transaction holding row locks on the operator's timeline.
 */
const SCALE_TICKS = 3;

/**
 * Ledger rows §6 fast-forwards to before measuring a WARM tick.
 *
 * A third of the corpus, in sweep order, so the ledger looks like a run that was
 * interrupted a third of the way through — which is the state a re-sweep of a
 * converging appliance lives in permanently, and the state an empty-ledger
 * benchmark reports nothing about. Sized against the same trade-off
 * `realData.integration.spec.ts` makes at 50,000: big enough that the planner's
 * statistics change, small enough that the dead tuples the rollback leaves for
 * autovacuum are a nuisance rather than an incident.
 */
const PRELOADED_LEDGER_ROWS = 100_000;

/**
 * Ceiling on one tick, whatever the plan. Deliberately loose: a tripwire for a
 * catastrophic regression (a lost index, a reintroduced LEFT JOIN), not a
 * performance budget. The measured numbers are logged, which is where the
 * performance conversation belongs.
 */
const TICK_BUDGET_MS = 120_000;

// ---------------------------------------------------------------------------
// Plumbing
// ---------------------------------------------------------------------------

/**
 * A silent `LoggerService`.
 *
 * Not fastidiousness about test output: the real one builds a pino logger with a
 * `pino-pretty` TRANSPORT outside production, and a transport is a worker thread
 * jest reports as an open handle and holds the run open on.
 */
function silentLogger(): LoggerService {
  const noop = (): void => undefined;

  return {
    setContext: noop,
    log: noop,
    error: noop,
    warn: noop,
    debug: noop,
    verbose: noop,
  } as unknown as LoggerService;
}

/**
 * The mutable view of the version map — the same cast `StageRegistry.spec`, the
 * integration harness and `realData.integration.spec.ts` all use.
 *
 * Registering at RUNTIME rather than committing a test stage is the point: a
 * declared one would have to appear in `constants.ts`, and would then show up in
 * `GET /api/pipeline/state` on a real appliance at 0 % coverage forever. Jest
 * gives every test FILE its own module registry, so these mutations are
 * invisible to every other spec.
 */
const REGISTRY = STAGE_REGISTRY as unknown as Record<string, string>;
const VERSIONS = STAGE_VERSIONS as unknown as Record<string, number>;

/** One tick's worth of everything a test or a log line wants to know. */
interface TickReport {
  /** 1-based tick number within its loop. */
  tick: number;

  /** What the run's CONTROL channel said when the tick read it. */
  desiredState: PipelineRunDesiredState;

  /** Why the tick planned nothing, when it planned nothing. */
  skipped: 'paused' | 'cancelled' | 'converged' | null;

  /** Ids handed to slices by this tick, in slice order, INCLUDING duplicates. */
  dispatchedIds: string[];

  /** Slice jobs worked. */
  slices: number;

  /** Sweep jobs the dispatcher self-requeued. Counted, then discarded — see the header. */
  requeuedSweeps: number;

  /** The shard's keyset cursor as the tick FOUND it. */
  cursorBefore: string | null;

  /** The shard's keyset cursor as the tick LEFT it. */
  cursorAfter: string | null;

  /** The source is drained from this cursor; the shard is parked `done`. */
  exhausted: boolean;

  /** True when the tick re-armed a drained shard because the ledger went stale. */
  rearmed: boolean;

  /** Wall clock for the whole tick: sweep hop + every slice + the shard write. */
  wallMs: number;

  /** Ledger coverage for this stage AFTER the tick. */
  coverage: StageCoverage;

  /** Errors thrown by slices. A tick continues, exactly as a queue would. */
  errors: Error[];
}

/** One line of the measurement table printed at the end of the run. */
interface Measurement {
  label: string;
  value: string;
}

const measurements: Measurement[] = [];

function record(label: string, value: string): void {
  measurements.push({ label, value });
  console.info(`[enrichmentLoop.integration] ${label.padEnd(56)} ${value}`);
}

/**
 * A `DataSource`-shaped double that forwards every statement to ONE query
 * runner.
 *
 * This is what keeps the whole suite inside a single transaction. Everything
 * under test — the ledger, the run service, the dispatcher, the slice listener
 * and both real stages — takes `@InjectDataSource()`, and every one of them
 * calls only `.query()`.
 */
function transactionalDataSource(runner: QueryRunner): DataSource {
  return {
    query: async (sql: string, params?: unknown[]): Promise<unknown> => runner.query(sql, params),
  } as unknown as DataSource;
}

// ---------------------------------------------------------------------------
// The control loop
// ---------------------------------------------------------------------------

/**
 * The tick the appliance does not have yet.
 *
 * Owns a run, a shard and one stage, and drives them with the real dispatcher,
 * the real worker and the real ledger. See the file header for the contract this
 * is coded to.
 */
class ControlLoop {
  readonly stageId: string;

  readonly ctx: UserServiceContext;

  private readonly module: TestingModule;

  private readonly runner: QueryRunner;

  private readonly queue: HarnessQueue;

  readonly stateService: PipelineStateService;

  readonly runService: PipelineRunService;

  private readonly dispatch: PipelineDispatchService;

  private readonly listener: PipelineSliceListener;

  /** The `Stage` the registry resolves. Public so a test can run the sweep directly. */
  readonly stage: Stage;

  /** The run this loop is driving. Set by {@link startRun}. */
  private runId: string | null = null;

  /** Hop counter carried into the sweep payload, purely for the hop ceiling. */
  private hop = 0;

  private tickCount = 0;

  private constructor(init: {
    stageId: string;
    userId: string;
    module: TestingModule;
    runner: QueryRunner;
    queue: HarnessQueue;
    stage: Stage;
  }) {
    this.stageId = init.stageId;
    this.ctx = { userId: init.userId };
    this.module = init.module;
    this.runner = init.runner;
    this.queue = init.queue;
    this.stage = init.stage;

    this.stateService = init.module.get(PipelineStateService);
    this.runService = init.module.get(PipelineRunService);
    this.dispatch = init.module.get(PipelineDispatchService);
    this.listener = init.module.get(PipelineSliceListener);
  }

  /**
   * Wire a loop around one real stage implementation, inside one transaction.
   *
   * `impl` supplies the source, the predicate, the queue and the `run()` body —
   * i.e. everything except the id and the version, which are made throwaway and
   * mutable for the reasons in the file header.
   */
  static async start(init: {
    runner: QueryRunner;
    userId: string;
    /** Constructs the real stage against the transactional data source. */
    implFactory: (dataSource: DataSource, logger: LoggerService) => Stage;
  }): Promise<ControlLoop> {
    const stageId = `${STAGE_PREFIX}${randomBytes(4).toString('hex')}`;
    const token = `PipelineStage:${stageId}`;
    const dataSource = transactionalDataSource(init.runner);
    const logger = silentLogger();
    const impl = init.implFactory(dataSource, logger);

    // Registered BEFORE the module compiles: `StageRegistry.get()` reads
    // STAGE_REGISTRY and `stageVersion()` reads STAGE_VERSIONS, so a stage that
    // were only a Nest provider would resolve to "Unknown pipeline stage".
    REGISTRY[stageId] = token;
    // Versions start at 1, never 0 — `versions.ts` explains at length why 0
    // would strand any row a killed worker left in `status='running'`.
    VERSIONS[stageId] = 1;

    // An object literal rather than a class, so `version` can be a GETTER.
    // `StageRegistry` caches the resolved instance and checks `stage.version ===
    // STAGE_VERSIONS[id]` once, at first resolve; reading through the map means
    // a bump mid-suite is visible to the cached instance, which is what a
    // deploy of a bumped version looks like from the sweep's point of view.
    const stage: Stage = {
      id: stageId,
      get version(): number {
        return VERSIONS[stageId];
      },
      queue: impl.queue,
      entityTypes: impl.entityTypes,
      source: impl.source,
      run: (ctx, ids) => impl.run(ctx, ids),
    };

    const queue = new HarnessQueue();

    const module = await Test.createTestingModule({
      providers: [
        PipelineStateService,
        StageRegistry,
        PipelineDispatchService,
        PipelineSliceListener,
        PipelineRunService,
        // `@InjectDataSource()` resolves to the `DataSource` class token for the
        // default connection, which is why binding the class works here.
        { provide: DataSource, useValue: dataSource },
        { provide: EventService, useValue: queue },
        { provide: LoggerService, useValue: logger },
        { provide: token, useValue: stage },
      ],
    }).compile();

    return new ControlLoop({ stageId, userId: init.userId, module, runner: init.runner, queue, stage });
  }

  // -------------------------------------------------------------------------
  // Run and shard lifecycle
  // -------------------------------------------------------------------------

  /** Open a run through the real `PipelineRunService`. */
  async startRun(kind = 'reprocess'): Promise<string> {
    const started = await this.runService.startRun(this.ctx, {
      kind,
      detail: { stage: this.stageId, source: 'enrichmentLoop.integration.spec' },
    });

    if (!started.created) {
      throw new Error(
        `A pipeline run was already active for user ${this.ctx.userId} inside this transaction ` +
          `(run ${started.run.id}). Every describe opens its own transaction; this means one leaked.`,
      );
    }

    this.runId = started.run.id;
    this.hop = 0;

    return started.run.id;
  }

  /** Finalize the run, so a later `startRun` in the same transaction is legal. */
  async finishRun(status = 'succeeded'): Promise<void> {
    if (this.runId == null) {
      return;
    }

    await this.runService.finishRun(this.runId, status);
    this.runId = null;
  }

  /** Operator intent. Writes `desired_state` and nothing else. */
  async setDesiredState(desiredState: PipelineRunDesiredState): Promise<void> {
    if (this.runId == null) {
      throw new Error('setDesiredState called with no run');
    }

    await this.runService.setDesiredState(this.ctx, this.runId, desiredState);
  }

  /** The shard row as the database holds it, or `null` before it is planned. */
  async shard(): Promise<{ id: string; cursor: string | null; status: string } | null> {
    if (this.runId == null) {
      return null;
    }

    const rows = (await this.runner.query(
      `SELECT id::text AS id, "cursor", status
         FROM ci.pipeline_shards
        WHERE run_id = $1::uuid AND stage = $2 AND shard_key = $3`,
      [this.runId, this.stageId, ENTITY_TYPE],
    )) as Array<{ id: string; cursor: string | null; status: string }>;

    return rows[0] ?? null;
  }

  // -------------------------------------------------------------------------
  // The tick
  // -------------------------------------------------------------------------

  /**
   * ONE control tick. See the file header for the six steps and why each is
   * there.
   */
  async tick(sliceSize = DEFAULT_SLICE_SIZE): Promise<TickReport> {
    const startedAt = Date.now();

    this.tickCount += 1;

    // 1. The CONTROL channel, read from the database every tick. Not cached, not
    //    passed in: the whole point of `desired_state` is that an operator can
    //    change it from psql or a POST while the loop is running.
    const run = await this.runService.findActiveRun(this.ctx);

    if (run == null) {
      throw new Error('tick() called with no active run for this user');
    }

    const base = {
      tick: this.tickCount,
      desiredState: run.desiredState,
      dispatchedIds: [] as string[],
      slices: 0,
      requeuedSweeps: 0,
      exhausted: false,
      rearmed: false,
      errors: [] as Error[],
    };

    if (run.desiredState !== 'running') {
      // 2. Plan NOTHING. Not a shorter slice, not a probe: a paused run must
      //    leave the cursor exactly where it was, or resume would be a restart.
      const parked = await this.shard();

      return {
        ...base,
        skipped: run.desiredState,
        cursorBefore: parked?.cursor ?? null,
        cursorAfter: parked?.cursor ?? null,
        wallMs: Date.now() - startedAt,
        coverage: await this.stateService.coverage(this.stageId),
      };
    }

    // 3. THE CHECKPOINT. The cursor of record is this row, not the pg-boss job.
    let shard = await this.shard();

    if (shard == null) {
      shard = await this.planShard();
    }

    let rearmed = false;

    if (shard.status === 'done') {
      // Continuous mode. A drained shard is not the end of the world — it is the
      // end of ONE pass. Something may have gone stale since: a version bump, a
      // retry gate coming due, or rows the user imported after the pass started.
      // One `LIMIT 1` probe from the head answers it, and it is the cheapest
      // question the sweep can be asked.
      const probe = await this.stateService.selectStale(this.stage, this.ctx.userId, null, 1);

      if (probe.length === 0) {
        return {
          ...base,
          skipped: 'converged',
          cursorBefore: shard.cursor,
          cursorAfter: shard.cursor,
          exhausted: true,
          wallMs: Date.now() - startedAt,
          coverage: await this.stateService.coverage(this.stageId),
        };
      }

      await this.runner.query(
        `UPDATE ci.pipeline_shards SET "cursor" = NULL, status = 'queued' WHERE id = $1::uuid`,
        [shard.id],
      );

      shard = { ...shard, cursor: null, status: 'queued' };
      rearmed = true;
    }

    const cursorBefore = shard.cursor;

    // 4. ONE hop of the real keyset sweep, from the shard's cursor.
    const result = await this.dispatch.runSweepHop({
      stage: this.stageId,
      userId: this.ctx.userId,
      entityType: ENTITY_TYPE,
      cursor: cursorBefore,
      sliceSize,
      hop: this.hop,
      dispatched: 0,
    });

    this.hop += 1;

    // 5. Work what the hop enqueued, through the real listener.
    const dispatchedIds: string[] = [];
    const errors: Error[] = [];
    let slices = 0;
    let requeuedSweeps = 0;

    for (;;) {
      const job = this.queue.fetch();

      if (job == null) {
        break;
      }

      if (job.name === PipelineSweepEvent) {
        // The dispatcher's self-requeue. Counted and dropped: this loop's cursor
        // lives in the shard row, so the job is redundant by design. See the
        // header — that redundancy is exactly what makes "delete the queued
        // pipeline jobs" a pause rather than a data loss.
        requeuedSweeps += 1;
        continue;
      }

      if (job.name !== PipelineSliceEvent) {
        throw new Error(`Unexpected event "${job.name}" on queue "${job.queue}"`);
      }

      slices += 1;
      dispatchedIds.push(...(Array.isArray(job.data.ids) ? (job.data.ids as string[]) : []));

      try {
        await this.listener.handleSlice(job.queue, job.data);
      } catch (err: unknown) {
        // Recorded and the tick continues, because that is what a queue does:
        // the job fails, the listener's catch has already written the ledger and
        // the dead-letter row, and the next job is fetched.
        errors.push(err instanceof Error ? err : new Error(String(err)));
      }
    }

    // 6. Commit the advanced cursor. AFTER the slices, so a crash between the
    //    hop and this write re-dispatches the slice rather than skipping it —
    //    at-least-once, which the ledger's claim absorbs, rather than at-most-once,
    //    which loses rows.
    await this.runner.query(`UPDATE ci.pipeline_shards SET "cursor" = $2, status = $3 WHERE id = $1::uuid`, [
      shard.id,
      result.cursor,
      result.exhausted ? 'done' : 'running',
    ]);

    return {
      tick: this.tickCount,
      desiredState: run.desiredState,
      skipped: null,
      dispatchedIds,
      slices,
      requeuedSweeps,
      cursorBefore,
      cursorAfter: result.cursor,
      exhausted: result.exhausted,
      rearmed,
      wallMs: Date.now() - startedAt,
      coverage: await this.stateService.coverage(this.stageId),
      errors,
    };
  }

  /** Tick until the loop reports it is converged, or the budget runs out. */
  async runToConvergence(maxTicks: number): Promise<TickReport[]> {
    const reports: TickReport[] = [];

    for (let i = 0; i < maxTicks; i += 1) {
      const report = await this.tick();

      reports.push(report);

      if (report.skipped === 'converged') {
        return reports;
      }
    }

    throw new Error(
      `The loop did not converge in ${maxTicks} ticks (stage ${this.stageId}). It dispatched ` +
        `${reports.reduce((n, r) => n + r.dispatchedIds.length, 0)} ids. A sweep that never stops is the ` +
        `failure mode that matters — on a metered stage it is a recurring bill.`,
    );
  }

  /** THE BUMP. In production this is a one-integer commit to `versions.ts`. */
  bumpVersion(): number {
    VERSIONS[this.stageId] += 1;

    return VERSIONS[this.stageId];
  }

  /** How many source rows the stage's own predicate says are in scope. */
  async candidateCount(): Promise<number> {
    const { schema, table, idColumn, userColumn, predicate } = this.stage.source;
    const applicability = predicate != null && predicate.trim().length > 0 ? predicate : 'TRUE';

    const rows = (await this.runner.query(
      `SELECT count(*)::int AS n
         FROM "${schema}"."${table}" s
        WHERE s."${userColumn}" = $1 AND (${applicability}) AND s."${idColumn}" IS NOT NULL`,
      [this.ctx.userId],
    )) as Array<{ n: number }>;

    return rows[0].n;
  }

  /** Every ledger row this loop's stage owns, as `(status, stage_version, attempts)`. */
  async ledgerRows(): Promise<
    Array<{ entity_id: string; status: string; stage_version: number; attempts: number }>
  > {
    return (await this.runner.query(
      `SELECT entity_id::text AS entity_id, status, stage_version, attempts
         FROM ci.pipeline_state
        WHERE stage = $1
        ORDER BY entity_id`,
      [this.stageId],
    )) as Array<{ entity_id: string; status: string; stage_version: number; attempts: number }>;
  }

  async close(): Promise<void> {
    delete REGISTRY[this.stageId];
    delete VERSIONS[this.stageId];

    await this.module.close();
  }

  /**
   * Materialize the one shard this loop uses.
   *
   * One shard, not many: sharding is a parallelism decision and this file is
   * about whether the loop closes at all. The cursor semantics are identical.
   */
  private async planShard(): Promise<{ id: string; cursor: string | null; status: string }> {
    const rows = (await this.runner.query(
      `INSERT INTO ci.pipeline_shards (run_id, stage, shard_key, "cursor", status)
            VALUES ($1::uuid, $2, $3, NULL, 'queued')
       ON CONFLICT (run_id, stage, shard_key) DO UPDATE SET status = ci.pipeline_shards.status
         RETURNING id::text AS id, "cursor", status`,
      [this.runId, this.stageId, ENTITY_TYPE],
    )) as Array<{ id: string; cursor: string | null; status: string }>;

    return rows[0];
  }
}

// ---------------------------------------------------------------------------
// The suite
// ---------------------------------------------------------------------------

describeWithDatabase(`the enrichment loop, against real imported data (${availability.target})`, () => {
  /** Pooled, OUTSIDE every transaction. Corpus facts and the leak check. */
  let dataSource: DataSource;

  /** The user with the most events. Every sweep is user-scoped. */
  let corpusUserId = '';

  /** `ci.events` rows for that user. */
  let corpusEvents = 0;

  /** Row counts + digests taken before the first test and re-read after the last. */
  let before: Record<string, string>;

  /**
   * Everything this suite could possibly have written, from outside every
   * transaction.
   *
   * Two USER tables — which the two real stages under test genuinely write, and
   * which is why this check is stricter here than in any sibling — plus the
   * three control-plane tables. Counts AND an order-independent digest for
   * `ci.events`, because a write that removed one row and added another would
   * leave a count alone. The digest hashes exactly the columns
   * `TemporalRepairStage` writes. Not `string_agg`: summing a per-row hash
   * streams and needs no `ORDER BY`.
   *
   * ── Why the ledger is scoped to `entity_type = 'event'` ────────────────────
   *
   * Narrower than it looks, and exactly right. This suite writes one entity type
   * and nothing else on the appliance writes that one: the declared stages have
   * never run, and `pipeline.integration.spec.ts`'s harness keys its rows under
   * `harness_source_row`. So this covers 100 % of what a leak from here would
   * look like and 0 % of what anything else is doing.
   *
   * Fingerprinting the whole table FAILED the first time this ran beside that
   * harness in another jest worker: the harness legitimately COMMITS its rows
   * and deletes them at teardown, so `ci.pipeline_state` honestly differs
   * between this suite's first and last statement, and the check reported a
   * sibling's correct behaviour as this suite's leak. A safety check that fails
   * for the wrong reason gets muted, and then it is not a safety check. The
   * lesson is `realData.integration.spec.ts`'s, learned the same way.
   */
  async function fingerprint(): Promise<Record<string, string>> {
    const [row] = (await dataSource.query(
      `SELECT (SELECT count(*) FROM ci.events)::text                        AS events,
              (SELECT coalesce(sum(('x' || substr(md5(e.event_id::text || coalesce(e.start_time::text, '') ||
                                                      coalesce(e.time_source, '')), 1, 8))::bit(32)::bigint), 0)
                 FROM ci.events e)::text                                    AS events_digest,
              (SELECT count(*) FROM ci.inventory)::text                     AS inventory,
              (SELECT count(*) FROM ci.pipeline_state
                WHERE entity_type = $1)::text                               AS pipeline_state_events,
              (SELECT coalesce(sum(('x' || substr(md5(ps.*::text), 1, 8))::bit(32)::bigint), 0)
                 FROM ci.pipeline_state ps
                WHERE ps.entity_type = $1)::text                            AS pipeline_state_digest,
              (SELECT count(*) FROM ci.pipeline_runs)::text                 AS pipeline_runs,
              (SELECT count(*) FROM ci.pipeline_shards)::text               AS pipeline_shards`,
      [ENTITY_TYPE],
    )) as Array<Record<string, string>>;

    return row;
  }

  /** Open a transaction. ALWAYS paired with {@link rollback}. */
  async function open(): Promise<QueryRunner> {
    const runner = dataSource.createQueryRunner();

    await runner.connect();
    await runner.startTransaction();

    return runner;
  }

  async function rollback(runner: QueryRunner): Promise<void> {
    await runner.rollbackTransaction();
    await runner.release();
  }

  beforeAll(async () => {
    const connection = resolveConnection();

    if (connection == null) {
      throw new Error('databaseAvailability() said yes but no connection resolved');
    }

    dataSource = new DataSource({
      type: 'postgres',
      // Discrete fields when there is no URL, so a password containing URL
      // metacharacters (the dev one ends in `!`) never has to survive a round
      // trip through percent-encoding.
      ...(connection.url != null
        ? { url: connection.url }
        : {
            host: connection.host,
            port: connection.port,
            username: connection.username,
            password: connection.password,
            database: connection.database,
          }),
      // Nothing is mapped through TypeORM: the pipeline speaks raw SQL and the
      // entities exist only to document it. `synchronize` pointed at a personal
      // archive would be actively dangerous.
      entities: [],
      synchronize: false,
      logging: false,
      extra: { max: 4 },
    });

    await dataSource.initialize();

    // Three outcomes, deliberately different (harness README): no database →
    // skipped at collection time; a database missing the tables → FAIL here,
    // naming the fix, because skipping would turn a migration mistake into a
    // green run.
    const [present] = (await dataSource.query(
      `SELECT to_regclass('ci.pipeline_state')::text  AS ledger,
              to_regclass('ci.pipeline_runs')::text   AS runs,
              to_regclass('ci.pipeline_shards')::text AS shards,
              to_regclass('ci.events')::text          AS events,
              to_regclass('ci.inventory')::text       AS inventory`,
    )) as Array<Record<string, string | null>>;

    for (const [name, value] of Object.entries(present)) {
      if (value == null) {
        throw new Error(
          `The table behind "${name}" is missing — run \`yarn workspace @ci/be-api migrate\` and re-run.`,
        );
      }
    }

    const [busiest] = (await dataSource.query(
      `SELECT user_id::text AS user_id, count(*)::int AS n
         FROM ci.events
        GROUP BY user_id
        ORDER BY n DESC
        LIMIT 1`,
    )) as Array<{ user_id: string; n: number }>;

    if (busiest == null) {
      throw new Error(
        'ci.events is empty. This suite exists to drive the loop over imported data; there is none here. ' +
          'Import an archive, or point PIPELINE_TEST_DATABASE_URL at a database that has one.',
      );
    }

    corpusUserId = busiest.user_id;
    corpusEvents = busiest.n;

    before = await fingerprint();

    console.info(
      `[enrichmentLoop.integration] corpus: ${corpusEvents} ci.events rows for the busiest user; ` +
        `ci.pipeline_state holds ${before.pipeline_state_events} rows for entity_type=${ENTITY_TYPE}, ` +
        `ci.pipeline_runs ${before.pipeline_runs}, ci.pipeline_shards ${before.pipeline_shards}, ` +
        `ci.inventory ${before.inventory}`,
    );
  });

  afterAll(async () => {
    if (dataSource?.isInitialized !== true) {
      return;
    }

    // Printed before the leak assertions so the numbers survive even if one of
    // them fails the run. §6 asks for numbers; a green test is not a number.
    console.info(
      `[enrichmentLoop.integration] measurements\n${measurements
        .map((m) => `    ${m.label.padEnd(56)} ${m.value}`)
        .join('\n')}`,
    );

    const [leaked] = (await dataSource.query(
      `SELECT (SELECT count(*) FROM ci.pipeline_state  WHERE stage LIKE $1 || '%')::int AS state,
              (SELECT count(*) FROM ci.pipeline_shards WHERE stage LIKE $1 || '%')::int AS shards,
              (SELECT count(*) FROM ci.pipeline_dead_letters WHERE stage LIKE $1 || '%')::int AS letters`,
      [STAGE_PREFIX],
    )) as Array<{ state: number; shards: number; letters: number }>;

    const after = await fingerprint();

    await dataSource.destroy();

    // The whole safety claim of this file, checked rather than asserted in a
    // comment. `leaked` is the direct one — a row under this suite's stage prefix
    // could only have come from here — and the fingerprint is what would catch a
    // write that landed somewhere else entirely, including in ci.events and
    // ci.inventory, which the two real stages under test genuinely write.
    expect(leaked).toEqual({ state: 0, shards: 0, letters: 0 });
    expect(after).toEqual(before);
  });

  // -------------------------------------------------------------------------
  // §1-§4. The loop over ci.events → ci.inventory, driven to convergence.
  // -------------------------------------------------------------------------

  describe('promote.object over the real commerce events', () => {
    let runner: QueryRunner;
    let loop: ControlLoop;
    let candidates = 0;

    /** Every id the loop has ever dispatched, in tick order, INCLUDING duplicates. */
    const dispatched: string[] = [];

    /** One report per tick of the first pass, in order. */
    const firstPass: TickReport[] = [];

    beforeAll(async () => {
      runner = await open();

      loop = await ControlLoop.start({
        runner,
        userId: corpusUserId,
        implFactory: (ds, logger) => new ObjectPromoteStage(ds, logger),
      });

      candidates = await loop.candidateCount();

      record('promote.object candidates (real rows)', String(candidates));
    });

    afterAll(async () => {
      await loop.close();
      await rollback(runner);
    });

    // -----------------------------------------------------------------------
    // §1. A run, a tick, and real work dispatched.
    // -----------------------------------------------------------------------

    it('§1 has real candidates and an EMPTY ledger — the genuine first-import state', async () => {
      expect(candidates).toBeGreaterThan(0);

      const coverage = await loop.stateService.coverage(loop.stageId);

      // Every row is stale for this stage because nothing has an opinion about
      // any of them. That is not a fixture, it is the appliance's actual state:
      // ci.pipeline_state has never held a row.
      expect(coverage.total).toBe(0);

      // Not a shortcut — this is the sweep the dispatcher is about to run.
      const head = await loop.stateService.selectStale(loop.stage, corpusUserId, null, 1);

      expect(head).toHaveLength(1);
    });

    it('§1 dispatches work on the FIRST tick of a freshly started run', async () => {
      const runId = await loop.startRun('reprocess');

      expect(runId).toMatch(/^[0-9a-f-]{36}$/);

      const active = await loop.runService.findActiveRun(loop.ctx);

      expect(active).toMatchObject({ id: runId, desiredState: 'running', active: true });

      const report = await loop.tick();

      firstPass.push(report);
      dispatched.push(...report.dispatchedIds);

      // THE GAP, closed: a run was started and one tick later real ids from the
      // operator's own archive are in the ledger. Nothing in the repo did this.
      expect(report.errors).toEqual([]);
      expect(report.slices).toBe(MAX_SLICES_PER_SWEEP);
      expect(report.dispatchedIds).toHaveLength(IDS_PER_TICK);
      expect(report.cursorBefore).toBeNull();
      expect(report.cursorAfter).toBe(report.dispatchedIds[report.dispatchedIds.length - 1]);
      expect(report.exhausted).toBe(false);

      record('tick 1 dispatched ids', String(report.dispatchedIds.length));
      record('tick 1 wall clock', `${report.wallMs} ms`);
    });

    it('§1 dispatched REAL commerce events, and the ledger says so', async () => {
      const [check] = (await runner.query(
        `SELECT count(*)::int AS n
           FROM ci.events e
          WHERE e.event_id = ANY($1::uuid[])
            AND e.user_id = $2::uuid
            AND e.event_type IN ('purchase', 'order')`,
        [firstPass[0].dispatchedIds, corpusUserId],
      )) as Array<{ n: number }>;

      // Not "some rows" — every id the loop dispatched is a live commerce event
      // belonging to this user. A sweep that leaked another user's rows, or rows
      // the predicate excludes, would show up here as a shortfall.
      expect(check.n).toBe(IDS_PER_TICK);

      const coverage = firstPass[0].coverage;

      expect(coverage.total).toBe(IDS_PER_TICK);
      expect(coverage.done + coverage.skipped).toBe(IDS_PER_TICK);
      expect(coverage.failed).toBe(0);
      expect(coverage.running).toBe(0);
      expect(coverage.quarantined).toBe(0);
      expect(coverage.stale).toBe(0);
    });

    it('§1 actually ENRICHED — real ci.inventory objects exist that did not before', async () => {
      const [inventory] = (await runner.query(
        `SELECT count(*)::int AS n
           FROM ci.inventory
          WHERE owner_user_id = $1::uuid AND source_type = 'promote.object'`,
        [corpusUserId],
      )) as Array<{ n: number }>;

      // The end-to-end claim, stated as a row count in a user table rather than
      // as a ledger status. `ci.inventory` held 0 promoted rows before this
      // transaction opened, and the whole thing is rolled back — but inside it,
      // the loop did the work.
      expect(inventory.n).toBeGreaterThan(0);
      // NOT 1:1. One commerce event is an ORDER; it mints one inventory object per
      // LINE ITEM, so 624 processed events legitimately produced 2,147 objects.
      // Duplication is ruled out structurally rather than by this count:
      // ObjectPromoteStage upserts ON CONFLICT (owner_user_id, source_type,
      // source_system, source_id), so a re-run cannot inflate it — which §3
      // (converges and stops) then confirms by finding nothing left to do.
      expect(inventory.n).toBeGreaterThanOrEqual(firstPass[0].coverage.done);

      record('objects minted by tick 1', String(inventory.n));
    });

    // -----------------------------------------------------------------------
    // §2. Several ticks; the ledger advances monotonically.
    // -----------------------------------------------------------------------

    it('§2 advances monotonically over several ticks, and processes no row twice', async () => {
      for (;;) {
        const report = await loop.tick();

        firstPass.push(report);
        dispatched.push(...report.dispatchedIds);

        if (report.skipped === 'converged') {
          break;
        }

        if (firstPass.length > 200) {
          throw new Error('the first pass did not converge in 200 ticks');
        }
      }

      const working = firstPass.filter((r) => r.skipped == null);

      // Monotone, tick by tick, in both directions. `pending` here is the honest
      // one: rows the stage has no opinion about at all, measured against the
      // source predicate rather than against the ledger's own total.
      let previousPending = candidates;
      let previousSettled = -1;

      for (const report of working) {
        const settled = report.coverage.done + report.coverage.skipped;
        const pending = candidates - report.coverage.total;

        expect(settled).toBeGreaterThan(previousSettled);
        expect(pending).toBeLessThan(previousPending);
        expect(report.coverage.running).toBe(0);
        expect(report.coverage.failed).toBe(0);
        expect(report.errors).toEqual([]);

        previousSettled = settled;
        previousPending = pending;
      }

      // NO ROW TWICE, asserted three independent ways.
      //
      // 1. The dispatch log itself has no duplicate.
      expect(new Set(dispatched).size).toBe(dispatched.length);
      // 2. The ledger holds exactly one row per dispatched id.
      const rows = await loop.ledgerRows();

      expect(rows).toHaveLength(dispatched.length);
      // 3. `attempts` is incremented by `claim()` and nowhere else, so a second
      //    claim on any row — from an overlapping sweep, a re-dispatched slice,
      //    or a cursor that failed to advance — would be visible here as a 2.
      //    This is the assertion that would catch a duplicate the other two
      //    cannot, because it survives de-duplication at every other layer.
      for (const row of rows) {
        expect(row.attempts).toBe(1);
        expect(row.stage_version).toBe(1);
        expect(['done', 'skipped']).toContain(row.status);
      }

      // Coverage converged: every candidate has an opinion recorded.
      const final = working[working.length - 1].coverage;

      expect(final.total).toBe(candidates);
      expect(final.coverage).toBe(1);

      record('ticks to converge (2,777 candidates)', String(working.length));
      record('ids per tick', working.map((r) => r.dispatchedIds.length).join(', '));
      record('wall clock per tick', `${working.map((r) => `${r.wallMs}`).join(', ')} ms`);
      record(
        'mean ms per row (promote.object)',
        (working.reduce((n, r) => n + r.wallMs, 0) / dispatched.length).toFixed(3),
      );
      // THE END-TO-END CLAIM, at convergence: the ledger's `done` count and the
      // number of real rows in the TARGET table are the same number. Coverage
      // that does not match the thing it claims coverage over is the unearned
      // confidence this whole subsystem replaces — it is exactly how `ci.content`
      // sat at zero embedded rows while nothing looked wrong.
      const [inventory] = (await runner.query(
        `SELECT count(*)::int AS n
           FROM ci.inventory
          WHERE owner_user_id = $1::uuid AND source_type = 'promote.object'`,
        [corpusUserId],
      )) as Array<{ n: number }>;

      expect(inventory.n).toBe(final.done);

      record(
        'outcomes',
        `done ${final.done}, skipped ${final.skipped}, failed ${final.failed}, quarantined ${final.quarantined}`,
      );
      record('ci.inventory rows written (from 0)', String(inventory.n));
    });

    // -----------------------------------------------------------------------
    // §3. It converges AND STOPS.
    // -----------------------------------------------------------------------

    it('§3 STOPS: a converged corpus produces no dispatch, tick after tick', async () => {
      // The failure mode that matters. A sweep that keeps finding work over a
      // corpus it has already finished is not a slow pipeline, it is a standing
      // charge — on `enrich.geocode` and `enrich.position_reverse` it is a
      // recurring bill against a metered provider, and on `index.embed` it is
      // the one host Ollama process that interactive chat shares.
      const idle: TickReport[] = [];

      for (let i = 0; i < 5; i += 1) {
        idle.push(await loop.tick());
      }

      for (const report of idle) {
        expect(report.skipped).toBe('converged');
        expect(report.dispatchedIds).toHaveLength(0);
        expect(report.slices).toBe(0);
        expect(report.requeuedSweeps).toBe(0);
        expect(report.coverage.total).toBe(candidates);
      }

      // And the sweep itself agrees, from the head of the corpus rather than from
      // the parked cursor: there is genuinely nothing stale, not merely nothing
      // after the cursor.
      const stale = await loop.stateService.selectStale(loop.stage, corpusUserId, null, DEFAULT_SLICE_SIZE);

      expect(stale).toEqual([]);

      const shard = await loop.shard();

      expect(shard?.status).toBe('done');

      record('idle ticks after convergence', `${idle.length}, all dispatching 0`);
    });

    // -----------------------------------------------------------------------
    // §4. A version bump re-opens the corpus, and the loop picks it up itself.
    // -----------------------------------------------------------------------

    it('§4 counts the cost of a bump BEFORE it is spent', async () => {
      const beforeBump = await loop.stateService.coverage(loop.stageId);

      expect(beforeBump.stale).toBe(0);

      // In production this line is one integer in `versions.ts`, reviewed in the
      // same commit as the enricher change that justifies it.
      const bumped = loop.bumpVersion();

      expect(bumped).toBe(2);

      const afterBump = await loop.stateService.coverage(loop.stageId);

      // The number an operator must read before pushing the commit. Every ledger
      // row below the new version is re-opened — `done`, `skipped` and
      // `quarantined` alike — and on a metered stage this integer IS the bill.
      expect(afterBump.stageVersion).toBe(2);
      expect(afterBump.stale).toBe(candidates);
      expect(afterBump.total).toBe(candidates);

      record('rows re-opened by a v1→v2 bump', String(afterBump.stale));
    });

    it('§4 picks the bump up AUTOMATICALLY on the next tick — no operator action', async () => {
      const report = await loop.tick();

      // The property the whole rebuild exists to deliver, now DRIVEN. The shard
      // was parked `done` with its cursor at the end of the corpus; the tick
      // probed the head, found the bump had made everything stale, re-armed the
      // cursor to null and dispatched. Nobody restarted a run and nobody ran a
      // backfill script.
      expect(report.rearmed).toBe(true);
      expect(report.cursorBefore).toBeNull();
      expect(report.dispatchedIds).toHaveLength(IDS_PER_TICK);
      expect(report.errors).toEqual([]);

      // The SAME real rows come back, with a terminal ledger row already sitting
      // on every one of them. Under the `LEFT JOIN ci.inventory ... IS NULL`
      // predicate this stage's docblock refuses to write, they were finished
      // forever.
      const firstPassSet = new Set(dispatched);

      for (const id of report.dispatchedIds) {
        expect(firstPassSet.has(id)).toBe(true);
      }

      const rows = await loop.ledgerRows();
      const byId = new Map(rows.map((row) => [row.entity_id, row]));

      for (const id of report.dispatchedIds) {
        const row = byId.get(id);

        expect(row?.stage_version).toBe(2);
        // Second genuine start. The first pass left every row at 1, so this is
        // the ledger recording a real re-processing rather than a bookkeeping
        // rewrite.
        expect(row?.attempts).toBe(2);
      }
    });

    it('§4 converges and stops again at the new version', async () => {
      const reports = await loop.runToConvergence(200);
      const working = reports.filter((r) => r.skipped == null);

      const final = reports[reports.length - 1];

      expect(final.skipped).toBe('converged');

      const coverage = await loop.stateService.coverage(loop.stageId);

      expect(coverage.stageVersion).toBe(2);
      expect(coverage.total).toBe(candidates);
      expect(coverage.stale).toBe(0);
      expect(coverage.coverage).toBe(1);

      const rows = await loop.ledgerRows();

      for (const row of rows) {
        expect(row.stage_version).toBe(2);
        expect(row.attempts).toBe(2);
      }

      record('ticks to re-converge after the bump', String(working.length + 1));
    });
  });

  // -------------------------------------------------------------------------
  // §5. Pause and resume.
  // -------------------------------------------------------------------------

  describe('pause and resume, mid-corpus', () => {
    let runner: QueryRunner;
    let loop: ControlLoop;

    /** Ids dispatched before the pause. */
    const beforePause: string[] = [];

    /** The cursor at the moment the run was paused. */
    let pausedCursor: string | null = null;

    beforeAll(async () => {
      runner = await open();

      loop = await ControlLoop.start({
        runner,
        userId: corpusUserId,
        implFactory: (ds, logger) => new ObjectPromoteStage(ds, logger),
      });

      await loop.startRun('reprocess');

      // Two ticks in, deliberately mid-corpus: pausing a converged loop proves
      // nothing, and pausing before the first tick proves less.
      for (let i = 0; i < 2; i += 1) {
        const report = await loop.tick();

        beforePause.push(...report.dispatchedIds);
        pausedCursor = report.cursorAfter;
      }
    });

    afterAll(async () => {
      await loop.close();
      await rollback(runner);
    });

    it('§5 pause writes intent only, and the next ticks dispatch NOTHING', async () => {
      expect(beforePause).toHaveLength(2 * IDS_PER_TICK);
      expect(pausedCursor).not.toBeNull();

      await loop.setDesiredState('paused');

      const active = await loop.runService.findActiveRun(loop.ctx);

      // `desired_state` is the CONTROL channel; `status` belongs to the workers
      // and must not have been touched by a pause. A controller that wrote both
      // would be reporting an observation it did not make.
      expect(active).toMatchObject({ desiredState: 'paused', status: 'queued', active: true });

      const ledgerBefore = await loop.ledgerRows();

      const idle: TickReport[] = [];

      for (let i = 0; i < 3; i += 1) {
        idle.push(await loop.tick());
      }

      for (const report of idle) {
        expect(report.skipped).toBe('paused');
        expect(report.dispatchedIds).toHaveLength(0);
        expect(report.slices).toBe(0);
        // The cursor must be untouched, not merely unadvanced: a paused tick
        // that "checked" the head would move it, and resume would restart.
        expect(report.cursorAfter).toBe(pausedCursor);
      }

      const ledgerAfter = await loop.ledgerRows();

      // Nothing was claimed, nothing was completed, nothing was re-attempted.
      expect(ledgerAfter).toEqual(ledgerBefore);

      const shard = await loop.shard();

      expect(shard?.cursor).toBe(pausedCursor);
      expect(shard?.status).toBe('running');
    });

    it('§5 resume continues FROM THE CURSOR — it does not restart', async () => {
      await loop.setDesiredState('running');

      const report = await loop.tick();

      expect(report.desiredState).toBe('running');
      expect(report.skipped).toBeNull();

      // THE assertion. The tick picked up at the persisted cursor, and the first
      // id it dispatched is strictly past it. A restart would have handed back
      // the head of the corpus, which under the ledger's claim would be absorbed
      // silently — the wasted pass would be invisible except as a duplicated
      // `attempts` count, which is checked below.
      expect(report.cursorBefore).toBe(pausedCursor);
      expect(report.dispatchedIds[0] > (pausedCursor as string)).toBe(true);

      const processed = new Set(beforePause);

      for (const id of report.dispatchedIds) {
        expect(processed.has(id)).toBe(false);
      }

      // And the rows finished before the pause were not re-worked: `attempts`
      // still 1 on every one of them.
      const rows = await loop.ledgerRows();
      const byId = new Map(rows.map((row) => [row.entity_id, row]));

      for (const id of beforePause) {
        expect(byId.get(id)?.attempts).toBe(1);
      }

      record('resume restarted from the head?', `no — resumed at ${pausedCursor?.slice(0, 8)}…`);
    });

    it('§5 a resumed run still converges', async () => {
      const reports = await loop.runToConvergence(200);

      expect(reports[reports.length - 1].skipped).toBe('converged');

      const coverage = await loop.stateService.coverage(loop.stageId);

      expect(coverage.coverage).toBe(1);

      const rows = await loop.ledgerRows();

      // One attempt each, across a pause. The pause cost nothing and repeated
      // nothing.
      for (const row of rows) {
        expect(row.attempts).toBe(1);
      }
    });
  });

  // -------------------------------------------------------------------------
  // §6. What a tick costs against 324,044 rows.
  // -------------------------------------------------------------------------

  describe('the cost of one tick against the whole corpus', () => {
    let runner: QueryRunner;
    let loop: ControlLoop;
    let candidates = 0;

    /** Ticks from cursor null with an empty ledger — the easy case. */
    const cold: TickReport[] = [];

    /** Ticks resumed mid-corpus with {@link PRELOADED_LEDGER_ROWS} ledger rows. */
    const warm: TickReport[] = [];

    beforeAll(async () => {
      runner = await open();

      // `clean.temporal_repair`: the one declared stage whose applicability
      // predicate covers every live event, so its candidate set IS the corpus.
      // Postgres-only — no provider, no Ollama, no bill — which is what makes it
      // safe to measure with. It writes `ci.events.start_time` and
      // `start_time_original`, inside the transaction, and the suite's
      // fingerprint (which hashes exactly those columns) proves none of it
      // survived.
      loop = await ControlLoop.start({
        runner,
        userId: corpusUserId,
        implFactory: (ds, logger) => new TemporalRepairStage(ds, logger),
      });

      candidates = await loop.candidateCount();

      await loop.startRun('reprocess');

      for (let i = 0; i < SCALE_TICKS; i += 1) {
        cold.push(await loop.tick());
      }

      // ── The state the appliance actually lives in ────────────────────────
      //
      // The three ticks above ran against a ledger holding 3,000 rows, which is
      // the FIRST three ticks of a 325-tick sweep and nothing else. Quoting them
      // as "the cost of a tick against 324k rows" would be the empty-ledger
      // benchmark this subsystem's own comments warn about: the sweep's failure
      // mode is INVERTED — fast when there is lots of work, slowest once the
      // corpus has converged, which is the state every idempotent re-sweep runs
      // in permanently.
      //
      // So: fast-forward the ledger to a third of the corpus, in sweep order —
      // real event ids, taken the way a real sweep would have taken them, so the
      // ledger looks exactly like a run that was interrupted a third of the way
      // through. Random ids would produce a uniformly-sprinkled ledger, a state
      // no sweep can reach and one the planner treats differently.
      await runner.query(
        `INSERT INTO ci.pipeline_state
                (entity_type, entity_id, stage, stage_version, status, attempts, user_id, updated_at)
         SELECT $1, t.event_id, $2, $3::int, 'done', 1, t.user_id, now()
           FROM (SELECT event_id, user_id
                   FROM ci.events
                  WHERE user_id = $4::uuid
                  ORDER BY event_id
                  LIMIT $5) AS t
         ON CONFLICT (entity_type, entity_id, stage) DO NOTHING`,
        [ENTITY_TYPE, loop.stageId, loop.stage.version, corpusUserId, PRELOADED_LEDGER_ROWS],
      );

      // WITHOUT THIS THE MEASUREMENT IS A LIE. `ci.pipeline_state` is empty on
      // this appliance, so its statistics say "0 rows"; a plan chosen against
      // those statistics is the plan for an empty ledger no matter how many rows
      // the transaction just inserted. On a real appliance autoanalyze reaches
      // the same state within minutes of the first sweep, so this reproduces the
      // steady state rather than manufacturing one. Legal inside a transaction
      // (unlike VACUUM) and transactional — the catalog rows roll back too.
      await runner.query(`ANALYZE ci.pipeline_state`);

      // Park the shard where that interrupted run left it, then tick. This is a
      // resume from a third of the way in, with a ledger to match.
      const [boundary] = (await runner.query(
        `SELECT event_id::text AS id
           FROM ci.events
          WHERE user_id = $1::uuid
          ORDER BY event_id
         OFFSET $2 LIMIT 1`,
        [corpusUserId, PRELOADED_LEDGER_ROWS - 1],
      )) as Array<{ id: string }>;

      const shard = await loop.shard();

      await runner.query(
        `UPDATE ci.pipeline_shards SET "cursor" = $2, status = 'running' WHERE id = $1::uuid`,
        [shard?.id, boundary.id],
      );

      for (let i = 0; i < SCALE_TICKS; i += 1) {
        warm.push(await loop.tick());
      }
    });

    afterAll(async () => {
      await loop.close();
      await rollback(runner);
    });

    it('§6 the whole corpus is in scope for a declared stage', async () => {
      // 324,044 candidates for one stage, with an empty ledger, is the genuine
      // starting condition of a first import — and the reason the loop has to
      // pace itself rather than enqueue the corpus in one pass.
      expect(candidates).toBe(corpusEvents);

      const [reasons] = (await runner.query(
        `SELECT jsonb_object_agg(r.reason, r.n) AS reasons
           FROM (SELECT coalesce(reason, status) AS reason, count(*)::int AS n
                   FROM ci.pipeline_state
                  WHERE stage = $1
                  GROUP BY 1) r`,
        [loop.stageId],
      )) as Array<{ reasons: Record<string, number> | null }>;

      record('clean.temporal_repair candidates', String(candidates));
      // The vocabulary is the point. Under the predicate this stage replaces,
      // every one of these rows would simply have been absent — indistinguishable
      // from work that was never scheduled.
      record('temporal_repair ledger reasons', JSON.stringify(reasons.reasons ?? {}));
    });

    it('§6 reports what one tick costs, cold and against a real ledger', () => {
      for (const report of [...cold, ...warm]) {
        expect(report.errors).toEqual([]);
        expect(report.dispatchedIds).toHaveLength(IDS_PER_TICK);
        expect(report.exhausted).toBe(false);
        expect(report.wallMs).toBeLessThan(TICK_BUDGET_MS);
      }

      const coldWall = cold.map((r) => r.wallMs);
      const warmWall = warm.map((r) => r.wallMs);
      const meanWarm = warmWall.reduce((a, b) => a + b, 0) / warmWall.length;
      const ticksToConverge = Math.ceil(candidates / IDS_PER_TICK);

      record('rows per tick', `${IDS_PER_TICK} (${MAX_SLICES_PER_SWEEP} slices × ${DEFAULT_SLICE_SIZE})`);
      record('tick wall clock, ledger empty', `${coldWall.join(', ')} ms`);
      record(
        `tick wall clock, ledger ${PRELOADED_LEDGER_ROWS} rows`,
        `${warmWall.join(', ')} ms (resumed at row ${PRELOADED_LEDGER_ROWS})`,
      );
      record('mean ms per row, real ledger', (meanWarm / IDS_PER_TICK).toFixed(3));
      record('PROJECTED ticks to converge 324,044', String(ticksToConverge));
      record(
        'PROJECTED worker time to converge 324,044',
        `${((meanWarm * ticksToConverge) / 1000 / 60).toFixed(1)} min — MACHINERY ONLY, see the runbook`,
      );
    });

    it('§6 does not get slower as the ledger fills — the anti-join holds', () => {
      // The regression this pins is the LEFT JOIN form of the staleness sweep,
      // which `realData.integration.spec.ts` measured at 4,401 blocks against the
      // anti-join's 241 and which turns a full sweep into O(corpus²/slice). Its
      // signature from up here is a tick that costs materially more once the
      // ledger is populated AND the cursor is deep — precisely the two conditions
      // the warm ticks reproduce and the cold ones do not.
      //
      // A ceiling rather than a slope, because three samples is not a trend and a
      // developer machine's milliseconds are noise: a warm tick may not cost more
      // than four times a cold one. Under the LEFT JOIN this was a change of
      // complexity class, not a constant factor, so four is generous and still
      // catches it.
      const meanCold = cold.reduce((n, r) => n + r.wallMs, 0) / cold.length;
      const meanWarm = warm.reduce((n, r) => n + r.wallMs, 0) / warm.length;

      expect(meanWarm).toBeLessThan(meanCold * 4 + 1_000);

      record(
        'tick cost drift (warm / cold)',
        `${(meanWarm / Math.max(meanCold, 1)).toFixed(2)}× — ledger 0 → ${PRELOADED_LEDGER_ROWS} rows`,
      );
    });

    it('§6 leaves the ledger consistent at 324k scale', async () => {
      const coverage = await loop.stateService.coverage(loop.stageId);

      // The three COLD ticks worked the head of the corpus, which is inside the
      // preloaded prefix, so the preload's `ON CONFLICT DO NOTHING` absorbed
      // them rather than adding to them. The three WARM ticks ran past the
      // prefix and are additive. That arithmetic is asserted rather than
      // approximated because it is also the proof that the preload did not
      // silently overwrite work the loop had already recorded.
      expect(coverage.total).toBe(PRELOADED_LEDGER_ROWS + SCALE_TICKS * IDS_PER_TICK);
      expect(coverage.running).toBe(0);
      expect(coverage.failed).toBe(0);
      expect(coverage.quarantined).toBe(0);
      expect(coverage.done + coverage.skipped).toBe(coverage.total);
      expect(coverage.stale).toBe(0);

      // Every row the loop itself worked was claimed exactly once, at 324k scale
      // with a six-figure ledger underneath it.
      const [attempts] = (await runner.query(
        `SELECT max(attempts)::int AS max, count(*)::int AS n
           FROM ci.pipeline_state
          WHERE stage = $1`,
        [loop.stageId],
      )) as Array<{ max: number; n: number }>;

      expect(attempts.max).toBe(1);
      expect(attempts.n).toBe(coverage.total);

      record(
        'ledger at end of §6',
        `${coverage.total} rows — done ${coverage.done}, skipped ${coverage.skipped}, max attempts ${attempts.max}`,
      );
    });
  });
});
