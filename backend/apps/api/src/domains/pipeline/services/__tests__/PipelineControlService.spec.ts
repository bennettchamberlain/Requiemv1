import { randomUUID } from 'node:crypto';

import { DataSource, type QueryRunner } from 'typeorm';

import type { LoggerService } from '@ci/common/logging';

import { databaseAvailability, resolveConnection } from '../../__tests__/harness/pipelineHarness';
import { SHARD_LEASE_SECONDS, STAGE_IDS, STAGE_ID_LIST, type StageId } from '../../constants';
import { stageSchedule } from '../../schedule';
import type { Stage } from '../../types';
import {
  CONTINUOUS_RUN_KIND,
  MAX_SWEEPS_PER_TICK,
  METERED_STAGES,
  PipelineControlService,
  SHARD_STATUS,
  STAGE_DEPENDENCIES,
  assertStagePolicy,
  defaultStageSet,
  isMeteredStage,
  orderStages,
  type StageLeg,
} from '../PipelineControlService';
import type { PipelineDispatchService } from '../PipelineDispatchService';
import type { PipelineRunService } from '../PipelineRunService';
import type { PipelineStateService } from '../PipelineStateService';
import type { StageRegistry } from '../StageRegistry';

/**
 * The control tick is the answer to a specific, measured absence: twelve stages
 * resolved, `startSweep()` worked, `PipelineSliceListener` executed slices — and
 * NOTHING CALLED ANY OF IT. No cron, no scheduled caller, no route.
 * `ci.pipeline_runs` had never held a row and `SHARD_LEASE_SECONDS` was declared
 * and unused. So the properties under test here are not "the tick runs"; they are
 * the five ways a control loop over this schema silently ruins an appliance:
 *
 *  1. **A cancelled run that nobody finalises is a permanent lockout.**
 *     `pipeline_runs_active_uniq` is a partial unique index on `(user_id) WHERE
 *     finished_at IS NULL`, and cancel writes only `desired_state`. Every test
 *     about cancellation is really a test that `finishRun` was called.
 *  2. **A sweep that finds nothing is not free**, and there are twelve stages
 *     multiplied by every tick, forever.
 *  3. **A consumer run ahead of its producer writes a corpus of skips** that
 *     only a version bump can re-open.
 *  4. **An expired shard lease strands a leg forever**, because the claim refuses
 *     a leg it believes somebody is inside.
 *  5. **A metered stage started by a timer is a recurring bill.**
 *     `enrich.geocode` and `enrich.position_reverse` egress to a paid provider.
 *
 * ## Two halves, because the behaviour lives in two places
 *
 * **Against fakes** — the decisions: what the tick reads, what it refuses to
 * start, the order it starts things in, and that a failure anywhere never
 * escapes the cron. Fast, hermetic, always runs.
 *
 * **Against real Postgres** — the two statements whose semantics are ENTIRELY in
 * SQL: the shard-lease reap and the `ON CONFLICT ... WHERE` claim. Whether a live
 * lease actually refuses a second claimant, whether `done` is re-claimable (it
 * must be — see the wedge argument on `UNCLAIMABLE_SHARD_STATUSES`), and whether
 * the reaper leaves terminal shards alone are not observable from a mock, because
 * a mock agrees with whatever the statement asks it.
 *
 * ## How the database half stays out of the dev data
 *
 * Same discipline as `DeadLetterReaperListener.spec`: the service is handed a
 * `DataSource` double funnelling every statement into ONE `QueryRunner` inside a
 * transaction that is **always rolled back**. Nothing is committed — not the
 * synthetic run, not its shards — so no other session can observe them, there is
 * nothing to clean up, and a `kill -9` mid-run leaves the live appliance's
 * 324,044 events untouched.
 */

const availability = databaseAvailability();
const describeWithDatabase = availability.available ? describe : describe.skip;

if (!availability.available) {
  console.warn(`[PipelineControlService.spec] SKIPPED (database half) — ${availability.reason}`);
}

// ---------------------------------------------------------------------------
// Half one: the decisions, against fakes
// ---------------------------------------------------------------------------

/** One statement the tick issued, whitespace-collapsed and lowercased for matching. */
interface Statement {
  sql: string;
  params: unknown[];
}

/** A user row as {@link PipelineControlService} reads it, plus its active run. */
interface UserRow {
  user_id: string;
  run_id: string | null;
  kind: string | null;
  desired_state: string | null;
  detail: Record<string, unknown> | null;
}

interface ControlOptions {
  /** Whether `pg_try_advisory_lock` grants. An array is consumed one tick at a time. */
  lock?: boolean | boolean[];

  /** Whether the control-plane tables exist. */
  controlPlane?: boolean;

  users?: UserRow[];

  /** Stage legs with stale rows, as `stageId` or `stageId|entityType`. */
  stale?: string[];

  /** Entity types per stage. Defaults to one type named `event`. */
  entityTypes?: Partial<Record<StageId, string[]>>;

  /** Shard leases the reap statement reclaims. */
  reaped?: number;

  /** Does any non-terminal shard of the run still hold a live lease? */
  liveLease?: boolean;

  /** Stage ids whose shard claim is refused — i.e. another tick owns the leg. */
  claimDenied?: string[];

  /** What `startRun` answers with. */
  startRun?: { id?: string; desiredState?: string; created?: boolean };

  /** Stage ids the registry cannot resolve. */
  unbound?: string[];

  /** Make the staleness probe throw for this user id. */
  probeThrowsForUser?: string;

  /** Make `startSweep` throw for these stage ids. */
  sweepThrows?: string[];

  /** Make any statement matching this throw, the way a dead connection would. */
  failOn?: RegExp;
}

const USER_A = '00000000-0000-4000-8000-0000000000a1';
const USER_B = '00000000-0000-4000-8000-0000000000b2';
const RUN_A = '00000000-0000-4000-8000-0000000000c3';

/** A user with an active, running run. */
function runningRun(overrides: Partial<UserRow> = {}): UserRow {
  return {
    user_id: USER_A,
    run_id: RUN_A,
    kind: CONTINUOUS_RUN_KIND,
    desired_state: 'running',
    detail: {},
    ...overrides,
  };
}

/** A user with no active run at all. */
function noRun(overrides: Partial<UserRow> = {}): UserRow {
  return { user_id: USER_A, run_id: null, kind: null, desired_state: null, detail: null, ...overrides };
}

function makeControl(options: ControlOptions = {}) {
  const statements: Statement[] = [];
  const unlocks: number[] = [];
  const lockAnswers = Array.isArray(options.lock) ? [...options.lock] : null;
  const released: string[] = [];

  const record = (raw: string, params?: unknown[]): Statement => {
    const sql = raw.replace(/\s+/g, ' ').trim().toLowerCase();
    const statement = { sql, params: params ?? [] };
    statements.push(statement);

    return statement;
  };

  const query = jest.fn(async (raw: string, params?: unknown[]) => {
    const { sql } = record(raw, params);

    if (options.failOn != null && options.failOn.test(sql)) {
      throw new Error('connection terminated unexpectedly');
    }

    if (/to_regclass/.test(sql)) {
      return [{ present: options.controlPlane ?? true }];
    }

    // The lease reap. A CTE, not a bare UPDATE — see the test that pins why.
    if (sql.startsWith('with reaped as')) {
      return Array.from({ length: options.reaped ?? 0 }, () => ({ id: randomUUID() }));
    }

    // The cancellation tear-down: the only UPDATE scoped by `run_id`.
    if (sql.startsWith('update ci.pipeline_shards') && /where run_id/.test(sql)) {
      return [];
    }

    if (/from ci\.users/.test(sql)) {
      return options.users ?? [];
    }

    // The claim and the drain are both upserts on the same table; only the claim
    // takes a lease, so `make_interval` is what tells them apart.
    if (sql.startsWith('insert into ci.pipeline_shards') && /make_interval/.test(sql)) {
      const stageId = String(params?.[1] ?? '');

      return (options.claimDenied ?? []).includes(stageId) ? [] : [{ id: randomUUID() }];
    }

    if (sql.startsWith('insert into ci.pipeline_shards')) {
      return [];
    }

    if (sql.startsWith('select s.id from ci.pipeline_shards')) {
      return (options.liveLease ?? false) ? [{ id: randomUUID() }] : [];
    }

    throw new Error(`PipelineControlService issued an unexpected statement: ${sql}`);
  });

  const runnerQuery = jest.fn(async (raw: string, params?: unknown[]) => {
    record(raw, params);

    if (/pg_try_advisory_lock/.test(raw)) {
      const granted = lockAnswers != null ? (lockAnswers.shift() ?? false) : (options.lock ?? true);

      return [{ locked: granted }];
    }

    if (/pg_advisory_unlock/.test(raw)) {
      unlocks.push(statements.length);

      return [{ pg_advisory_unlock: true }];
    }

    throw new Error(`PipelineControlService issued an unexpected runner statement: ${raw}`);
  });

  const dataSource = {
    query,
    createQueryRunner: jest.fn(() => ({
      connect: jest.fn(async () => undefined),
      query: runnerQuery,
      release: jest.fn(async () => {
        released.push('released');
      }),
    })),
  };

  const entityTypesFor = (stageId: StageId): string[] => options.entityTypes?.[stageId] ?? ['event'];

  const stageRegistry = {
    get: jest.fn((stageId: string): Stage => {
      if ((options.unbound ?? []).includes(stageId)) {
        throw new Error(`no provider is bound to token "PipelineStage:${stageId}"`);
      }

      return {
        id: stageId,
        version: 1,
        queue: 'pipeline-index',
        entityTypes: entityTypesFor(stageId as StageId),
        source: { schema: 'ci', table: 'events', idColumn: 'id', userColumn: 'user_id' },
        run: async () => new Map(),
      };
    }),
  };

  const stale = new Set(options.stale ?? []);

  const stateService = {
    selectStale: jest.fn(
      async (stage: Stage, userId: string, _cursor: unknown, limit: number, entityType: string) => {
        if (options.probeThrowsForUser === userId) {
          throw new Error('probe exploded');
        }

        // Asserted rather than assumed: the probe must be LIMIT 1. A probe that
        // paged like a sweep would cost the tick a full slice per stage per tick.
        expect(limit).toBe(1);

        const hit = stale.has(stage.id) || stale.has(`${stage.id}|${entityType}`);

        return hit ? [randomUUID()] : [];
      },
    ),
  };

  const runService = {
    startRun: jest.fn(
      async (ctx: { userId: string }, input: { kind: string; detail?: Record<string, unknown> }) => ({
        run: {
          id: options.startRun?.id ?? RUN_A,
          // Echoed back, exactly as the real service does: the run the tick goes on
          // to reconcile is whatever the database handed back, not what was asked
          // for, which is the whole point of `created: false`.
          userId: ctx.userId,
          kind: input.kind,
          detail: input.detail ?? {},
          desiredState: options.startRun?.desiredState ?? 'running',
        },
        created: options.startRun?.created ?? true,
      }),
    ),
    finishRun: jest.fn(async () => null),
  };

  const dispatchService = {
    startSweep: jest.fn(async (input: { stage: string }) => {
      if ((options.sweepThrows ?? []).includes(input.stage)) {
        throw new Error(`Unknown pipeline stage "${input.stage}"`);
      }
    }),
  };

  const logger = {
    setContext: jest.fn(),
    log: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    verbose: jest.fn(),
  };

  const service = new PipelineControlService(
    dataSource as unknown as DataSource,
    stateService as unknown as PipelineStateService,
    runService as unknown as PipelineRunService,
    dispatchService as unknown as PipelineDispatchService,
    stageRegistry as unknown as StageRegistry,
    logger as unknown as LoggerService,
  );

  return {
    service,
    statements,
    unlocks,
    released,
    logger,
    stateService,
    runService,
    dispatchService,
    stageRegistry,
    /** Stage ids the tick actually dispatched a sweep for, in order. */
    swept: (): string[] =>
      dispatchService.startSweep.mock.calls.map((call) => (call[0] as { stage: string }).stage),
    /** Indexes into `statements` matching a pattern — for ORDER assertions. */
    indexOf: (pattern: RegExp): number => statements.findIndex((statement) => pattern.test(statement.sql)),
  };
}

describe('PipelineControlService', () => {
  // -------------------------------------------------------------------------
  // The declared policy
  // -------------------------------------------------------------------------

  describe('the tick policy, as declared', () => {
    it('is internally consistent — every edge names a declared stage and the graph is acyclic', () => {
      expect(() => assertStagePolicy()).not.toThrow();
    });

    it('refuses an edge to a stage that does not exist', () => {
      // The failure this guards is silent: an edge naming a typo is an edge that
      // never blocks anything, so a consumer would quietly run ahead of its
      // producer forever with nothing to see.
      const graph = STAGE_DEPENDENCIES as Record<string, readonly string[]>;
      graph['enrich.typo'] = [STAGE_IDS.ENRICH_GEOCODE];

      try {
        expect(() => assertStagePolicy()).toThrow(/enrich\.typo/);
      } finally {
        delete graph['enrich.typo'];
      }
    });

    it('refuses a cycle', () => {
      const graph = STAGE_DEPENDENCIES as Record<string, readonly StageId[]>;
      const original = graph[STAGE_IDS.ENRICH_GEOCODE];
      graph[STAGE_IDS.ENRICH_GEOCODE] = [STAGE_IDS.PROMOTE_PLACE];

      try {
        expect(() => assertStagePolicy()).toThrow(/cycle/i);
      } finally {
        if (original == null) {
          delete graph[STAGE_IDS.ENRICH_GEOCODE];
        } else {
          graph[STAGE_IDS.ENRICH_GEOCODE] = original;
        }
      }
    });

    it('orders every producer ahead of every consumer', () => {
      const ordered = orderStages([...STAGE_ID_LIST]);

      expect(new Set(ordered)).toEqual(new Set(STAGE_ID_LIST));

      for (const [consumer, producers] of Object.entries(STAGE_DEPENDENCIES)) {
        for (const producer of producers ?? []) {
          expect(ordered.indexOf(producer as StageId)).toBeLessThan(ordered.indexOf(consumer as StageId));
        }
      }
    });

    it('drops an edge to a producer that is not in the set being ordered', () => {
      // A run that names only some stages must still be orderable. An edge to a
      // stage the run does not include is not a dependency of that run.
      const subset = orderStages([STAGE_IDS.PROMOTE_PLACE, STAGE_IDS.ENRICH_MEDIA_DIMENSIONS]);

      expect(subset).toEqual([STAGE_IDS.ENRICH_MEDIA_DIMENSIONS, STAGE_IDS.PROMOTE_PLACE]);
    });

    it('keeps every metered stage out of the default set UNTIL the dueness gate lands', () => {
      // The decided policy is weekly, not never — `schedule.ts` declares a 7-day
      // minInterval, the enrichment window and a perRunCap for both metered
      // stages, and this asserts that declaration is intact.
      //
      // But the tick does not yet CONSULT it (no per-leg lastStartedAt, no
      // perRunCap enforcement), so the default set still excludes them. Admitting
      // them before the gate exists would make a weekly stage reachable every
      // five minutes. When the gate lands, `defaultStageSet` returns
      // `automaticStageIds()` and the first assertion below flips to `toContain`.
      for (const stageId of METERED_STAGES) {
        expect(STAGE_ID_LIST).toContain(stageId);
        expect(defaultStageSet()).not.toContain(stageId);

        const policy = stageSchedule(stageId);

        expect(policy.cost).toBe('metered');
        expect(policy.trigger).not.toBe('onArrival');
        expect(policy.window).toBe('enrichment');
        // SECONDS, not milliseconds — schedule.ts's units, and it warns about
        // exactly this confusion. 7 days = 604_800.
        expect(policy.minInterval).toBeGreaterThanOrEqual(7 * 24 * 60 * 60);
        expect(policy.perRunCap).toBeGreaterThan(0);
      }

      expect(isMeteredStage(STAGE_IDS.ENRICH_GEOCODE)).toBe(true);
      expect(isMeteredStage(STAGE_IDS.ENRICH_POSITION_REVERSE)).toBe(true);
      expect(isMeteredStage(STAGE_IDS.ENRICH_MEDIA_DIMENSIONS)).toBe(false);
    });

    it('leaves every automatic stage IN the default set, so the tick is not quietly inert', () => {
      // The opposite failure to the one above, and the one this whole file
      // exists to fix: a pipeline nothing starts.
      const expected = STAGE_ID_LIST.filter((stageId) => !isMeteredStage(stageId));

      expect(defaultStageSet()).toEqual(expected);
      expect(defaultStageSet().length).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------------
  // desired_state
  // -------------------------------------------------------------------------

  describe('honouring desired_state', () => {
    it('starts nothing for a paused run', async () => {
      const h = makeControl({
        users: [runningRun({ desired_state: 'paused' })],
        stale: [...STAGE_ID_LIST],
      });

      const report = await h.service.tick();

      expect(report.runsPaused).toBe(1);
      expect(h.dispatchService.startSweep).not.toHaveBeenCalled();
      expect(h.runService.finishRun).not.toHaveBeenCalled();
    });

    it('does not even probe a paused run', async () => {
      // A paused run must cost nothing. Probing twelve stages for a run that is
      // not allowed to start anything is the most expensive way to do nothing.
      const h = makeControl({ users: [runningRun({ desired_state: 'paused' })], stale: [...STAGE_ID_LIST] });

      await h.service.tick();

      expect(h.stateService.selectStale).not.toHaveBeenCalled();
    });

    it('starts nothing for a cancelled run, however much work is outstanding', async () => {
      const h = makeControl({
        users: [runningRun({ desired_state: 'cancelled' })],
        stale: [...STAGE_ID_LIST],
      });

      await h.service.tick();

      expect(h.dispatchService.startSweep).not.toHaveBeenCalled();
      expect(h.stateService.selectStale).not.toHaveBeenCalled();
    });

    it('FINALISES a cancelled run, because an unfinalised one locks the user out forever', async () => {
      // `pipeline_runs_active_uniq` is `(user_id) WHERE finished_at IS NULL`, and
      // cancelling writes only `desired_state`. Without this call the run stays
      // active for the life of the appliance and every later startRun returns it.
      const h = makeControl({ users: [runningRun({ desired_state: 'cancelled' })] });

      const report = await h.service.tick();

      expect(h.runService.finishRun).toHaveBeenCalledTimes(1);
      expect(h.runService.finishRun).toHaveBeenCalledWith(RUN_A, 'cancelled', expect.any(Object));
      expect(report.runsFinalized).toBe(1);
    });

    it('marks a cancelled run’s unleased shards cancelled', async () => {
      const h = makeControl({ users: [runningRun({ desired_state: 'cancelled' })] });

      await h.service.tick();

      const teardown = h.statements.find(
        (statement) =>
          statement.sql.startsWith('update ci.pipeline_shards') && /where run_id/.test(statement.sql),
      );

      expect(teardown).toBeDefined();
      expect(teardown?.params).toEqual([
        RUN_A,
        SHARD_STATUS.CANCELLED,
        expect.arrayContaining([SHARD_STATUS.DONE]),
      ]);
    });

    it('waits one tick before finalising a cancelled run a worker is still inside', async () => {
      // The shard holds a live lease: a worker is mid-slice. Finalising now would
      // abandon a claim rather than let the ledger record what it decided. The
      // wait is bounded — an unrenewed lease always expires.
      const h = makeControl({ users: [runningRun({ desired_state: 'cancelled' })], liveLease: true });

      const report = await h.service.tick();

      expect(h.runService.finishRun).not.toHaveBeenCalled();
      expect(report.runsFinalized).toBe(0);
    });

    it('finalises the same cancelled run once the lease has gone', async () => {
      const h = makeControl({ users: [runningRun({ desired_state: 'cancelled' })], liveLease: false });

      await h.service.tick();

      expect(h.runService.finishRun).toHaveBeenCalledWith(RUN_A, 'cancelled', expect.any(Object));
    });

    it('abandons a tick that loses a startRun race to a paused run', async () => {
      // Another actor created the run between our read and our insert, and it is
      // not running. Honouring desired_state outranks the work we were about to
      // start.
      const h = makeControl({
        users: [noRun()],
        stale: [STAGE_IDS.ENRICH_MEDIA_DIMENSIONS],
        startRun: { created: false, desiredState: 'paused' },
      });

      await h.service.tick();

      expect(h.dispatchService.startSweep).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Deciding what is worth sweeping
  // -------------------------------------------------------------------------

  describe('deciding what is worth sweeping', () => {
    it('starts no sweep at all when nothing is stale', async () => {
      const h = makeControl({ users: [runningRun()], stale: [] });

      const report = await h.service.tick();

      expect(h.dispatchService.startSweep).not.toHaveBeenCalled();
      expect(report.sweepsStarted).toBe(0);
    });

    it('probes with LIMIT 1 rather than paging like a sweep', async () => {
      // Asserted inside the fake `selectStale`; this test is what makes the
      // twelve-stages-per-tick cost argument true rather than aspirational.
      const h = makeControl({ users: [runningRun()], stale: [] });

      await h.service.tick();

      expect(h.stateService.selectStale).toHaveBeenCalled();
      for (const call of h.stateService.selectStale.mock.calls) {
        expect(call[3]).toBe(1);
      }
    });

    it('asks the LEDGER, never a second copy of the staleness predicate', async () => {
      // The tick issues no candidate query of its own. Every "is there work?"
      // goes through PipelineStateService.selectStale — THE ONE RULE — so the
      // definition of stale cannot drift from the one that dispatches.
      const h = makeControl({ users: [runningRun()], stale: [] });

      await h.service.tick();

      for (const { sql } of h.statements) {
        expect(sql).not.toMatch(/from ci\.pipeline_state/);
      }
    });

    it('creates no run for a user with nothing to do', async () => {
      const h = makeControl({ users: [noRun()], stale: [] });

      const report = await h.service.tick();

      expect(h.runService.startRun).not.toHaveBeenCalled();
      expect(report.runsStarted).toBe(0);
    });

    it('starts a continuous run for a user who has stale work and no run', async () => {
      const h = makeControl({ users: [noRun()], stale: [STAGE_IDS.ENRICH_MEDIA_DIMENSIONS] });

      const report = await h.service.tick();

      expect(h.runService.startRun).toHaveBeenCalledWith(
        { userId: USER_A },
        expect.objectContaining({ kind: CONTINUOUS_RUN_KIND }),
      );
      expect(report.runsStarted).toBe(1);
      expect(h.swept()).toContain(STAGE_IDS.ENRICH_MEDIA_DIMENSIONS);
    });

    it('finalises a drained run, so the user is free to start another', async () => {
      const h = makeControl({ users: [runningRun()], stale: [] });

      const report = await h.service.tick();

      expect(h.runService.finishRun).toHaveBeenCalledWith(RUN_A, 'completed', expect.any(Object));
      expect(report.runsFinalized).toBe(1);
      expect(report.legsDrained).toBeGreaterThan(0);
    });

    it('does not finalise a drained run while a worker still holds a shard', async () => {
      const h = makeControl({ users: [runningRun()], stale: [], liveLease: true });

      await h.service.tick();

      expect(h.runService.finishRun).not.toHaveBeenCalled();
    });

    it('records the drained legs BEFORE asking about leases, so finalising is not delayed', async () => {
      // Nothing releases a shard lease when a sweep finishes — it is a deadline,
      // not a handshake. Asking about leases first would keep every run open for
      // up to SHARD_LEASE_SECONDS after its last leg drained, for no reason.
      const h = makeControl({ users: [runningRun()], stale: [] });

      await h.service.tick();

      const drainIndex = h.indexOf(/^insert into ci\.pipeline_shards/);
      const leaseIndex = h.indexOf(/^select s\.id from ci\.pipeline_shards/);

      expect(drainIndex).toBeGreaterThanOrEqual(0);
      expect(leaseIndex).toBeGreaterThan(drainIndex);
    });

    it('never starts more than MAX_SWEEPS_PER_TICK sweeps, whatever is outstanding', async () => {
      // Effective global concurrency is ten in-flight jobs and one sweep hop
      // enqueues five slices. More sweeps do not buy throughput; they contend.
      const h = makeControl({ users: [runningRun()], stale: [...STAGE_ID_LIST] });

      const report = await h.service.tick();

      expect(report.sweepsStarted).toBe(MAX_SWEEPS_PER_TICK);
      expect(h.swept()).toHaveLength(MAX_SWEEPS_PER_TICK);
    });

    it('names the entityType on every sweep, including single-type stages', async () => {
      // The shard is keyed by (run, stage, shard_key = entityType). Letting the
      // dispatcher default would let the shard and the ledger disagree about
      // which type was swept.
      const h = makeControl({
        users: [runningRun()],
        stale: [`${STAGE_IDS.CLEAN_IDENTIFIER_NORMALIZE}|entity`],
        entityTypes: { [STAGE_IDS.CLEAN_IDENTIFIER_NORMALIZE]: ['entity'] },
      });

      await h.service.tick();

      expect(h.dispatchService.startSweep).toHaveBeenCalledWith(
        expect.objectContaining({ stage: STAGE_IDS.CLEAN_IDENTIFIER_NORMALIZE, entityType: 'entity' }),
      );
    });

    it('treats a multi-type stage as one leg per type', async () => {
      const h = makeControl({
        users: [runningRun()],
        entityTypes: { [STAGE_IDS.ENRICH_MEDIA_DIMENSIONS]: ['file', 'content'] },
        stale: [`${STAGE_IDS.ENRICH_MEDIA_DIMENSIONS}|content`],
      });

      await h.service.tick();

      expect(h.dispatchService.startSweep).toHaveBeenCalledTimes(1);
      expect(h.dispatchService.startSweep).toHaveBeenCalledWith(
        expect.objectContaining({ entityType: 'content' }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // Ordering
  // -------------------------------------------------------------------------

  describe('respecting stage dependencies', () => {
    it('holds a consumer back while its producer still has stale rows', async () => {
      // `promote.place` reads the coordinates `enrich.geocode` writes and the
      // hierarchy it cached. Promoting first promotes the events that already had
      // coordinates and records `done` for a corpus it has not seen.
      const h = makeControl({
        users: [runningRun({ detail: { stages: [STAGE_IDS.ENRICH_GEOCODE, STAGE_IDS.PROMOTE_PLACE] } })],
        stale: [STAGE_IDS.ENRICH_GEOCODE, STAGE_IDS.PROMOTE_PLACE],
      });

      const report = await h.service.tick();

      expect(h.swept()).toEqual([STAGE_IDS.ENRICH_GEOCODE]);
      expect(report.legsBlocked).toBe(1);
    });

    it('releases the consumer on the tick after the producer drains', async () => {
      const h = makeControl({
        users: [runningRun({ detail: { stages: [STAGE_IDS.ENRICH_GEOCODE, STAGE_IDS.PROMOTE_PLACE] } })],
        stale: [STAGE_IDS.PROMOTE_PLACE],
      });

      await h.service.tick();

      expect(h.swept()).toEqual([STAGE_IDS.PROMOTE_PLACE]);
    });

    it('blocks transitively, so a grandchild does not run ahead of a grandparent', async () => {
      // identifier_normalize -> person_link -> duplicate_detect. Only the first
      // has candidates; `duplicate_detect` has none of its own but its evidence
      // table has not been written yet, and running it now would record
      // `skipped: no_identifier_claims` across the corpus.
      const h = makeControl({
        users: [
          runningRun({
            detail: {
              stages: [
                STAGE_IDS.CLEAN_IDENTIFIER_NORMALIZE,
                STAGE_IDS.ENRICH_PERSON_LINK,
                STAGE_IDS.CLEAN_DUPLICATE_DETECT,
              ],
            },
          }),
        ],
        stale: [STAGE_IDS.CLEAN_IDENTIFIER_NORMALIZE, STAGE_IDS.CLEAN_DUPLICATE_DETECT],
      });

      await h.service.tick();

      expect(h.swept()).toEqual([STAGE_IDS.CLEAN_IDENTIFIER_NORMALIZE]);
    });

    it('never records a blocked leg as drained', async () => {
      // The wedge this prevents: `promote.place` has nothing stale YET because
      // its producer has not filled the column its predicate reads. Marking it
      // `done` would retire it from a run it has not begun.
      const h = makeControl({
        users: [runningRun({ detail: { stages: [STAGE_IDS.ENRICH_GEOCODE, STAGE_IDS.PROMOTE_PLACE] } })],
        stale: [STAGE_IDS.ENRICH_GEOCODE],
      });

      const report = await h.service.tick();

      expect(report.legsBlocked).toBe(1);
      expect(report.legsDrained).toBe(0);

      const drains = h.statements.filter(
        (statement) =>
          statement.sql.startsWith('insert into ci.pipeline_shards') && !/make_interval/.test(statement.sql),
      );

      expect(drains).toHaveLength(0);
    });

    it('does not let a producer that is not in the run block anything', async () => {
      // THE deadlock this rule avoids: `enrich.geocode` is metered, so it is
      // never in the default set and therefore always has stale rows. If an
      // absent producer counted, `enrich.estimate_location` and `promote.place`
      // would be blocked on it for the life of the appliance — cost discipline
      // silently disabling a third of the pipeline.
      const h = makeControl({
        users: [runningRun()],
        stale: [STAGE_IDS.ENRICH_GEOCODE, STAGE_IDS.ENRICH_ESTIMATE_LOCATION],
      });

      await h.service.tick();

      expect(h.swept()).toEqual([STAGE_IDS.ENRICH_ESTIMATE_LOCATION]);
    });

    it('dispatches producers before consumers within one tick', async () => {
      const h = makeControl({
        users: [
          runningRun({
            detail: { stages: [STAGE_IDS.PROMOTE_PLACE, STAGE_IDS.ENRICH_ESTIMATE_LOCATION] },
          }),
        ],
        stale: [STAGE_IDS.ENRICH_ESTIMATE_LOCATION],
      });

      await h.service.tick();

      // The consumer is blocked, so only the producer runs — and the run's stage
      // list was written consumer-first on purpose, to prove the order comes from
      // the graph and not from the caller's array.
      expect(h.swept()).toEqual([STAGE_IDS.ENRICH_ESTIMATE_LOCATION]);
    });
  });

  // -------------------------------------------------------------------------
  // Cost discipline
  // -------------------------------------------------------------------------

  describe('metered stages', () => {
    it('never auto-sweeps a metered stage, however stale it is', async () => {
      const h = makeControl({ users: [runningRun()], stale: [...STAGE_ID_LIST] });

      await h.service.tick();

      for (const stageId of METERED_STAGES) {
        expect(h.swept()).not.toContain(stageId);
      }
    });

    it('never auto-sweeps a metered stage for a run the tick started itself', async () => {
      const h = makeControl({ users: [noRun()], stale: [...STAGE_ID_LIST] });

      await h.service.tick();

      const input = h.runService.startRun.mock.calls[0]?.[1];

      // The run the tick creates names no stages at all, so it can only ever get
      // the default set — which is where the exclusion lives.
      expect(input?.detail).not.toHaveProperty('stages');
      expect(h.swept()).not.toContain(STAGE_IDS.ENRICH_GEOCODE);
    });

    it('sweeps a metered stage when — and only when — a run NAMES it', async () => {
      // The deliberate act. A human wrote this stage id into the run's detail,
      // which is the whole difference between an authorised bill and a loop.
      const h = makeControl({
        users: [runningRun({ kind: 'reprocess', detail: { stages: [STAGE_IDS.ENRICH_GEOCODE] } })],
        stale: [STAGE_IDS.ENRICH_GEOCODE],
      });

      await h.service.tick();

      expect(h.swept()).toEqual([STAGE_IDS.ENRICH_GEOCODE]);
    });

    it('falls back to the default set — not to nothing — when detail.stages is unusable', async () => {
      // An empty set would make the run instantly "drained" and finalise it, so a
      // typo would be indistinguishable from a complete, successful run.
      const h = makeControl({
        users: [runningRun({ detail: { stages: ['enrich.nonexistent'] } })],
        stale: [...STAGE_ID_LIST],
      });

      await h.service.tick();

      expect(h.swept().length).toBeGreaterThan(0);
      expect(h.swept()).not.toContain(STAGE_IDS.ENRICH_GEOCODE);
      expect(h.logger.warn).toHaveBeenCalled();
    });

    it.each([
      ['a string', 'enrich.geocode'],
      ['a number', 7],
      ['null', null],
    ])('falls back to the default set when detail.stages is %s', async (_label, stages) => {
      const h = makeControl({
        users: [runningRun({ detail: { stages } as Record<string, unknown> })],
        stale: [STAGE_IDS.ENRICH_MEDIA_DIMENSIONS, STAGE_IDS.ENRICH_GEOCODE],
      });

      await h.service.tick();

      expect(h.swept()).toEqual([STAGE_IDS.ENRICH_MEDIA_DIMENSIONS]);
    });
  });

  // -------------------------------------------------------------------------
  // Re-entrancy
  // -------------------------------------------------------------------------

  describe('re-entrancy', () => {
    it('does nothing at all when another tick holds the advisory lock', async () => {
      const h = makeControl({ lock: false, users: [runningRun()], stale: [...STAGE_ID_LIST] });

      const report = await h.service.tick();

      expect(report.skipped).toBe(true);
      expect(report.skipReason).toMatch(/advisory lock/);
      expect(h.dispatchService.startSweep).not.toHaveBeenCalled();
      expect(h.stateService.selectStale).not.toHaveBeenCalled();
      // Not one statement outside the lock attempt itself.
      expect(h.statements).toHaveLength(1);
    });

    it('takes the lock in POSTGRES, not in a field on the service', async () => {
      // An in-memory guard gives the same answer today and the wrong one the day
      // the worker process is split out — which is the change this file exists to
      // survive. `pg_try_advisory_lock` is shared by every replica of every
      // process pointed at this database.
      const h = makeControl({ users: [runningRun()], stale: [] });

      await h.service.tick();

      expect(h.statements[0].sql).toMatch(/pg_try_advisory_lock/);
    });

    it('tries the lock rather than waiting for it', async () => {
      // The blocking form would queue every replica's cron behind the winner and
      // then run them all in sequence — a slower version of the double dispatch
      // it was meant to prevent.
      const h = makeControl({ users: [runningRun()], stale: [] });

      await h.service.tick();

      for (const { sql } of h.statements) {
        expect(sql).not.toMatch(/pg_advisory_lock\(/);
      }
    });

    it('releases the lock before the connection goes back to the pool', async () => {
      // A session-level lock outlives the transaction but not the backend. Left
      // held on a POOLED connection it would wedge every later tick until that
      // connection is recycled.
      const h = makeControl({ users: [runningRun()], stale: [] });

      await h.service.tick();

      expect(h.unlocks).toHaveLength(1);
      expect(h.released).toHaveLength(1);
    });

    it('releases the lock even when the pass throws', async () => {
      // A tick that died holding the lock would wedge every later tick until the
      // pooled connection was recycled — a stall measured in minutes, caused by
      // an error that was already being reported.
      const h = makeControl({ users: [runningRun()], failOn: /from ci\.users/ });

      await expect(h.service.tick()).rejects.toThrow('connection terminated');

      expect(h.unlocks).toHaveLength(1);
      expect(h.released).toHaveLength(1);
    });

    it('lets exactly one of two overlapping ticks do the work', async () => {
      const h = makeControl({
        lock: [true, false],
        users: [runningRun()],
        stale: [STAGE_IDS.ENRICH_MEDIA_DIMENSIONS],
      });

      const [first, second] = await Promise.all([h.service.tick(), h.service.tick()]);

      expect([first.skipped, second.skipped].sort()).toEqual([false, true]);
      expect(h.dispatchService.startSweep).toHaveBeenCalledTimes(1);
    });

    it('starts nothing for a leg whose shard lease another tick already holds', async () => {
      // The correctness boundary, independent of the advisory lock: even if two
      // ticks ran concurrently, the `ON CONFLICT ... WHERE` hands the leg to one
      // of them and the loser gets no row back.
      const h = makeControl({
        users: [runningRun()],
        stale: [STAGE_IDS.ENRICH_MEDIA_DIMENSIONS],
        claimDenied: [STAGE_IDS.ENRICH_MEDIA_DIMENSIONS],
      });

      const report = await h.service.tick();

      expect(h.dispatchService.startSweep).not.toHaveBeenCalled();
      expect(report.sweepsStarted).toBe(0);
    });

    it('claims the shard BEFORE dispatching, never after', async () => {
      // Dispatching first and claiming after would leave a window where two ticks
      // both enqueue a sweep for the same leg.
      const h = makeControl({ users: [runningRun()], stale: [STAGE_IDS.ENRICH_MEDIA_DIMENSIONS] });

      let statementsAtSweep = -1;
      h.dispatchService.startSweep.mockImplementation(async () => {
        statementsAtSweep = h.statements.length;
      });

      await h.service.tick();

      const claimIndex = h.indexOf(/^insert into ci\.pipeline_shards.*make_interval/);

      expect(claimIndex).toBeGreaterThanOrEqual(0);
      expect(statementsAtSweep).toBeGreaterThan(claimIndex);
    });
  });

  // -------------------------------------------------------------------------
  // Lease reaping
  // -------------------------------------------------------------------------

  describe('reaping expired shard leases', () => {
    it('reaps before it dispatches, so a reclaimed leg can be picked up this tick', async () => {
      const h = makeControl({ users: [runningRun()], stale: [STAGE_IDS.ENRICH_MEDIA_DIMENSIONS], reaped: 2 });

      await h.service.tick();

      const reapIndex = h.indexOf(/^with reaped as/);
      const claimIndex = h.indexOf(/^insert into ci\.pipeline_shards.*make_interval/);

      expect(reapIndex).toBeGreaterThanOrEqual(0);
      expect(claimIndex).toBeGreaterThan(reapIndex);
    });

    it('reports what it reclaimed and says so at warn level', async () => {
      // Reaching this line means a worker died holding work. Fully recovered
      // from, and still worth seeing.
      const h = makeControl({ users: [], reaped: 3 });

      const report = await h.service.tick();

      expect(report.leasesReaped).toBe(3);
      expect(h.logger.warn).toHaveBeenCalled();
    });

    it('says nothing on the steady-state empty reap', async () => {
      // This runs every two minutes forever on a healthy appliance.
      const h = makeControl({ users: [], reaped: 0 });

      await h.service.tick();

      expect(h.logger.warn).not.toHaveBeenCalled();
    });

    it('reaps appliance-wide, not just for the runs it is reconciling', async () => {
      // A stranded lease is stranded regardless of whose run it belongs to,
      // including a paused one. A reaper that only visited runs it was already
      // reconciling would leave exactly the shards nobody is looking at.
      const h = makeControl({ users: [], reaped: 1 });

      await h.service.tick();

      const reap = h.statements.find((statement) => /where id in \(/.test(statement.sql));

      expect(reap).toBeDefined();
      expect(reap?.sql).not.toMatch(/run_id/);
      expect(reap?.sql).not.toMatch(/user_id/);
    });

    it('wraps the reaping UPDATE in a CTE, because DataSource.query lies about an UPDATE', async () => {
      // TypeORM's PostgresQueryRunner special-cases the UPDATE and DELETE
      // commands and resolves `[raw.rows, raw.rowCount]` — a two-element array
      // whatever the statement matched. Read as rows, a reap that reclaimed
      // NOTHING reports 2, and no mock-based test can see it because the mock
      // answers with whatever shape the test wrote. Making the outer command a
      // SELECT is what gets the rows back; this pins it so it cannot be
      // "simplified" away.
      const h = makeControl({ users: [], reaped: 0 });

      await h.service.tick();

      const reap = h.statements.find((statement) => /where id in \(/.test(statement.sql));

      expect(reap?.sql).toMatch(/^with .* as \( update ci\.pipeline_shards/);
      expect(reap?.sql).toMatch(/select id from/);
    });
  });

  // -------------------------------------------------------------------------
  // Failure containment
  // -------------------------------------------------------------------------

  describe('when something goes wrong', () => {
    it('never rejects out of the scheduled tick — an unhandled tick would exit the process', async () => {
      // `@Cron` is @nestjs/schedule, which builds `CronJob.from({ onTick })`
      // without `waitForCompletion`, so `fireOnTick` never awaits the callback.
      // An async tick that rejects is an unhandled rejection, and
      // `application.ts` answers those with `process.exit(1)`. On a two-minute
      // timer that is a crash loop.
      const h = makeControl({ users: [runningRun()], failOn: /from ci\.users/ });

      await expect(h.service.tickOnSchedule()).resolves.toBeUndefined();
      expect(h.logger.error).toHaveBeenCalled();
    });

    it('propagates out of the awaited tick, so a caller that asked hears about it', async () => {
      // The two entry points diverge deliberately. A cron must never reject; a
      // caller that awaited a tick wants to be told it failed rather than getting
      // a report of zeroes that reads like a quiet appliance.
      const h = makeControl({ users: [runningRun()], failOn: /from ci\.users/ });

      await expect(h.service.tick()).rejects.toThrow('connection terminated');
    });

    it('does not let one user’s failure cost every other user their tick', async () => {
      const h = makeControl({
        users: [runningRun({ user_id: USER_A }), runningRun({ user_id: USER_B, run_id: null })],
        stale: [STAGE_IDS.ENRICH_MEDIA_DIMENSIONS],
        probeThrowsForUser: USER_A,
      });

      const report = await h.service.tick();

      expect(h.logger.error).toHaveBeenCalled();
      expect(report.usersServiced).toBe(2);
      expect(h.swept()).toEqual([STAGE_IDS.ENRICH_MEDIA_DIMENSIONS]);
    });

    it('skips a stage it cannot resolve instead of losing the whole tick', async () => {
      // A declared-but-unbound stage is a wiring fault. `StageRegistry.get`
      // throwing is right at a sweep's call site and fatal here, where the caller
      // is a timer.
      const h = makeControl({
        users: [runningRun()],
        stale: [STAGE_IDS.ENRICH_MEDIA_DIMENSIONS, STAGE_IDS.CLEAN_TEMPORAL_REPAIR],
        unbound: [STAGE_IDS.ENRICH_MEDIA_DIMENSIONS],
      });

      await h.service.tick();

      expect(h.logger.error).toHaveBeenCalled();
      expect(h.swept()).toEqual([STAGE_IDS.CLEAN_TEMPORAL_REPAIR]);
    });

    it('leaves the lease in place when a sweep fails to start, so the retry is backed off', async () => {
      // `startSweep` throws only for a wiring fault, which a retry every two
      // minutes cannot fix but a deploy can. The held lease expires in
      // SHARD_LEASE_SECONDS and is then reaped — a free backoff.
      const h = makeControl({
        users: [runningRun()],
        stale: [STAGE_IDS.ENRICH_MEDIA_DIMENSIONS],
        sweepThrows: [STAGE_IDS.ENRICH_MEDIA_DIMENSIONS],
      });

      const report = await h.service.tick();

      expect(report.sweepsStarted).toBe(0);
      expect(h.logger.error).toHaveBeenCalled();

      // Nothing releases the lease it just took: no drain, no reset, nothing that
      // would make the leg immediately claimable again by the next tick.
      const releases = h.statements.filter(
        (statement) =>
          statement.sql.startsWith('insert into ci.pipeline_shards') &&
          !/make_interval/.test(statement.sql) &&
          statement.params[1] === STAGE_IDS.ENRICH_MEDIA_DIMENSIONS,
      );

      expect(releases).toHaveLength(0);
    });

    it('does nothing on a database whose control plane has not been migrated', async () => {
      // Same guard, and the same reason, as the dead-letter reaper's: on a timer
      // an unguarded missing relation is a log line every two minutes forever.
      const h = makeControl({ controlPlane: false, users: [runningRun()], stale: [...STAGE_ID_LIST] });

      const report = await h.service.tick();

      expect(report.skipped).toBe(true);
      expect(report.skipReason).toMatch(/migrated/);
      expect(h.dispatchService.startSweep).not.toHaveBeenCalled();
    });

    it('excludes deleted and deactivated users from the sweep', async () => {
      // Their rows are still in the source tables and would sweep perfectly
      // happily, which is the problem: an account being wound down should not be
      // spending Ollama time or provider budget.
      const h = makeControl({ users: [] });

      await h.service.tick();

      const userQuery = h.statements.find((statement) => /from ci\.users/.test(statement.sql));

      expect(userQuery?.sql).toMatch(/deleted_at is null/);
      expect(userQuery?.sql).toMatch(/is_active/);
    });
  });
});

// ---------------------------------------------------------------------------
// Half two: the SQL, against real Postgres
// ---------------------------------------------------------------------------

describeWithDatabase('PipelineControlService — shard leases (real Postgres)', () => {
  let dataSource: DataSource;
  let runner: QueryRunner;
  let service: PipelineControlService;
  let runId: string;

  const leg = (stage: string, entityType = 'event'): StageLeg =>
    ({ stageId: stage as StageId, entityType, stage: null as unknown as Stage }) as StageLeg;

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

    const [present] = await dataSource.query<Array<{ runs: string | null; shards: string | null }>>(
      `SELECT to_regclass('ci.pipeline_runs')::text AS runs, to_regclass('ci.pipeline_shards')::text AS shards`,
    );

    // A reachable database missing the tables is a broken SETUP, not an absent
    // one: it must fail here naming the fix, because skipping would turn a
    // migration mistake into a green run.
    if (present.runs == null || present.shards == null) {
      throw new Error(
        'ci.pipeline_runs / ci.pipeline_shards are missing — run `yarn workspace @ci/be-api migrate` and ' +
          're-run this suite.',
      );
    }
  });

  afterAll(async () => {
    await dataSource?.destroy();
  });

  beforeEach(async () => {
    runner = dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();

    const silent = {
      setContext: () => undefined,
      log: () => undefined,
      debug: () => undefined,
      warn: () => undefined,
      error: () => undefined,
      verbose: () => undefined,
    } as unknown as LoggerService;

    service = new PipelineControlService(
      {
        query: (sql: string, params?: unknown[]) => runner.query(sql, params),
        // Never reached: these tests drive the two SQL primitives directly rather
        // than a whole tick, precisely so no advisory lock is taken on a
        // connection this suite is about to roll back.
        createQueryRunner: () => {
          throw new Error('the database half drives the SQL primitives directly, not tick()');
        },
      } as unknown as DataSource,
      null as unknown as PipelineStateService,
      null as unknown as PipelineRunService,
      null as unknown as PipelineDispatchService,
      null as unknown as StageRegistry,
      silent,
    );

    // A run to hang shards off: `pipeline_shards.run_id` REFERENCES
    // `pipeline_runs(id)`. A random user id, because the control plane
    // deliberately has no FK to ci.users — and because a real user id would risk
    // `pipeline_runs_active_uniq` colliding with the appliance's own run.
    const inserted = (await runner.query(
      `INSERT INTO ci.pipeline_runs (user_id, kind, desired_state, status)
            VALUES ($1::uuid, 'test', 'running', 'queued')
         RETURNING id`,
      [randomUUID()],
    )) as Array<{ id: string }>;

    runId = inserted[0].id;
  });

  afterEach(async () => {
    // ALWAYS a rollback. Nothing this suite writes is ever committed, so the
    // live appliance's own control plane never sees a synthetic run.
    await runner.rollbackTransaction();
    await runner.release();
  });

  interface ShardRow {
    id: string;
    stage: string;
    shard_key: string;
    cursor: string | null;
    status: string;
    lease_owner: string | null;
    lease_expires_at: Date | null;
  }

  async function shards(): Promise<ShardRow[]> {
    const rows: unknown = await runner.query(
      `SELECT * FROM ci.pipeline_shards WHERE run_id = $1::uuid ORDER BY stage, shard_key`,
      [runId],
    );

    return rows as ShardRow[];
  }

  /** A shard in whatever state the test needs, bypassing the service. */
  async function seedShard(fields: {
    stage: string;
    shardKey?: string;
    status: string;
    leaseSeconds?: number | null;
  }): Promise<string> {
    const inserted = (await runner.query(
      `INSERT INTO ci.pipeline_shards (run_id, stage, shard_key, "cursor", status, lease_owner, lease_expires_at)
            VALUES ($1::uuid, $2, $3, NULL, $4, 'someone-else',
                    CASE WHEN $5::float8 IS NULL THEN NULL ELSE now() + make_interval(secs => $5::float8) END)
         RETURNING id`,
      [runId, fields.stage, fields.shardKey ?? 'event', fields.status, fields.leaseSeconds ?? null],
    )) as Array<{ id: string }>;

    return inserted[0].id;
  }

  describe('claiming a leg', () => {
    it('materialises the shard and leases it on the first claim', async () => {
      const id = await service.claimStageShard(runId, leg(STAGE_IDS.ENRICH_MEDIA_DIMENSIONS));

      expect(id).not.toBeNull();

      const [row] = await shards();
      expect(row.stage).toBe(STAGE_IDS.ENRICH_MEDIA_DIMENSIONS);
      expect(row.shard_key).toBe('event');
      expect(row.status).toBe(SHARD_STATUS.RUNNING);
      expect(row.lease_owner).toContain(String(process.pid));
      expect(row.lease_expires_at).not.toBeNull();

      // The lease is the declared one, not an invented number. Compared loosely
      // because `now()` moved between the INSERT and this read.
      const remaining = (new Date(row.lease_expires_at as Date).getTime() - Date.now()) / 1000;
      expect(remaining).toBeGreaterThan(SHARD_LEASE_SECONDS - 60);
      expect(remaining).toBeLessThanOrEqual(SHARD_LEASE_SECONDS + 1);
    });

    it('leaves `cursor` NULL rather than inventing a keyset position', async () => {
      // A Phase-1 sweep carries its cursor in `pgboss.job.data`. Writing a stale
      // value into this column would be worse than leaving it empty, because the
      // sharded planner will one day read it.
      await service.claimStageShard(runId, leg(STAGE_IDS.ENRICH_MEDIA_DIMENSIONS));

      const [row] = await shards();
      expect(row.cursor).toBeNull();
    });

    it('refuses a second claimant while the lease is live', async () => {
      // THE re-entrancy guarantee. Two ticks racing over the same leg both run
      // this upsert; exactly one gets a row back.
      const first = await service.claimStageShard(runId, leg(STAGE_IDS.ENRICH_MEDIA_DIMENSIONS));
      const second = await service.claimStageShard(runId, leg(STAGE_IDS.ENRICH_MEDIA_DIMENSIONS));

      expect(first).not.toBeNull();
      expect(second).toBeNull();
      expect(await shards()).toHaveLength(1);
    });

    it('hands the leg over once the lease has expired', async () => {
      await seedShard({
        stage: STAGE_IDS.ENRICH_MEDIA_DIMENSIONS,
        status: SHARD_STATUS.RUNNING,
        leaseSeconds: -60,
      });

      const claimed = await service.claimStageShard(runId, leg(STAGE_IDS.ENRICH_MEDIA_DIMENSIONS));

      expect(claimed).not.toBeNull();

      const [row] = await shards();
      expect(row.lease_owner).not.toBe('someone-else');
    });

    it('re-claims a DRAINED leg, because a done shard must not be able to wedge a run', async () => {
      // If `done` refused a claim, a leg that became stale again inside the same
      // run — a producer filling its column, an import landing rows, a version
      // bump — could never be dispatched, and the run could never finalise
      // because something was stale. That is a permanent lockout for the user.
      await seedShard({ stage: STAGE_IDS.PROMOTE_PLACE, status: SHARD_STATUS.DONE, leaseSeconds: null });

      const claimed = await service.claimStageShard(runId, leg(STAGE_IDS.PROMOTE_PLACE));

      expect(claimed).not.toBeNull();
      expect((await shards())[0].status).toBe(SHARD_STATUS.RUNNING);
    });

    it('refuses a CANCELLED leg, so a run being torn down cannot be resurrected', async () => {
      await seedShard({ stage: STAGE_IDS.PROMOTE_PLACE, status: SHARD_STATUS.CANCELLED, leaseSeconds: null });

      expect(await service.claimStageShard(runId, leg(STAGE_IDS.PROMOTE_PLACE))).toBeNull();
      expect((await shards())[0].status).toBe(SHARD_STATUS.CANCELLED);
    });

    it('keys a multi-type stage’s legs separately', async () => {
      // `ci.pipeline_state` is keyed per (entity_type, entity_id, stage), so two
      // types are two independent sweeps with two independent cursors — which is
      // exactly what shard_key is for.
      expect(
        await service.claimStageShard(runId, leg(STAGE_IDS.ENRICH_PERSON_LINK, 'communication')),
      ).not.toBeNull();
      expect(await service.claimStageShard(runId, leg(STAGE_IDS.ENRICH_PERSON_LINK, 'event'))).not.toBeNull();

      expect((await shards()).map((row) => row.shard_key)).toEqual(['communication', 'event']);
    });
  });

  describe('reaping expired leases', () => {
    it('hands an expired lease back as pending, keeping the shard’s identity', async () => {
      // A worker that is SIGKILLed never releases anything. Without this the
      // shard sits `running` with a dead owner and the claim refuses it forever.
      const id = await seedShard({
        stage: STAGE_IDS.ENRICH_MEDIA_DIMENSIONS,
        status: SHARD_STATUS.RUNNING,
        leaseSeconds: -1,
      });

      await expect(service.reapExpiredShardLeases()).resolves.toBeGreaterThanOrEqual(1);

      const [row] = await shards();
      expect(row.id).toBe(id);
      expect(row.status).toBe(SHARD_STATUS.PENDING);
      expect(row.lease_owner).toBeNull();
      expect(row.lease_expires_at).toBeNull();
    });

    it('leaves a live lease alone', async () => {
      await seedShard({
        stage: STAGE_IDS.ENRICH_MEDIA_DIMENSIONS,
        status: SHARD_STATUS.RUNNING,
        leaseSeconds: 600,
      });

      await service.reapExpiredShardLeases();

      const [row] = await shards();
      expect(row.status).toBe(SHARD_STATUS.RUNNING);
      expect(row.lease_owner).toBe('someone-else');
    });

    it.each([[SHARD_STATUS.DONE], [SHARD_STATUS.CANCELLED]])(
      'leaves a %s shard alone even with an expired lease',
      async (status) => {
        // Terminal is terminal: resetting one to `pending` would make the run's
        // progress view flap and would re-open a leg the operator cancelled.
        await seedShard({ stage: STAGE_IDS.PROMOTE_OBJECT, status, leaseSeconds: -1 });

        await service.reapExpiredShardLeases();

        expect((await shards())[0].status).toBe(status);
      },
    );

    it('takes the longest-stranded first and stops at the limit', async () => {
      // The ceiling only engages while catching up after a mass worker kill —
      // exactly when not flooding the database matters most.
      await seedShard({
        stage: STAGE_IDS.PROMOTE_PLACE,
        shardKey: 'a',
        status: SHARD_STATUS.RUNNING,
        leaseSeconds: -600,
      });
      await seedShard({
        stage: STAGE_IDS.PROMOTE_PLACE,
        shardKey: 'b',
        status: SHARD_STATUS.RUNNING,
        leaseSeconds: -300,
      });

      await expect(service.reapExpiredShardLeases(1)).resolves.toBe(1);

      const rows = await shards();
      expect(rows.find((row) => row.shard_key === 'a')?.status).toBe(SHARD_STATUS.PENDING);
      expect(rows.find((row) => row.shard_key === 'b')?.status).toBe(SHARD_STATUS.RUNNING);
    });

    it('reports zero on a healthy appliance', async () => {
      await seedShard({ stage: STAGE_IDS.PROMOTE_PLACE, status: SHARD_STATUS.RUNNING, leaseSeconds: 600 });

      await expect(service.reapExpiredShardLeases()).resolves.toBe(0);
    });
  });
});
