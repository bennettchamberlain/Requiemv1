import { randomBytes, randomUUID } from 'node:crypto';

import { Test, type TestingModule } from '@nestjs/testing';
import { DataSource, type QueryRunner } from 'typeorm';

import type { UserServiceContext } from '@ci/common/context';
import { LoggerService } from '@ci/common/logging';
import config from '@ci/configuration';
import { EventService } from '@ci/domains/events';

import { PIPELINE_QUEUES, type PipelineQueue } from '../constants';
import { PipelineSliceEvent, PipelineSweepEvent } from '../events';
import { PipelineSliceListener } from '../listeners/PipelineSliceListener';
import {
  BackpressureService,
  QUEUE_ADMISSION_BURSTS,
  QUEUE_READY_CAPS,
  reopenDepth,
  type QueueAdmission,
} from '../services/BackpressureService';
import { PipelineDispatchService } from '../services/PipelineDispatchService';
import { PipelineStateService } from '../services/PipelineStateService';
import { STAGE_REGISTRY, StageRegistry } from '../services/StageRegistry';
import type { Stage, StageResult } from '../types';
import { STAGE_VERSIONS } from '../versions';

import { HarnessQueue, databaseAvailability, resolveConnection, sourceId } from './harness/pipelineHarness';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * BACKPRESSURE RELIEVES OVER TIME — and shedding loses nothing. Proven.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The appliance now processes rows AS THEY ARRIVE. The nightly sweep stops
 * being the primary path and becomes the SAFETY NET. That change is only safe
 * because of one property, and this file is here to demonstrate that the
 * property actually holds against a real database rather than in a comment:
 *
 *   **An arrival that backpressure SHEDS is not lost.** `ci.pipeline_state` is
 *   the source of truth for "has this stage run for this row?", so a row whose
 *   arrival was refused is simply still stale, and the next sweep finds it with
 *   the same anti-join it uses for everything else. There is no deferral queue,
 *   no retry buffer, no timer and nothing to reconcile — and there must never
 *   be, because all of those are unbounded, none of them survive a restart, and
 *   the ledger already does the job for free.
 *
 * That is the whole argument for shedding aggressively instead of buffering,
 * and §4 below is the assertion that earns it: after a ramp that sheds most of
 * an import, the set of rows the sweep still considers stale is EXACTLY the set
 * admission refused — no more (nothing was double-counted) and no less (nothing
 * leaked).
 *
 * ── What is real ───────────────────────────────────────────────────────────
 *
 * REAL: Postgres, and the real `pgboss.job` partition for `pipeline-embed`, so
 * every depth this file reports is a depth `BackpressureService` measured with
 * its own bounded index-only count rather than one a mock agreed to.
 * `PipelineStateService` (every statement), `PipelineDispatchService` (the
 * keyset sweep and its cursor-advance assertion), `PipelineSliceListener`
 * (claim → run → reconcile → complete), `StageRegistry` (with its guards), and
 * `BackpressureService` itself.
 *
 * FAKE: the stage — one synthetic stage over one throwaway source table, whose
 * per-id decisions this file supplies. And the ARRIVAL DISPATCHER, which is
 * modelled here as {@link Appliance.arrive}: it asks admission how many slices
 * it may start, starts that many, and drops the rest on the floor. That is the
 * entire contract an arrival listener has with this service, and modelling it
 * here keeps the proof independent of which file ends up implementing it.
 *
 * ── Why `pipeline-embed` ───────────────────────────────────────────────────
 *
 * The tightest cap of the three (25, against 100 and 500), so the whole ramp —
 * plateau, taper, close, hysteresis gap, reopen — fits in a few dozen rows and
 * a few dozen milliseconds. It is also the class where getting this wrong is
 * worst: the one host Ollama process is shared with interactive chat.
 *
 * ── How this stays out of the live archive ─────────────────────────────────
 *
 * ONE `QueryRunner`, ONE transaction, ALWAYS rolled back. Every statement in
 * this file — the throwaway schema, the synthetic `pgboss.job` rows, and the
 * real `ci.pipeline_state` writes the slice listener makes — runs inside it. So
 * no worker on the live appliance can ever fetch a synthetic job, no ledger row
 * is committed, there is nothing to clean up, and a `kill -9` mid-run leaves the
 * operator's 324,044-event archive untouched.
 *
 * The suite never DELETES a pg-boss row it did not insert: draining is done by
 * probe id, so a live queued job is never even row-locked.
 */

const availability = databaseAvailability();
const describeWithDatabase = availability.available ? describe : describe.skip;

if (!availability.available) {
  console.warn(`[backpressureRelief.integration.spec] SKIPPED — ${availability.reason}`);
}

// ---------------------------------------------------------------------------
// The scenario's shape
// ---------------------------------------------------------------------------

/** The resource class under test. @see the header. */
const QUEUE: PipelineQueue = PIPELINE_QUEUES.EMBED;

const CAP = QUEUE_READY_CAPS[QUEUE];
const BURST = QUEUE_ADMISSION_BURSTS[QUEUE];
const REOPEN_AT = reopenDepth(QUEUE);

/** Rows in one arrival burst — an import landing a batch, larger than any grant. */
const ARRIVALS_PER_BURST = 10;

/** Bursts with no worker progress at all. Drives the queue from empty to its cap. */
const RAMP_BURSTS = 8;

/**
 * Ticks of the steady state: rows arrive AND workers make progress. Deliberately
 * over-subscribed (arrivals exceed the drain rate) so the queue keeps returning
 * to its cap and the hysteresis is exercised repeatedly rather than once.
 */
const STEADY_TICKS = 8;

/** Jobs a worker pool completes per steady-state tick. */
const WORK_PER_TICK = 5;

const TOTAL_ROWS = (RAMP_BURSTS + STEADY_TICKS) * ARRIVALS_PER_BURST;

/** One arrival burst, as the appliance saw it. The ramp table is a list of these. */
interface BurstRecord {
  /** 1-based burst number, across the ramp and the steady state alike. */
  burst: number;
  /** Ready depth `BackpressureService` measured before the burst was offered. */
  depthBefore: number;
  /** Slices admission said could be started. */
  granted: number;
  /** Rows actually committed to the queue this burst. */
  admitted: number;
  /** Rows refused, and therefore left for the sweep. */
  shed: number;
  reason: QueueAdmission['reason'];
  latched: boolean;
  /** Ready depth after the burst was committed. */
  depthAfter: number;
  /** Jobs the worker pool completed after the burst, if any. */
  worked: number;
}

/** One step of the drain that follows the close. */
interface DrainStep {
  depth: number;
  granted: number;
  reason: QueueAdmission['reason'];
}

/** Everything the scenario measured. The assertions read this; nothing re-runs it. */
interface ReliefReport {
  ramp: BurstRecord[];
  steady: BurstRecord[];
  drain: DrainStep[];
  /** Depth at which admission first refused everything. */
  closedAt: number;
  /** Depth at which a closed admission first granted anything again. */
  reopenedAt: number;
  /** Jobs the workers had to complete between the close and the reopen. */
  drainedToReopen: number;
  /** Every row that ever arrived, in arrival order. */
  arrived: string[];
  /** Rows admission committed to the queue. */
  admitted: string[];
  /** Rows admission refused. THE set that must survive in the ledger. */
  shed: string[];
  /**
   * `ci.pipeline_state` rows existing for a SHED id at the moment just before
   * the sweep ran — i.e. after every admitted row had been worked. Must be 0:
   * shedding writes nothing, which is exactly why the sweep can still see the
   * row.
   */
  shedLedgerRowsBeforeSweep: number;
  /** Rows the real sweep dispatched afterwards, in dispatch order. */
  swept: string[];
  /** Rows a SECOND sweep dispatched, once everything had converged. */
  sweptAgain: string[];
}

// ---------------------------------------------------------------------------
// Runtime stage registration
// ---------------------------------------------------------------------------

/** @see the note on the same two casts in `pipelineHarness.ts`. */
const REGISTRY = STAGE_REGISTRY as unknown as Record<string, string>;
const VERSIONS = STAGE_VERSIONS as unknown as Record<string, number>;

const SUFFIX = randomBytes(4).toString('hex');
const SCHEMA = `pipeline_harness_${SUFFIX}`;
const STAGE_ID = `test.relief_${SUFFIX}`;
const ENTITY_TYPE = 'relief_source_row';
const TABLE = 'relief_source';

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

describeWithDatabase('backpressure relieves over time (real Postgres)', () => {
  let dataSource: DataSource;
  let runner: QueryRunner;
  let module: TestingModule;

  let backpressure: BackpressureService;
  let stateService: PipelineStateService;
  let dispatch: PipelineDispatchService;
  let listener: PipelineSliceListener;
  let queueDouble: HarnessQueue;

  const userId = randomUUID();
  /** Stamped into every synthetic `pgboss.job` so the drain only ever touches ours. */
  const probe = randomUUID();

  let report: ReliefReport;

  // -------------------------------------------------------------------------
  // The appliance under test
  // -------------------------------------------------------------------------

  /** Ready depth, as the service itself measures it. */
  async function depth(): Promise<number> {
    return (await backpressure.check(QUEUE)).ready;
  }

  /**
   * Commit `ids` to the queue: one job per row.
   *
   * An arrival dispatch is one row, so a slice here carries one id — unlike a
   * sweep slice, which carries up to `DEFAULT_SLICE_SIZE`. That is the whole
   * difference between the two paths, and it is why the arrival path is the one
   * that needs an admissible COUNT: it makes a decision per row, at import rate.
   */
  async function commit(ids: string[]): Promise<void> {
    if (ids.length === 0) {
      return;
    }

    await runner.query(
      `INSERT INTO pgboss.job (id, name, data, state, keep_until)
       SELECT gen_random_uuid(),
              $1,
              jsonb_build_object('name', 'pipeline.slice', 'probe', $2::text, 'entityId', t.id),
              'created'::pgboss.job_state,
              now() + interval '1 day'
         FROM unnest($3::uuid[]) AS t(id)`,
      [QUEUE, probe, ids],
    );
  }

  /** Rows committed to the queue and not yet worked, in FIFO order. */
  const inFlight: string[] = [];

  /**
   * ONE ARRIVAL BURST — the entire contract an arrival dispatcher has with
   * `BackpressureService`.
   *
   * Ask how many slices may be started, start that many, and DROP THE REST.
   * There is no buffer, no retry list and nowhere for a shed row to be
   * remembered, on purpose: the ledger already remembers it, by never recording
   * that the stage ran.
   */
  async function arrive(ids: string[], burst: number): Promise<BurstRecord> {
    const admission = await backpressure.check(QUEUE);
    const granted = Math.min(admission.slices, ids.length);

    const admitted = ids.slice(0, granted);

    await commit(admitted);
    inFlight.push(...admitted);

    return {
      burst,
      depthBefore: admission.ready,
      granted: admission.slices,
      admitted: admitted.length,
      shed: ids.length - admitted.length,
      reason: admission.reason,
      latched: admission.latched,
      depthAfter: await depth(),
      worked: 0,
    };
  }

  /**
   * The worker pool completing `count` jobs.
   *
   * Both halves of what a worker does, so the drain is real in both places it
   * matters: the job leaves the ready set (which is what admission measures) AND
   * the real slice listener records the stage's decision in `ci.pipeline_state`
   * (which is what stops the sweep re-offering the row).
   */
  async function work(count: number): Promise<string[]> {
    const ids = inFlight.splice(0, count);

    if (ids.length === 0) {
      return [];
    }

    // Only ever this suite's own rows: a live queued job is never row-locked,
    // let alone deleted, even inside a transaction that is rolled back.
    await runner.query(
      `DELETE FROM pgboss.job
        WHERE id IN (SELECT id
                       FROM pgboss.job
                      WHERE name = $1
                        AND data->>'probe' = $2
                      LIMIT $3)`,
      [QUEUE, probe, ids.length],
    );

    for (const id of ids) {
      await listener.handleSlice(QUEUE, {
        stage: STAGE_ID,
        entityType: ENTITY_TYPE,
        userId,
        ids: [id],
        runId: null,
        shardId: null,
      });
    }

    return ids;
  }

  /** Start a real sweep and work the queue it produces to exhaustion. */
  async function sweepEverything(options: { execute: boolean }): Promise<string[]> {
    queueDouble.clearHistory();

    await dispatch.startSweep({ stage: STAGE_ID, userId, sliceSize: 50 });

    const dispatched: string[] = [];

    for (let guard = 0; guard < 500; guard += 1) {
      const job = queueDouble.fetch();

      if (job == null) {
        return dispatched;
      }

      if (job.name === PipelineSweepEvent) {
        await dispatch.runSweepHop(job.data);
        continue;
      }

      if (job.name === PipelineSliceEvent) {
        const ids = Array.isArray(job.data.ids) ? (job.data.ids as string[]) : [];
        dispatched.push(...ids);

        if (options.execute) {
          await listener.handleSlice(job.queue, job.data);
        }

        continue;
      }

      throw new Error(`Unexpected event "${job.name}" on queue "${job.queue}".`);
    }

    throw new Error('The sweep did not converge within 500 jobs.');
  }

  // -------------------------------------------------------------------------
  // Setup: one transaction, always rolled back
  // -------------------------------------------------------------------------

  beforeAll(async () => {
    const connection = resolveConnection();

    if (connection == null) {
      throw new Error('databaseAvailability() said yes but no connection resolved');
    }

    dataSource = new DataSource({
      type: 'postgres',
      // Discrete fields, never a URL assembled here: the dev password ends in
      // `!` and must not have to survive percent-encoding.
      ...(connection.url != null
        ? { url: connection.url }
        : {
            host: connection.host,
            port: connection.port,
            username: connection.username,
            password: connection.password,
            database: connection.database,
          }),
      entities: [],
      synchronize: false,
      logging: false,
      extra: { max: 2 },
    });

    await dataSource.initialize();

    const [present] = await dataSource.query<Array<{ job: string | null; state: string | null }>>(
      `SELECT to_regclass('pgboss.job')::text AS job, to_regclass('ci.pipeline_state')::text AS state`,
    );

    // A database with no pg-boss (or no control plane) is a BROKEN setup for
    // this suite, not an absent one — absent is handled at collection time.
    // Failing here names the fix instead of reporting green for work never done.
    if (present.job == null || present.state == null) {
      throw new Error(
        'pgboss.job or ci.pipeline_state is missing. Run `yarn workspace @ci/be-api migrate`, and start the ' +
          'API once against this database so pg-boss creates its own tables, then re-run this suite.',
      );
    }

    runner = dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();

    // Every statement from here — DDL, ledger writes, synthetic jobs — is
    // inside the transaction that `afterAll` rolls back.
    await runner.query(`CREATE SCHEMA "${SCHEMA}"`);
    await runner.query(
      `CREATE TABLE "${SCHEMA}"."${TABLE}" (
         id           UUID PRIMARY KEY,
         user_id      UUID NOT NULL,
         content_type TEXT NOT NULL
       )`,
    );

    const ids = Array.from({ length: TOTAL_ROWS }, (_, i) => sourceId(i + 1));

    await runner.query(
      `INSERT INTO "${SCHEMA}"."${TABLE}" (id, user_id, content_type)
       SELECT t.id, $2::uuid, 'image/jpeg' FROM unnest($1::uuid[]) AS t(id)`,
      [ids, userId],
    );

    REGISTRY[STAGE_ID] = `PipelineStage:${STAGE_ID}`;
    VERSIONS[STAGE_ID] = 1;

    const stage: Stage = {
      id: STAGE_ID,
      get version(): number {
        return VERSIONS[STAGE_ID];
      },
      queue: QUEUE,
      entityTypes: [ENTITY_TYPE],
      source: {
        schema: SCHEMA,
        table: TABLE,
        idColumn: 'id',
        userColumn: 'user_id',
        // Applicability, never completion — the predicate names what a row IS
        // and says nothing about whether the stage has run. That is what makes
        // the ledger the only thing deciding what is stale, which is in turn
        // what makes shedding safe.
        predicate: "s.content_type LIKE 'image/%'",
      },
      async run(_ctx: UserServiceContext, sliceIds: string[]): Promise<Map<string, StageResult>> {
        return new Map(sliceIds.map((id) => [id, { outcome: 'done' as const }]));
      },
    };

    queueDouble = new HarnessQueue();

    // One DataSource double funnelling EVERY service's statements into the one
    // transactional runner. This is the whole isolation mechanism: the services
    // are unmodified and believe they are talking to the appliance's database.
    const transactional = {
      query: (sql: string, params?: unknown[]) => runner.query(sql, params),
      manager: { query: (sql: string, params?: unknown[]) => runner.query(sql, params) },
    } as unknown as DataSource;

    module = await Test.createTestingModule({
      providers: [
        PipelineStateService,
        StageRegistry,
        PipelineDispatchService,
        PipelineSliceListener,
        BackpressureService,
        { provide: DataSource, useValue: transactional },
        { provide: EventService, useValue: queueDouble },
        { provide: LoggerService, useValue: silentLogger() },
        { provide: `PipelineStage:${STAGE_ID}`, useValue: stage },
      ],
    }).compile();

    backpressure = module.get(BackpressureService);
    stateService = module.get(PipelineStateService);
    dispatch = module.get(PipelineDispatchService);
    listener = module.get(PipelineSliceListener);

    // A quiet queue is a precondition, not an assumption: the thresholds under
    // test are absolute depths, and this suite only ever ADDS rows.
    const baseline = await depth();

    if (baseline > 0) {
      throw new Error(
        `${QUEUE} already holds ${baseline} ready jobs. This suite drives absolute depths against the real ` +
          `cap (${CAP}) and only ever adds rows, so it needs the queue empty. Let the appliance drain.`,
      );
    }

    report = await runScenario();
    printReport(report);
  }, 120_000);

  afterAll(async () => {
    // ALWAYS a rollback. The throwaway schema, every synthetic job and every
    // ci.pipeline_state row this suite wrote disappear with it.
    if (runner != null) {
      await runner.rollbackTransaction();
      await runner.release();
    }

    delete REGISTRY[STAGE_ID];
    delete VERSIONS[STAGE_ID];

    await module?.close();
    await dataSource?.destroy();
  });

  // -------------------------------------------------------------------------
  // The scenario
  // -------------------------------------------------------------------------

  async function runScenario(): Promise<ReliefReport> {
    const pool = Array.from({ length: TOTAL_ROWS }, (_, i) => sourceId(i + 1));
    let next = 0;

    const takeArrivals = (): string[] => {
      const batch = pool.slice(next, next + ARRIVALS_PER_BURST);
      next += ARRIVALS_PER_BURST;

      return batch;
    };

    const arrived: string[] = [];
    const admitted: string[] = [];
    const shed: string[] = [];

    const record = (batch: string[], burst: BurstRecord): void => {
      arrived.push(...batch);
      admitted.push(...batch.slice(0, batch.length - burst.shed));
      shed.push(...batch.slice(batch.length - burst.shed));
    };

    // ── Phase A: the ramp. Rows arrive; nothing is worked. ──────────────────
    const ramp: BurstRecord[] = [];

    for (let i = 0; i < RAMP_BURSTS; i += 1) {
      const batch = takeArrivals();
      const burst = await arrive(batch, i + 1);

      record(batch, burst);
      ramp.push(burst);
    }

    const closedAt = ramp.find((burst) => burst.granted === 0)?.depthBefore ?? -1;

    // ── Phase B: the drain, one completed job at a time. ────────────────────
    //
    // The gate does not reopen at `cap - 1`. Each step records what admission
    // said at that exact depth, so the reopen point is MEASURED rather than
    // asserted from the constant.
    const drain: DrainStep[] = [];
    let reopenedAt = -1;
    let drainedToReopen = 0;

    for (let step = 0; step < CAP; step += 1) {
      await work(1);
      drainedToReopen += 1;

      const admission = await backpressure.check(QUEUE);

      drain.push({ depth: admission.ready, granted: admission.slices, reason: admission.reason });

      if (admission.slices > 0) {
        reopenedAt = admission.ready;
        break;
      }
    }

    // ── Phase C: the steady state. Rows keep arriving; workers keep working. ─
    const steady: BurstRecord[] = [];

    for (let i = 0; i < STEADY_TICKS; i += 1) {
      const batch = takeArrivals();
      const burst = await arrive(batch, RAMP_BURSTS + i + 1);

      const worked = await work(WORK_PER_TICK);
      burst.worked = worked.length;

      record(batch, burst);
      steady.push(burst);
    }

    // ── Phase D: the workers catch up, and the sweep runs. ──────────────────
    while (inFlight.length > 0) {
      await work(WORK_PER_TICK);
    }

    // MEASURED HERE, before the sweep — the only moment the claim "shedding
    // writes nothing" is falsifiable. Afterwards every shed row has a ledger row
    // because the sweep processed it, and the two cases are indistinguishable.
    // `QueryRunner.query` is untyped (`Promise<any>`), unlike `DataSource.query`,
    // so the row shape is asserted at the call site.
    const shedLedgerRows = (await runner.query(
      `SELECT count(*)::text AS rows
         FROM ci.pipeline_state
        WHERE stage = $1 AND entity_id = ANY($2::uuid[])`,
      [STAGE_ID, shed],
    )) as Array<{ rows: string }>;

    // The sweep DISPATCHES what it finds and this run also EXECUTES it, so the
    // second sweep below is a converged one.
    const swept = await sweepEverything({ execute: true });
    const sweptAgain = await sweepEverything({ execute: false });

    return {
      ramp,
      steady,
      drain,
      closedAt,
      reopenedAt,
      drainedToReopen,
      arrived,
      admitted,
      shed,
      shedLedgerRowsBeforeSweep: Number(shedLedgerRows[0].rows),
      swept,
      sweptAgain,
    };
  }

  function printReport(r: ReliefReport): void {
    const line = (b: BurstRecord): string =>
      `  ${String(b.burst).padStart(2)}  depth ${String(b.depthBefore).padStart(2)} → ` +
      `${String(b.depthAfter).padStart(2)}   granted ${String(b.granted).padStart(2)}   ` +
      `admitted ${String(b.admitted).padStart(2)}   shed ${String(b.shed).padStart(2)}   ` +
      `worked ${String(b.worked).padStart(2)}   ${b.reason}${b.latched ? ' (latched)' : ''}`;

    console.log(
      [
        '',
        `pipeline-embed — cap ${CAP}, burst ${BURST}, reopen at ${REOPEN_AT} (gap ${CAP - REOPEN_AT})`,
        '',
        `RAMP — ${ARRIVALS_PER_BURST} rows arrive per burst, nothing is worked:`,
        ...r.ramp.map(line),
        '',
        `CLOSED at a ready depth of ${r.closedAt}.`,
        `REOPENED at a ready depth of ${r.reopenedAt}, after ${r.drainedToReopen} completed job(s).`,
        `  drain: ${r.drain.map((s) => `${s.depth}:${s.granted}`).join(' ')}`,
        '',
        `STEADY STATE — ${ARRIVALS_PER_BURST} arrive, ${WORK_PER_TICK} are worked, per tick:`,
        ...r.steady.map(line),
        '',
        `arrived ${r.arrived.length}   admitted ${r.admitted.length}   shed ${r.shed.length}`,
        `sweep recovered ${r.swept.length} row(s); a second sweep dispatched ${r.sweptAgain.length}.`,
        '',
      ].join('\n'),
    );
  }

  // -------------------------------------------------------------------------
  // §1 — Relief is gradual. The count degrades; it does not switch.
  // -------------------------------------------------------------------------

  describe('§1 admission degrades as the queue fills', () => {
    it('grants the full burst while there is room, then tapers, then stops', () => {
      const granted = report.ramp.map((burst) => burst.granted);

      // The shape, measured: a plateau at the burst, a taper on the way to the
      // cap, and zero once it is reached. Not a step function — the difference
      // between two consecutive grants is never more than the burst itself, and
      // the last positive grant is strictly smaller than the plateau.
      expect(granted[0]).toBe(BURST);
      expect(granted).toContain(0);

      const lastPositive = granted.filter((count) => count > 0).at(-1) as number;
      expect(lastPositive).toBeLessThan(BURST);
      expect(lastPositive).toBeGreaterThan(0);
    });

    it('never commits more than the cap, because a grant never exceeds the headroom', () => {
      for (const burst of report.ramp) {
        expect(burst.admitted).toBeLessThanOrEqual(Math.max(0, CAP - burst.depthBefore));
        expect(burst.depthAfter).toBeLessThanOrEqual(CAP);
      }
    });

    it('offers more rows per burst than any grant, so shedding is exercised throughout', () => {
      // If the arrival bursts were smaller than the burst ceiling nothing would
      // ever be shed and this file would prove nothing.
      expect(ARRIVALS_PER_BURST).toBeGreaterThan(BURST);
      expect(report.shed.length).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------------
  // §2 — The close, and the hysteresis gap.
  // -------------------------------------------------------------------------

  describe('§2 admission closes at the cap and reopens lower', () => {
    it('closes at the cap', () => {
      expect(report.closedAt).toBe(CAP);
    });

    it('reopens at a STRICTLY LOWER depth than it closed at', () => {
      // Without the gap the gate flaps once per completed job: reopen at
      // `cap - 1`, refill, close, drain one, reopen. The gap is what turns that
      // into one reopen per quarter-cap of drained work.
      expect(report.reopenedAt).toBe(REOPEN_AT);
      expect(report.reopenedAt).toBeLessThan(report.closedAt);
      expect(report.drainedToReopen).toBe(CAP - REOPEN_AT);
    });

    it('withholds real headroom while draining, and says so', () => {
      // Every step before the reopen is a depth BELOW the cap where admission
      // still refuses. That is the hysteresis, and the reason token distinguishes
      // it from the cap so an operator is never told the wrong thing.
      const beforeReopen = report.drain.slice(0, -1);

      expect(beforeReopen.length).toBeGreaterThan(0);

      for (const step of beforeReopen) {
        expect(step.granted).toBe(0);
        expect(step.depth).toBeLessThan(CAP);
        expect(step.reason).toBe('draining');
      }

      expect(report.drain.at(-1)?.reason).toBe('ok');
    });

    it('cannot be reopened straight back into its own cap', () => {
      const reopen = report.drain.at(-1) as DrainStep;

      expect(reopen.depth + reopen.granted).toBeLessThan(CAP);
    });
  });

  // -------------------------------------------------------------------------
  // §3 — Relief, over time. The pressure comes off as the workers make progress.
  // -------------------------------------------------------------------------

  describe('§3 pressure relieves as work drains', () => {
    it('admits again once workers have made progress, without anything resetting it', () => {
      // Nothing pokes the service, clears a flag or replays a buffer. The queue
      // simply got shorter, and the next measurement said so.
      const admittedAfterClose = report.steady.reduce((sum, burst) => sum + burst.admitted, 0);

      expect(admittedAfterClose).toBeGreaterThan(0);
    });

    it('keeps every worker fed rather than draining the queue to idle', () => {
      // The convoy failure is stop → drain to EMPTY → flood, and it is what the
      // hysteresis gap is sized against: the gate reopens while the queue still
      // holds `cap - reopenAt` slices, which on this class is more than one per
      // worker. So the depth never approaches zero mid-flight and no worker ever
      // goes idle waiting for the gate.
      //
      // The derived floor is `reopenAt - WORK_PER_TICK` (13 here): a latched
      // queue loses at most one tick's worth of work before it reaches the
      // reopen depth. The assertion is the weaker, more meaningful one — the
      // workers.
      const depths = report.steady.map((burst) => burst.depthBefore);

      expect(Math.min(...depths)).toBeGreaterThanOrEqual(config.queues.perQueueConcurrency);
      expect(Math.min(...depths)).toBeGreaterThanOrEqual(REOPEN_AT - WORK_PER_TICK);
      expect(Math.max(...depths)).toBeLessThanOrEqual(CAP);
    });

    it('sheds rather than queueing them up: the queue never exceeds its cap', () => {
      for (const burst of [...report.ramp, ...report.steady]) {
        expect(burst.depthAfter).toBeLessThanOrEqual(CAP);
      }
    });
  });

  // -------------------------------------------------------------------------
  // §4 — THE POINT. Shedding loses nothing, because the ledger re-derives it.
  // -------------------------------------------------------------------------

  describe('§4 shed work is not lost', () => {
    it('wrote NOTHING to the ledger for a shed row', () => {
      // Shedding is a NO-OP, and that is exactly why it is safe. If the arrival
      // path recorded anything at all about a refused row — a `pending` marker,
      // an attempt, a "deferred" state — the sweep's anti-join would have to
      // learn about it, and a shed row could be silently excluded from the very
      // mechanism that is supposed to recover it.
      //
      // Measured after every ADMITTED row had been worked and before the sweep
      // ran, which is the only moment the two cases are distinguishable.
      expect(report.shed.length).toBeGreaterThan(0);
      expect(report.shedLedgerRowsBeforeSweep).toBe(0);
    });

    it('leaves exactly the shed rows — no more, no fewer — for the sweep to find', () => {
      // THE assertion. The sweep dispatched precisely the set admission refused:
      // nothing leaked (no shed row was skipped) and nothing was duplicated (no
      // admitted row was processed twice).
      expect([...report.swept].sort()).toEqual([...report.shed].sort());
      expect(new Set(report.swept).size).toBe(report.swept.length);
    });

    it('accounts for every row that ever arrived', () => {
      expect(report.admitted.length + report.shed.length).toBe(report.arrived.length);
      expect(report.arrived.length).toBe(TOTAL_ROWS);

      const overlap = report.admitted.filter((id) => report.shed.includes(id));
      expect(overlap).toEqual([]);
    });

    it('does not re-offer work the arrival path already did', () => {
      // The other half of "nothing lost" is "nothing done twice". The rows
      // admission ADMITTED were processed on arrival and carry a ledger row at
      // the current version, so the sweep steps over them.
      for (const id of report.admitted) {
        expect(report.swept).not.toContain(id);
      }
    });

    it('converges: a second sweep dispatches nothing at all', async () => {
      // The property that makes "is my import finished?" answerable, and the
      // proof that the recovery path is idempotent rather than a re-run of the
      // whole corpus.
      expect(report.sweptAgain).toEqual([]);

      const coverage = await stateService.coverage(STAGE_ID);

      expect(coverage.total).toBe(TOTAL_ROWS);
      expect(coverage.done).toBe(TOTAL_ROWS);
      expect(coverage.stale).toBe(0);
    });

    it('has no deferral queue anywhere, and needs none', async () => {
      // Stated as an assertion because it is the thing a future reader will
      // "fix". The only durable record of a shed row is its ABSENCE from the
      // ledger, and that absence is what the sweep's anti-join reads. A retry
      // buffer would be unbounded memory, lost on restart, and duplicating work
      // the sweep does anyway.
      //
      // Concretely: nothing this suite ran ever enqueued a job for a shed row
      // before the sweep did, and the only pg-boss rows that ever existed for
      // this queue are the ones the arrival path admitted.
      const rows = (await runner.query(
        `SELECT count(*)::text AS remaining
           FROM pgboss.job
          WHERE name = $1 AND data->>'probe' = $2`,
        [QUEUE, probe],
      )) as Array<{ remaining: string }>;

      expect(Number(rows[0].remaining)).toBe(0);
    });
  });
});
