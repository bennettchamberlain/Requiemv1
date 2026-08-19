import { DataSource } from 'typeorm';

import type { LoggerService } from '@ci/common/logging';

import { databaseAvailability, resolveConnection } from '../../__tests__/harness/pipelineHarness';
import { PIPELINE_QUEUE_NAMES } from '../../constants';
import type {
  BackpressureService,
  QueueAdmission,
  QueueAdmissions,
} from '../../services/BackpressureService';
import {
  PIPELINE_ADVISORY_LOCK_CLASS,
  PIPELINE_TICK,
  PIPELINE_TICK_CRON,
  PIPELINE_TICK_LOCK_ID,
  PipelineTickCron,
  type PipelineTick,
  type PipelineTickInput,
} from '../PipelineTickCron';

/**
 * The timer that starts the pipeline.
 *
 * Everything downstream of it already worked — twelve stages resolve,
 * `startSweep()` dispatches, the slice listener executes — and nothing called
 * any of it. So the properties under test here are not about planning work.
 * They are the three ways a timer can be worse than no timer at all:
 *
 *  1. **It fires on every replica.** `@Cron` is `@nestjs/schedule`, which is
 *     in-process: two replicas means two timers and two planners enqueueing the
 *     same slices. The guard has to be DURABLE — an instance boolean is
 *     per-process, so under two replicas it is two booleans that both say "no
 *     tick is running" while two ticks run. This suite pins the advisory lock,
 *     including against a real Postgres, because "does a lock exclude a second
 *     session?" is not a question a mock can answer.
 *
 *  2. **It can kill the API.** Nothing awaits a `@Cron` method —
 *     `@nestjs/schedule` builds `CronJob.from({ onTick: target })` with no
 *     `waitForCompletion`, so `cron` never awaits and never catches — and
 *     `application.ts` answers an unhandled rejection with `process.exit(1)`.
 *     A tick that rejects every 30 seconds is a crash loop, and the API dies
 *     because the pipeline could not plan a slice. `DeadLetterReaperListener`
 *     shipped with exactly that bug.
 *
 *  3. **It can stop the pipeline forever.** A session-level advisory lock
 *     belongs to the connection that took it. Acquire it and fail to release it
 *     and the lock sits on a pooled connection until the process restarts,
 *     with no replica ticking and one log line to show for it. So the release
 *     is asserted on the success path, on the throw path, and on the path where
 *     the lock statement itself fails.
 *
 * ## Two halves
 *
 * **Against fakes** — the control flow: statement order, what runs when the
 * lock is refused, what escapes each entry point, and what happens with nothing
 * bound to drive.
 *
 * **Against real Postgres** — the lock semantics themselves: that a second
 * session is genuinely excluded, and that the release genuinely releases. Both
 * halves matter and neither substitutes for the other.
 *
 * ## How the database half stays out of the way
 *
 * Advisory locks are session-scoped, not transactional, so this half cannot
 * hide inside a rolled-back transaction the way the ledger suites do — a lock
 * IS observable to other sessions by design, which is the point of it. It
 * writes nothing: `pg_try_advisory_lock` and `pg_advisory_unlock` are the only
 * statements, no table is touched, and every lock taken is released before the
 * test ends. The positive cases use {@link TEST_LOCK_OBJECT_ID}, a per-run
 * random object id, so they can never be knocked over by — or interfere with —
 * a live appliance holding the real tick lock. One test uses the REAL key
 * deliberately, and asserts the outcome that is correct whether or not anything
 * else holds it.
 */

const availability = databaseAvailability();
const describeWithDatabase = availability.available ? describe : describe.skip;

if (!availability.available) {
  console.warn(`[PipelineTickCron.spec] SKIPPED (database half) — ${availability.reason}`);
}

// ---------------------------------------------------------------------------
// Doubles
// ---------------------------------------------------------------------------

function silentLogger() {
  return {
    setContext: jest.fn(),
    log: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    verbose: jest.fn(),
  };
}

/** An admission snapshot with every class in the same state. */
function admissionsFor(admitted: boolean): QueueAdmissions {
  const measuredAt = new Date();

  return new Map(
    PIPELINE_QUEUE_NAMES.map((queue): [typeof queue, QueueAdmission] => [
      queue,
      {
        queue,
        admitted,
        // Admission is a COUNT — see BackpressureService. This cron only reads
        // the boolean for its log line, so the count is set consistently with
        // it and nothing here depends on the exact number.
        slices: admitted ? 10 : 0,
        reason: admitted ? 'ok' : 'queue_depth',
        ready: admitted ? 0 : 1_000,
        saturated: !admitted,
        cap: 100,
        burst: 10,
        reopenAt: 75,
        latched: !admitted,
        measuredAt,
      },
    ]),
  );
}

interface HarnessOptions {
  /** Does `pg_try_advisory_lock` grant? False models another replica ticking. */
  granted?: boolean;
  /** What `pg_advisory_unlock` answers. False is the leaked-lock alarm. */
  unlocked?: boolean;
  /** Make the tick body throw. */
  tickError?: Error;
  /** Make the lock statement itself throw, the way a dead connection would. */
  lockError?: Error;
  /** Bind nothing to PIPELINE_TICK — the "wired to nothing" case. */
  noTarget?: boolean;
  /** Admission the backpressure double reports. */
  admitted?: boolean;
}

function makeCron(options: HarnessOptions = {}) {
  const statements: Array<{ sql: string; params: unknown[] }> = [];
  /** Statement labels and tick calls, in the order they happened. */
  const timeline: string[] = [];

  const query = jest.fn(async (raw: string, params?: unknown[]) => {
    const sql = raw.replace(/\s+/g, ' ').trim();
    statements.push({ sql, params: params ?? [] });

    if (/pg_try_advisory_lock/i.test(sql)) {
      timeline.push('lock');

      if (options.lockError != null) {
        throw options.lockError;
      }

      return [{ locked: options.granted ?? true }];
    }

    if (/pg_advisory_unlock/i.test(sql)) {
      timeline.push('unlock');

      return [{ released: options.unlocked ?? true }];
    }

    // The tick must issue nothing else on this connection: it is the lock's
    // session, and any work done on it is work that outlives the lock's
    // lifetime in ways this file does not model.
    throw new Error(`PipelineTickCron issued an unexpected statement: ${sql}`);
  });

  const runner = {
    connect: jest.fn(async () => undefined),
    query,
    release: jest.fn(async () => {
      timeline.push('release');
    }),
  };

  const dataSource = { createQueryRunner: jest.fn(() => runner) };

  const tick = jest.fn(async (input: PipelineTickInput) => {
    void input;
    timeline.push('tick');

    if (options.tickError != null) {
      throw options.tickError;
    }

    return undefined;
  });

  const snapshot = jest.fn(async () => admissionsFor(options.admitted ?? true));
  const backpressure = { snapshot } as unknown as BackpressureService;

  const logger = silentLogger();

  const cron = new PipelineTickCron(
    dataSource as unknown as DataSource,
    backpressure,
    logger as unknown as LoggerService,
    options.noTarget === true ? undefined : ({ tick } as PipelineTick),
  );

  return { cron, dataSource, runner, statements, timeline, tick, snapshot, logger };
}

describe('PipelineTickCron', () => {
  describe('the lock, on the happy path', () => {
    it('takes the lock, ticks, releases the lock, releases the connection — in that order', async () => {
      const h = makeCron();

      await expect(h.cron.tickOnce()).resolves.toEqual(expect.objectContaining({ ran: true, skipped: null }));

      expect(h.timeline).toEqual(['lock', 'tick', 'unlock', 'release']);
    });

    it('takes the DECLARED key, on a pinned connection', async () => {
      // The key is pinned because a change to it silently disables cluster
      // safety: the new key is free, so every replica takes it and every
      // replica ticks. The connection is pinned because a session-level lock
      // belongs to the session that took it — `dataSource.query()` would borrow
      // an arbitrary pooled connection per statement and the unlock would
      // frequently land on a different session, leaving the real lock held
      // until the process restarts.
      const h = makeCron();

      await h.cron.tickOnce();

      expect(h.dataSource.createQueryRunner).toHaveBeenCalledTimes(1);
      expect(h.statements[0].sql).toMatch(/pg_try_advisory_lock/i);
      expect(h.statements[0].params).toEqual([PIPELINE_ADVISORY_LOCK_CLASS, PIPELINE_TICK_LOCK_ID]);
      expect(h.statements[1].params).toEqual([PIPELINE_ADVISORY_LOCK_CLASS, PIPELINE_TICK_LOCK_ID]);
    });

    it('never blocks waiting for the lock', async () => {
      // `try`, never the blocking form. A tick that cannot get the lock has
      // nothing to do — another node is doing exactly this work — and blocking
      // would queue a thundering herd of ticks behind whichever node is slow.
      const h = makeCron();

      await h.cron.tickOnce();

      expect(h.statements[0].sql).not.toMatch(/pg_advisory_lock\s*\(/i);
      expect(h.statements[0].sql).toMatch(/pg_try_advisory_lock\s*\(/i);
    });

    it('uses one connection per tick and gives it back every time', async () => {
      const h = makeCron();

      await h.cron.tickOnce();
      await h.cron.tickOnce();

      expect(h.dataSource.createQueryRunner).toHaveBeenCalledTimes(2);
      expect(h.runner.release).toHaveBeenCalledTimes(2);
    });
  });

  describe('when another session already holds the lock', () => {
    it('does not tick', async () => {
      const h = makeCron({ granted: false });

      await expect(h.cron.tickOnce()).resolves.toEqual(
        expect.objectContaining({ ran: false, skipped: 'lock_held' }),
      );

      expect(h.tick).not.toHaveBeenCalled();
    });

    it('does not release a lock it never held', async () => {
      // `pg_advisory_unlock` for a lock this session does not hold warns and
      // returns false — harmless here, but issuing it would mean the code
      // believed it held something it did not, and the same confusion applied
      // one line earlier releases another node's lock.
      const h = makeCron({ granted: false });

      await h.cron.tickOnce();

      expect(h.timeline).toEqual(['lock', 'release']);
    });

    it('gives the connection back anyway', async () => {
      const h = makeCron({ granted: false });

      await h.cron.tickOnce();

      expect(h.runner.release).toHaveBeenCalledTimes(1);
    });

    it('says so at debug, because this is the mechanism working', async () => {
      const h = makeCron({ granted: false });

      await h.cron.tickOnce();

      expect(h.logger.debug).toHaveBeenCalled();
      expect(h.logger.warn).not.toHaveBeenCalled();
      expect(h.logger.error).not.toHaveBeenCalled();
    });
  });

  describe('when the tick throws', () => {
    it('still releases the lock — otherwise one bad tick stops every replica forever', async () => {
      const h = makeCron({ tickError: new Error('planner exploded') });

      await expect(h.cron.tickOnce()).rejects.toThrow('planner exploded');

      expect(h.timeline).toEqual(['lock', 'tick', 'unlock', 'release']);
    });

    it('still releases the connection', async () => {
      const h = makeCron({ tickError: new Error('planner exploded') });

      await h.cron.tickOnce().catch(() => undefined);

      expect(h.runner.release).toHaveBeenCalledTimes(1);
    });

    it('propagates out of the on-demand entry point', async () => {
      // The caller here is an operator route or a test — something that can
      // report the failure. Swallowing it would report a tick that did nothing.
      const h = makeCron({ tickError: new Error('planner exploded') });

      await expect(h.cron.tickOnce()).rejects.toThrow('planner exploded');
    });

    it('NEVER rejects out of the scheduled entry point', async () => {
      // The bug this test exists for: nothing awaits a @Cron method, so a
      // rejection is an unhandled rejection, and `application.ts` answers those
      // with process.exit(1). On a 30-second timer that is a crash loop.
      const h = makeCron({ tickError: new Error('planner exploded') });

      await expect(h.cron.runOnSchedule()).resolves.toBeUndefined();
    });

    it('logs what it swallowed, so a dead tick is still visible', async () => {
      const h = makeCron({ tickError: new Error('planner exploded') });

      await h.cron.runOnSchedule();

      expect(h.logger.error).toHaveBeenCalled();
    });

    it.each([
      ['a non-Error rejection', 'a string, thrown'],
      ['null', null],
    ])('survives %s', async (_label, thrown) => {
      const h = makeCron();
      h.tick.mockImplementation(async () => {
        throw thrown;
      });

      await expect(h.cron.runOnSchedule()).resolves.toBeUndefined();
      expect(h.logger.error).toHaveBeenCalled();
    });
  });

  describe('when the lock statement itself fails', () => {
    it('gives the connection back and does not attempt an unlock', async () => {
      const h = makeCron({ lockError: new Error('connection terminated unexpectedly') });

      await expect(h.cron.tickOnce()).rejects.toThrow('connection terminated unexpectedly');

      expect(h.timeline).toEqual(['lock', 'release']);
      expect(h.tick).not.toHaveBeenCalled();
    });

    it('does not take the API down with it', async () => {
      const h = makeCron({ lockError: new Error('connection terminated unexpectedly') });

      await expect(h.cron.runOnSchedule()).resolves.toBeUndefined();
      expect(h.logger.error).toHaveBeenCalled();
    });
  });

  describe('when the unlock reports it held nothing', () => {
    it('raises it at error level — a leaked lock stops every replica until a restart', async () => {
      const h = makeCron({ unlocked: false });

      await h.cron.tickOnce();

      expect(h.logger.error).toHaveBeenCalled();
      const [message] = h.logger.error.mock.calls[0] as [string];
      expect(message).toContain(String(PIPELINE_TICK_LOCK_ID));
    });

    it('still reports the tick as having run, because it did', async () => {
      const h = makeCron({ unlocked: false });

      await expect(h.cron.tickOnce()).resolves.toEqual(expect.objectContaining({ ran: true }));
    });
  });

  describe('backpressure', () => {
    it('measures admission once per tick and hands it down', async () => {
      // Once, inside the lock, so every decision the tick makes is from the
      // same instant rather than from whatever the queue was doing between two
      // of the tick's own queries.
      const h = makeCron();

      await h.cron.tickOnce();

      expect(h.snapshot).toHaveBeenCalledTimes(1);
      const [input] = h.tick.mock.calls[0] as [PipelineTickInput];
      expect([...input.admissions.keys()].sort()).toEqual([...PIPELINE_QUEUE_NAMES].sort());
    });

    it('ticks even when every class is closed', async () => {
      // Admission gates what may be ENQUEUED; it must not gate the tick itself.
      // A tick also reads operator intent and reaps expired leases, and a
      // cancel has to be honoured on a saturated appliance — which is exactly
      // when somebody is most likely to be pressing cancel.
      const h = makeCron({ admitted: false });

      await expect(h.cron.tickOnce()).resolves.toEqual(expect.objectContaining({ ran: true }));

      const [input] = h.tick.mock.calls[0] as [PipelineTickInput];
      expect([...input.admissions.values()].every((admission) => !admission.admitted)).toBe(true);
    });
  });

  describe('when nothing is bound to drive', () => {
    it('takes no lock and issues no statement', async () => {
      // Taking a lock with nothing to do would make an idle appliance's
      // pg_locks look like a pipeline that is running.
      const h = makeCron({ noTarget: true });

      await expect(h.cron.tickOnce()).resolves.toEqual(
        expect.objectContaining({ ran: false, skipped: 'no_target' }),
      );

      expect(h.dataSource.createQueryRunner).not.toHaveBeenCalled();
      expect(h.statements).toHaveLength(0);
    });

    it('is loud about it, naming the binding that is missing', async () => {
      // A cron wired to nothing is the exact defect this component exists to
      // close: complete machinery that nothing calls. It may not be silent.
      const h = makeCron({ noTarget: true });

      await h.cron.tickOnce();

      expect(h.logger.warn).toHaveBeenCalledTimes(1);
      const [message] = h.logger.warn.mock.calls[0] as [string];
      expect(message).toContain(PIPELINE_TICK);
    });

    it('does not repeat itself every 30 seconds', async () => {
      // Loud once, then roughly hourly. A warning per tick would be the whole
      // log, and nobody reads a log that is one line repeated.
      const h = makeCron({ noTarget: true });

      for (let i = 0; i < 30; i += 1) {
        await h.cron.tickOnce();
      }

      expect(h.logger.warn).toHaveBeenCalledTimes(1);
    });

    it('says it again eventually', async () => {
      const h = makeCron({ noTarget: true });

      for (let i = 0; i < 120; i += 1) {
        await h.cron.tickOnce();
      }

      expect(h.logger.warn).toHaveBeenCalledTimes(2);
    });
  });

  describe('the schedule', () => {
    it('runs every five minutes, off the second every other cron fires on', async () => {
      const options = Reflect.getMetadata(
        'SCHEDULE_CRON_OPTIONS',
        PipelineTickCron.prototype.runOnSchedule,
      ) as { cronTime?: string } | undefined;

      expect(options?.cronTime).toBe(PIPELINE_TICK_CRON);

      // Five minutes, not thirty seconds. The tick is cheap, but what it GUARDS
      // is not: enrichment shares one Ollama process with interactive chat, and
      // two stages egress to a metered provider. Cadence is decided by the
      // enrichment window and each stage's minInterval; this cron only has to
      // fire often enough to notice the window opening and to resume after a
      // restart.
      //
      // `SyncOrchestrator`, `AnswerInferenceCron` and `McpController` all fire
      // at second 0 and the dead-letter reaper took second 40; stacking a fifth
      // job on one of those seconds turns a quiet appliance into a spike.
      const [seconds, minutes] = PIPELINE_TICK_CRON.split(' ');

      // Every five minutes...
      expect(minutes).toBe('*/5');

      // ...and NOT on a second something else already owns. The original
      // assertion pinned two literal seconds; what it was actually protecting is
      // this, so assert that instead — it survives a cadence change, which the
      // literal did not.
      expect(seconds).not.toBe('0'); // SyncOrchestrator, AnswerInferenceCron, McpController
      expect(seconds).not.toBe('40'); // DeadLetterReaperListener
    });
  });

  // -------------------------------------------------------------------------
  // Half two: the lock itself, against real Postgres
  // -------------------------------------------------------------------------

  describeWithDatabase('excluding a second ticker (real Postgres)', () => {
    /**
     * A per-run object id under the real class id.
     *
     * The DEFAULT key is pinned in the half above; what this half proves is the
     * LOCK SEMANTICS, which no mock can answer. Using a random object id for
     * the positive cases means a live appliance holding the real tick lock can
     * neither fail this suite nor be disturbed by it.
     */
    const TEST_LOCK_OBJECT_ID = 100_000 + Math.floor(Math.random() * 800_000);

    /** The cron under test, keyed away from the appliance's own tick. */
    class TestKeyTickCron extends PipelineTickCron {
      protected readonly lockObjectId = TEST_LOCK_OBJECT_ID;
    }

    let dataSource: DataSource;
    /** A second connection pool, standing in for a second replica. */
    let otherNode: DataSource;

    function connectionOptions() {
      const connection = resolveConnection();

      if (connection == null) {
        throw new Error('databaseAvailability() said yes but no connection resolved');
      }

      return {
        type: 'postgres' as const,
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
      };
    }

    beforeAll(async () => {
      dataSource = new DataSource(connectionOptions());
      otherNode = new DataSource(connectionOptions());

      await dataSource.initialize();
      await otherNode.initialize();
    });

    afterAll(async () => {
      // Destroying the pools ends every session, which is itself how a killed
      // replica releases its locks: they are session-scoped, so nothing can
      // outlive this suite even if an assertion failed mid-tick.
      await dataSource?.destroy();
      await otherNode?.destroy();
    });

    function realCron(options: { target?: PipelineTick; keyed?: 'test' | 'real' } = {}) {
      const tick = jest.fn(async (input: PipelineTickInput) => {
        void input;
      });
      const backpressure = {
        snapshot: jest.fn(async () => admissionsFor(true)),
      } as unknown as BackpressureService;
      const CronClass = options.keyed === 'real' ? PipelineTickCron : TestKeyTickCron;

      const cron = new CronClass(
        dataSource,
        backpressure,
        silentLogger() as unknown as LoggerService,
        options.target ?? ({ tick } as PipelineTick),
      );

      return { cron, tick };
    }

    /** Take the lock from "the other replica", on its own pinned session. */
    async function holdFromOtherNode(objectId: number) {
      const runner = otherNode.createQueryRunner();
      await runner.connect();

      const rows = (await runner.query(`SELECT pg_try_advisory_lock($1::int, $2::int) AS locked`, [
        PIPELINE_ADVISORY_LOCK_CLASS,
        objectId,
      ])) as Array<{ locked: boolean }>;

      const acquired = rows[0]?.locked === true;

      return {
        acquired,
        /** Always safe to call, and always gives the connection back. */
        async release(): Promise<void> {
          if (acquired) {
            await runner.query(`SELECT pg_advisory_unlock($1::int, $2::int)`, [
              PIPELINE_ADVISORY_LOCK_CLASS,
              objectId,
            ]);
          }

          await runner.release();
        },
      };
    }

    it('ticks when the lock is free, and leaves it free afterwards', async () => {
      const { cron, tick } = realCron();

      await expect(cron.tickOnce()).resolves.toEqual(expect.objectContaining({ ran: true }));
      expect(tick).toHaveBeenCalledTimes(1);

      // The proof of release is that somebody ELSE can now take it. Asserting
      // it from the same pool would prove nothing: advisory locks are
      // re-entrant within a session, and a leaked lock on a pooled connection
      // is invisible from the pool that leaked it.
      const other = await holdFromOtherNode(TEST_LOCK_OBJECT_ID);
      expect(other.acquired).toBe(true);
      await other.release();
    });

    it('does not tick while another replica holds the lock', async () => {
      // The property the whole file exists for, and the one a mock cannot
      // establish: two processes, one lock, one ticker.
      const other = await holdFromOtherNode(TEST_LOCK_OBJECT_ID);
      expect(other.acquired).toBe(true);

      try {
        const { cron, tick } = realCron();

        await expect(cron.tickOnce()).resolves.toEqual(
          expect.objectContaining({ ran: false, skipped: 'lock_held' }),
        );
        expect(tick).not.toHaveBeenCalled();
      } finally {
        await other.release();
      }
    });

    it('ticks again once the other replica lets go', async () => {
      const other = await holdFromOtherNode(TEST_LOCK_OBJECT_ID);
      await other.release();

      const { cron, tick } = realCron();

      await expect(cron.tickOnce()).resolves.toEqual(expect.objectContaining({ ran: true }));
      expect(tick).toHaveBeenCalledTimes(1);
    });

    it('releases the lock even when the tick threw', async () => {
      // A failing planner must not be able to stop every replica permanently.
      const failing: PipelineTick = {
        tick: async () => {
          throw new Error('planner exploded');
        },
      };
      const { cron } = realCron({ target: failing });

      await expect(cron.tickOnce()).rejects.toThrow('planner exploded');

      const other = await holdFromOtherNode(TEST_LOCK_OBJECT_ID);
      expect(other.acquired).toBe(true);
      await other.release();
    });

    it('the REAL key excludes the real tick', async () => {
      // Deliberately the SHIPPED key. After this line the lock is held by
      // somebody — this session if it was free, a live appliance's own tick if
      // it was not — and the assertion is correct either way, which is what
      // makes using the real key safe here.
      const other = await holdFromOtherNode(PIPELINE_TICK_LOCK_ID);

      try {
        const { cron, tick } = realCron({ keyed: 'real' });

        await expect(cron.tickOnce()).resolves.toEqual(
          expect.objectContaining({ ran: false, skipped: 'lock_held' }),
        );
        expect(tick).not.toHaveBeenCalled();
      } finally {
        await other.release();
      }
    });
  });
});
