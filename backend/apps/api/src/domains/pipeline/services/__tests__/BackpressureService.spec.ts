import { randomUUID } from 'node:crypto';

import { DataSource, type QueryRunner } from 'typeorm';

import type { LoggerService } from '@ci/common/logging';
import config from '@ci/configuration';

import { databaseAvailability, resolveConnection } from '../../__tests__/harness/pipelineHarness';
import { PIPELINE_QUEUE_NAMES, PIPELINE_QUEUES, type PipelineQueue } from '../../constants';
import {
  ADMISSION_REOPEN_FRACTION,
  BackpressureService,
  QUEUE_ADMISSION_BURSTS,
  QUEUE_READY_CAPS,
  admissibleSlices,
  reopenDepth,
} from '../BackpressureService';

/**
 * Admission control — "may more work be enqueued onto this resource class right
 * now?" — and the three ways that question is allowed to be answered wrong.
 *
 * The property under test is NOT "it counts jobs". It is:
 *
 *  - **the classes are independent.** A corpus-wide re-embed fills
 *    `pipeline-embed` for hours; cheap Postgres-bound ledger work on
 *    `pipeline-index` must keep flowing throughout, because the two contend for
 *    nothing but the ten global worker slots pg-boss already arbitrates. A
 *    global gate would turn "the slowest resource is busy" into "the pipeline is
 *    stopped".
 *  - **the wrong answers are asymmetric.** No pg-boss at all → OPEN, because
 *    there is no queue to be deep. A failed measurement → CLOSED, because
 *    `pipeline-enrich` egresses to a metered provider and a wrong "yes" there is
 *    an invoice while a wrong "no" is one delayed tick.
 *  - **it never throws.** Every caller is a scheduler deciding whether to add
 *    work. A scheduler that dies because it could not count a queue has failed
 *    at the one thing it was for — and on a timer, an unhandled rejection is a
 *    crash loop.
 *
 * ## Two halves
 *
 * **Against a fake `DataSource`** — the decision logic and the failure
 * asymmetry: which statements are issued, what the caps do at their exact
 * boundary, what happens when the probe or the count fails. Fast, hermetic,
 * always runs.
 *
 * **Against real Postgres** — the measurement itself, which is one SQL
 * statement over `pgboss.job` and is therefore invisible to a mock: that
 * `state < 'active'` really is `created` plus `retry` and really does exclude
 * `active`, that the correlated `LIMIT q.cap + 1` is legal and does bound the
 * count, and that a queue's depth is read from its own partition and no other's.
 * A mock agrees with whatever the statement asks it; Postgres does not.
 *
 * ## How the database half stays out of the dev data
 *
 * Same discipline as `DeadLetterReaperListener.spec.ts`: the service is handed a
 * `DataSource` double funnelling every statement into ONE `QueryRunner` inside a
 * transaction that is **always rolled back**. The synthetic `pgboss.job` rows
 * are never committed, so no worker on the live appliance can fetch one, there
 * is nothing to clean up, and a `kill -9` mid-run leaves the database untouched.
 *
 * Depths are asserted as DELTAS from a baseline measured in the same
 * transaction, never as absolutes: the appliance under this suite may be
 * queueing real jobs on these very queues while it runs.
 */

const availability = databaseAvailability();
const describeWithDatabase = availability.available ? describe : describe.skip;

if (!availability.available) {
  console.warn(`[BackpressureService.spec] SKIPPED (database half) — ${availability.reason}`);
}

// ---------------------------------------------------------------------------
// Half one: the decision, against a fake DataSource
// ---------------------------------------------------------------------------

/** One statement the service issued, whitespace-collapsed for matching. */
interface Statement {
  sql: string;
  params: unknown[];
}

interface HarnessOptions {
  /** Does `pgboss.job` exist? False models a process running on LocalEventService. */
  pgboss?: boolean;
  /** TRUE queue depth per queue. The fake applies the statement's own `LIMIT cap + 1`. */
  depths?: Partial<Record<PipelineQueue, number>>;
  /** Make the `to_regclass` probe fail, the way a dead connection would. */
  probeError?: Error;
  /** Make the depth count fail. */
  depthError?: Error;
  /** Answer the depth query with these rows verbatim, bypassing `depths`. */
  rows?: Array<{ queue: string; ready: number }>;
}

function makeService(options: HarnessOptions = {}) {
  const statements: Statement[] = [];

  // Copied rather than read through, so a test can move the depth BETWEEN
  // measurements on the same service instance. That is what hysteresis needs:
  // the latch is a field on the object, so a queue filling up and the same queue
  // draining back down have to be the same service seeing two depths.
  const depths: Partial<Record<PipelineQueue, number>> = { ...(options.depths ?? {}) };

  const query = jest.fn(async (raw: string, params?: unknown[]) => {
    const sql = raw.replace(/\s+/g, ' ').trim();
    statements.push({ sql, params: params ?? [] });

    if (/to_regclass/i.test(sql)) {
      if (options.probeError != null) {
        throw options.probeError;
      }

      return [{ exists: options.pgboss ?? true }];
    }

    if (/from pgboss\.job/i.test(sql)) {
      if (options.depthError != null) {
        throw options.depthError;
      }

      if (options.rows != null) {
        return options.rows;
      }

      const [queues, caps] = (params ?? []) as [PipelineQueue[], number[]];

      // The fake is what makes the bounded count observable: it applies the
      // statement's own ceiling, so a test that seeds a million jobs still gets
      // back `cap + 1` and the saturation flag is exercised rather than assumed.
      return queues.map((queue, index) => ({
        queue,
        ready: Math.min(depths[queue] ?? 0, caps[index] + 1),
      }));
    }

    // Anything else is a statement this spec does not know the service makes.
    // Answering `[]` would let a future write against pg-boss pass silently, and
    // an admission controller must never mutate the queue it measures.
    throw new Error(`BackpressureService issued an unexpected statement: ${sql}`);
  });

  const logger = {
    setContext: jest.fn(),
    log: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    verbose: jest.fn(),
  };

  const service = new BackpressureService(
    { query, manager: { query } } as unknown as DataSource,
    logger as unknown as LoggerService,
  );

  return {
    service,
    logger,
    statements,
    depthStatements: (): Statement[] => statements.filter((s) => /from pgboss\.job/i.test(s.sql)),
    /** Move one queue's TRUE depth. Takes effect on the next measurement. */
    setDepth(queue: PipelineQueue, ready: number): void {
      depths[queue] = ready;
    },
    /** Measure at a depth and return the count admitted. The ramp's one step. */
    async slicesAt(queue: PipelineQueue, ready: number): Promise<number> {
      depths[queue] = ready;

      return (await service.check(queue)).slices;
    },
  };
}

describe('BackpressureService', () => {
  describe('what it asks the database for', () => {
    it('measures every resource class in ONE statement, so the decisions share an instant', async () => {
      // Three round trips would measure three different moments, and "embed is
      // deep, index is not" would then be a claim about two different clocks.
      const h = makeService();

      await h.service.snapshot();

      expect(h.depthStatements()).toHaveLength(1);
      expect(h.depthStatements()[0].params).toEqual([
        [...PIPELINE_QUEUE_NAMES],
        [...PIPELINE_QUEUE_NAMES].map((queue) => QUEUE_READY_CAPS[queue]),
      ]);
    });

    it('counts ready work only — created and retry, never active', async () => {
      // `state < 'active'` is the enum ordering AND the predicate on pg-boss's
      // own fetch index, which is what keeps this an index-only scan. In-flight
      // is deliberately not counted: it has no index there, and pg-boss already
      // caps it.
      const h = makeService();

      await h.service.snapshot();

      expect(h.depthStatements()[0].sql).toMatch(/state\s*<\s*'active'/i);
      expect(h.depthStatements()[0].sql).not.toMatch(/state\s*=\s*'active'/i);
    });

    it('bounds the count, so the cost never grows with the backlog', async () => {
      const h = makeService();

      await h.service.snapshot();

      expect(h.depthStatements()[0].sql).toMatch(/limit q\.cap \+ 1/i);
    });

    it('never writes to pg-boss', async () => {
      const h = makeService({ depths: { [PIPELINE_QUEUES.INDEX]: 12 } });

      await h.service.snapshot();

      for (const { sql } of h.statements) {
        expect(sql).not.toMatch(/\b(insert|update|delete)\b/i);
      }
    });
  });

  describe('the cap boundary', () => {
    it.each([
      ['well below the cap', 0, true],
      ['one below the cap', QUEUE_READY_CAPS[PIPELINE_QUEUES.EMBED] - 1, true],
      ['exactly at the cap', QUEUE_READY_CAPS[PIPELINE_QUEUES.EMBED], false],
      ['past the cap', QUEUE_READY_CAPS[PIPELINE_QUEUES.EMBED] + 500, false],
    ])('%s → admitted: %s', async (_label, depth, admitted) => {
      const h = makeService({ depths: { [PIPELINE_QUEUES.EMBED]: depth } });

      const admission = await h.service.check(PIPELINE_QUEUES.EMBED);

      expect(admission.admitted).toBe(admitted);
      expect(admission.reason).toBe(admitted ? 'ok' : 'queue_depth');
    });

    it('reports a saturated depth as a lower bound, never as a queue length', async () => {
      const cap = QUEUE_READY_CAPS[PIPELINE_QUEUES.EMBED];
      const h = makeService({ depths: { [PIPELINE_QUEUES.EMBED]: 1_000_000 } });

      const admission = await h.service.check(PIPELINE_QUEUES.EMBED);

      // The count stopped at cap + 1. Anything that read `ready` as the depth
      // would be off by six orders of magnitude, which is why the flag exists.
      expect(admission.ready).toBe(cap + 1);
      expect(admission.saturated).toBe(true);
      expect(admission.cap).toBe(cap);
    });

    it('does not flag saturation at an exact, real depth', async () => {
      const h = makeService({ depths: { [PIPELINE_QUEUES.ENRICH]: 3 } });

      const admission = await h.service.check(PIPELINE_QUEUES.ENRICH);

      expect(admission.ready).toBe(3);
      expect(admission.saturated).toBe(false);
    });

    it('answers admits() with the same decision', async () => {
      const h = makeService({
        depths: { [PIPELINE_QUEUES.ENRICH]: QUEUE_READY_CAPS[PIPELINE_QUEUES.ENRICH] },
      });

      await expect(h.service.admits(PIPELINE_QUEUES.ENRICH)).resolves.toBe(false);
      await expect(h.service.admits(PIPELINE_QUEUES.INDEX)).resolves.toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Relief, not a cliff
  // -------------------------------------------------------------------------

  describe('the admissible count', () => {
    // A boolean gate at a threshold produces CONVOY behaviour: the queue fills
    // to the cap, admission slams shut, everything arriving is refused, the
    // workers drain the queue to empty, admission reopens, and the whole
    // accumulated backlog goes in at once. The appliance then alternates between
    // saturated and idle. A count is the fix, and these are the properties that
    // make it one.

    it('grants the full burst on an empty queue', async () => {
      const h = makeService();

      for (const queue of PIPELINE_QUEUE_NAMES) {
        expect((await h.service.check(queue)).slices).toBe(QUEUE_ADMISSION_BURSTS[queue]);
      }
    });

    it('never grants more than the headroom it measured', async () => {
      // THE safety property. A grant bounded by `cap - ready` means admission
      // can never push a queue past its own cap, so the cap survives being a
      // horizon even though the count is advisory.
      for (const queue of PIPELINE_QUEUE_NAMES) {
        const cap = QUEUE_READY_CAPS[queue];

        for (let ready = 0; ready <= cap + 1; ready += 1) {
          expect(admissibleSlices(queue, ready, false)).toBeLessThanOrEqual(Math.max(0, cap - ready));
        }
      }
    });

    it('falls by at most ONE slice per additional queued job — there is no cliff', async () => {
      // Monotone and Lipschitz-1 over the whole domain. This is the assertion
      // that would fail if anyone reintroduced a threshold: a step of more than
      // one is a depth at which the answer jumps, and a jump is a convoy.
      for (const queue of PIPELINE_QUEUE_NAMES) {
        const cap = QUEUE_READY_CAPS[queue];

        for (let ready = 1; ready <= cap + 1; ready += 1) {
          const previous = admissibleSlices(queue, ready - 1, false);
          const current = admissibleSlices(queue, ready, false);

          expect(current).toBeLessThanOrEqual(previous);
          expect(previous - current).toBeLessThanOrEqual(1);
        }
      }
    });

    it('still admits one slice at one below the cap, and none at it', async () => {
      // The trickle. A nearly-full queue keeps taking the single slice it has
      // room for, so arrivals keep flowing at exactly the rate the workers drain
      // — which is what "relieves over time" means at the top of the ramp.
      const cap = QUEUE_READY_CAPS[PIPELINE_QUEUES.EMBED];
      const h = makeService();

      expect(await h.slicesAt(PIPELINE_QUEUES.EMBED, cap - 1)).toBe(1);
      expect(await h.slicesAt(PIPELINE_QUEUES.EMBED, cap)).toBe(0);
    });

    it('degrades across the ramp instead of switching, measured end to end', async () => {
      // The whole curve for `pipeline-embed`, through the real service and the
      // real statement: burst, burst, ... then 6, 5, 4, 3, 2, 1, 0.
      const cap = QUEUE_READY_CAPS[PIPELINE_QUEUES.EMBED];
      const burst = QUEUE_ADMISSION_BURSTS[PIPELINE_QUEUES.EMBED];
      const h = makeService();

      const ramp: number[] = [];

      for (let ready = 0; ready <= cap; ready += 1) {
        ramp.push(await h.slicesAt(PIPELINE_QUEUES.EMBED, ready));
      }

      expect(ramp[0]).toBe(burst);
      expect(ramp[cap]).toBe(0);
      // The tail, one slice at a time down to nothing.
      expect(ramp.slice(cap - burst)).toEqual(Array.from({ length: burst + 1 }, (_, i) => burst - i));
      // And nothing above the burst anywhere, so the plateau really is a
      // plateau and not an unbounded grant on an idle queue.
      expect(Math.max(...ramp)).toBe(burst);
    });

    it('keeps admits() as "slices > 0", so the one-bit callers still work', async () => {
      const cap = QUEUE_READY_CAPS[PIPELINE_QUEUES.EMBED];
      const h = makeService({ depths: { [PIPELINE_QUEUES.EMBED]: cap - 1 } });

      await expect(h.service.admits(PIPELINE_QUEUES.EMBED)).resolves.toBe(true);
      await expect(h.service.admissible(PIPELINE_QUEUES.EMBED)).resolves.toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // Hysteresis
  // -------------------------------------------------------------------------

  describe('hysteresis', () => {
    const EMBED = PIPELINE_QUEUES.EMBED;
    const cap = QUEUE_READY_CAPS[EMBED];
    const reopenAt = reopenDepth(EMBED);

    it('reopens at a LOWER depth than it closed at', async () => {
      // Without the gap, admission reopens the instant one job leaves the queue
      // and the gate flaps once per completed job forever.
      expect(reopenAt).toBeLessThan(cap);
    });

    it('stays shut all the way down from the cap to the reopen depth', async () => {
      const h = makeService();

      // Fill past the cap. This is the measurement that latches.
      expect(await h.slicesAt(EMBED, cap)).toBe(0);

      // Every depth in the gap: there IS headroom, and it is withheld.
      for (let ready = cap - 1; ready > reopenAt; ready -= 1) {
        h.setDepth(EMBED, ready);

        const admission = await h.service.check(EMBED);

        expect(admission.ready).toBe(ready);
        expect(admission.slices).toBe(0);
        expect(admission.admitted).toBe(false);
        // Not `queue_depth`: the depth is below the cap. The reason names the
        // latch, so an operator asking "why is nothing enqueued at 20 of 25?"
        // is told the truth.
        expect(admission.reason).toBe('draining');
        expect(admission.latched).toBe(true);
      }
    });

    it('reopens exactly at the reopen depth, with the full burst', async () => {
      const h = makeService();

      await h.slicesAt(EMBED, cap);
      expect(await h.slicesAt(EMBED, reopenAt + 1)).toBe(0);

      const reopened = await h.service.check(EMBED);
      expect(reopened.slices).toBe(0);

      expect(await h.slicesAt(EMBED, reopenAt)).toBe(QUEUE_ADMISSION_BURSTS[EMBED]);
      expect((await h.service.check(EMBED)).reason).toBe('ok');
      expect((await h.service.check(EMBED)).latched).toBe(false);
    });

    it('answers the SAME depth differently depending on which way it got there', async () => {
      // This is what hysteresis IS, and no stateless function can produce it.
      const between = cap - 1;

      const filling = makeService();
      const draining = makeService();

      // Filling: has never hit the cap, so the headroom is granted.
      expect(await filling.slicesAt(EMBED, between)).toBe(1);

      // Draining: hit the cap, so the same headroom is withheld until the gap
      // has been paid back.
      await draining.slicesAt(EMBED, cap);
      expect(await draining.slicesAt(EMBED, between)).toBe(0);
    });

    it('cannot be slammed shut by the grant that reopening permitted', async () => {
      // The anti-flap invariant, and the reason `burst <= cap - reopenAt` is
      // checked at module load: a queue at its reopen depth that immediately
      // takes its whole grant is still under the cap, so the gate does not
      // close again on the very next measurement.
      for (const queue of PIPELINE_QUEUE_NAMES) {
        const grantAtReopen = admissibleSlices(queue, reopenDepth(queue), false);

        expect(reopenDepth(queue) + grantAtReopen).toBeLessThan(QUEUE_READY_CAPS[queue]);
      }
    });

    it('latches per resource class, so a saturated Ollama queue does not hold Postgres shut', async () => {
      // The isolation property, now with the extra state the latch introduces.
      // A latch shared across classes would be a global gate wearing a
      // per-queue costume — the exact coupling the three-queue split prevents.
      const h = makeService();

      h.setDepth(EMBED, 10_000);
      await h.service.snapshot();

      h.setDepth(EMBED, cap - 1);
      const admissions = await h.service.snapshot();

      expect(admissions.get(EMBED)?.latched).toBe(true);
      expect(admissions.get(EMBED)?.slices).toBe(0);
      expect(admissions.get(PIPELINE_QUEUES.INDEX)?.latched).toBe(false);
      expect(admissions.get(PIPELINE_QUEUES.INDEX)?.slices).toBe(
        QUEUE_ADMISSION_BURSTS[PIPELINE_QUEUES.INDEX],
      );
      expect(admissions.get(PIPELINE_QUEUES.ENRICH)?.slices).toBe(
        QUEUE_ADMISSION_BURSTS[PIPELINE_QUEUES.ENRICH],
      );
    });

    it('is not latched by a failed measurement — a dead connection says nothing about depth', async () => {
      // The snapshot still closes (the asymmetry above), but latching on it
      // would hold the gate shut for a quarter-cap of drain that already
      // happened, on the strength of evidence that does not exist.
      const h = makeService({ depthError: new Error('canceling statement due to statement timeout') });

      const failed = await h.service.snapshot();
      expect(failed.get(EMBED)?.slices).toBe(0);
      expect(failed.get(EMBED)?.latched).toBe(false);
    });

    it('grants the full burst when there is no pg-boss at all', async () => {
      // No queue, so no depth, so nothing to ration.
      const h = makeService({ pgboss: false });

      const admissions = await h.service.snapshot();

      for (const queue of PIPELINE_QUEUE_NAMES) {
        expect(admissions.get(queue)?.slices).toBe(QUEUE_ADMISSION_BURSTS[queue]);
      }
    });

    it('fails SAFE across a restart: a fresh service re-latches on its first measurement', async () => {
      // The latch is a field, so it dies with the process. That is deliberate,
      // and this is why it is harmless: the cap is re-measured immediately, and
      // a queue still at its cap closes again on the spot. The worst a lost
      // latch can cost is one early reopen — bounded, like every grant, by the
      // measured headroom.
      const restarted = makeService({ depths: { [EMBED]: cap + 5 } });

      const admission = await restarted.service.check(EMBED);

      expect(admission.latched).toBe(true);
      expect(admission.slices).toBe(0);
      expect(admission.reason).toBe('queue_depth');
    });
  });

  describe('per-resource-class isolation', () => {
    it('a drowning embed queue does not close cheap Postgres-bound work', async () => {
      // THE property. `pipeline-embed` is Ollama-bound and a full-corpus
      // re-embed keeps it full for hours; `pipeline-index` is Postgres-bound
      // ledger work that shares nothing with it except the ten global slots
      // pg-boss is already arbitrating.
      const h = makeService({ depths: { [PIPELINE_QUEUES.EMBED]: 10_000 } });

      const admissions = await h.service.snapshot();

      expect(admissions.get(PIPELINE_QUEUES.EMBED)?.admitted).toBe(false);
      expect(admissions.get(PIPELINE_QUEUES.INDEX)?.admitted).toBe(true);
      expect(admissions.get(PIPELINE_QUEUES.ENRICH)?.admitted).toBe(true);
    });

    it('a drowning metered queue does not close embedding either', async () => {
      const h = makeService({ depths: { [PIPELINE_QUEUES.ENRICH]: 10_000 } });

      const admissions = await h.service.snapshot();

      expect(admissions.get(PIPELINE_QUEUES.ENRICH)?.admitted).toBe(false);
      expect(admissions.get(PIPELINE_QUEUES.EMBED)?.admitted).toBe(true);
      expect(admissions.get(PIPELINE_QUEUES.INDEX)?.admitted).toBe(true);
    });

    it('answers for every declared queue, so a caller can never read a gap as permission', async () => {
      const h = makeService();

      const admissions = await h.service.snapshot();

      expect([...admissions.keys()].sort()).toEqual([...PIPELINE_QUEUE_NAMES].sort());
    });
  });

  describe('the caps themselves', () => {
    it('keeps every queue above its own worker count', async () => {
      // A cap below the worker count closes admission while that queue's
      // workers are idle. The module-load guard enforces it; this pins that the
      // guard is actually satisfied by the shipped numbers.
      for (const queue of PIPELINE_QUEUE_NAMES) {
        expect(QUEUE_READY_CAPS[queue]).toBeGreaterThanOrEqual(config.queues.perQueueConcurrency);
      }
    });

    it('reserves the most headroom on the Ollama queue', async () => {
      // The reservation IS the Ollama policy: one host process shared with
      // interactive chat, HBPE and the summary sidecar, and no honest way to
      // measure that contention from here. So embedding commits to the least
      // work between ticks — a declared cap, not a signal.
      expect(QUEUE_READY_CAPS[PIPELINE_QUEUES.EMBED]).toBeLessThan(QUEUE_READY_CAPS[PIPELINE_QUEUES.ENRICH]);
      expect(QUEUE_READY_CAPS[PIPELINE_QUEUES.ENRICH]).toBeLessThan(QUEUE_READY_CAPS[PIPELINE_QUEUES.INDEX]);
    });

    it('keeps every reopen depth above its own queue’s worker count', async () => {
      // A reopen depth below the worker count would keep the gate shut until
      // the queue held less work than its own workers can run — every close
      // would idle the class, which is the cap guard's failure one level down.
      for (const queue of PIPELINE_QUEUE_NAMES) {
        expect(reopenDepth(queue)).toBeGreaterThanOrEqual(config.queues.perQueueConcurrency);
        expect(reopenDepth(queue)).toBeLessThan(QUEUE_READY_CAPS[queue]);
      }
    });

    it('keeps every burst inside its queue’s hysteresis gap', async () => {
      // The module-load guard enforces it; this pins that the SHIPPED numbers
      // satisfy it, which is the part a reviewer changing a cap would break.
      for (const queue of PIPELINE_QUEUE_NAMES) {
        const gap = QUEUE_READY_CAPS[queue] - reopenDepth(queue);

        expect(QUEUE_ADMISSION_BURSTS[queue]).toBeGreaterThanOrEqual(1);
        expect(QUEUE_ADMISSION_BURSTS[queue]).toBeLessThanOrEqual(gap);
      }
    });

    it('sizes the embed burst as the CONCURRENCY CAP, not as a contention signal', async () => {
      // Nothing in this process can see chat, HBPE or the summary sidecar using
      // Ollama, so `pipeline-embed` gets the only honest number available: one
      // slice per worker pg-boss will actually run. It bounds commitment; it
      // does not claim to measure contention, and the reason vocabulary still
      // refuses to say otherwise.
      expect(QUEUE_ADMISSION_BURSTS[PIPELINE_QUEUES.EMBED]).toBe(config.queues.perQueueConcurrency);
      expect(QUEUE_ADMISSION_BURSTS[PIPELINE_QUEUES.EMBED]).toBeLessThan(
        QUEUE_ADMISSION_BURSTS[PIPELINE_QUEUES.ENRICH],
      );
      expect(QUEUE_ADMISSION_BURSTS[PIPELINE_QUEUES.ENRICH]).toBeLessThan(
        QUEUE_ADMISSION_BURSTS[PIPELINE_QUEUES.INDEX],
      );
    });

    it('holds back a quarter of each cap as the hysteresis gap', async () => {
      expect(ADMISSION_REOPEN_FRACTION).toBeGreaterThan(0);
      expect(ADMISSION_REOPEN_FRACTION).toBeLessThan(1);

      expect(reopenDepth(PIPELINE_QUEUES.INDEX)).toBe(375);
      expect(reopenDepth(PIPELINE_QUEUES.ENRICH)).toBe(75);
      expect(reopenDepth(PIPELINE_QUEUES.EMBED)).toBe(18);
    });

    it('closes the embed queue for the reason it actually measured', async () => {
      // Not `ollama_busy`, not `gpu_contention`. Nothing here can see chat,
      // HBPE or the summary sidecar, so the only true statement is about queue
      // depth, and that is the only one the reason vocabulary can make.
      const h = makeService({ depths: { [PIPELINE_QUEUES.EMBED]: 10_000 } });

      expect((await h.service.check(PIPELINE_QUEUES.EMBED)).reason).toBe('queue_depth');
    });
  });

  describe('when there is no pg-boss at all', () => {
    it('admits everything, and does not go looking for a table that is not there', async () => {
      // `pgboss.job` is created by pg-boss at boot rather than by a migration,
      // so it is absent under LocalEventService, where listeners run inline at
      // the call site. There is no queue, so there is no depth, and closing
      // would stop a pipeline with no backlog to protect.
      const h = makeService({ pgboss: false });

      const admissions = await h.service.snapshot();

      for (const queue of PIPELINE_QUEUE_NAMES) {
        expect(admissions.get(queue)).toEqual(
          expect.objectContaining({ admitted: true, reason: 'no_queue' }),
        );
      }

      expect(h.depthStatements()).toHaveLength(0);
      expect(h.logger.error).not.toHaveBeenCalled();
    });
  });

  describe('when the measurement fails', () => {
    it.each([
      ['the table probe', { probeError: new Error('connection terminated unexpectedly') }],
      ['the depth count', { depthError: new Error('canceling statement due to statement timeout') }],
    ])('closes every class when %s fails', async (_label, options) => {
      const h = makeService(options);

      const admissions = await h.service.snapshot();

      for (const queue of PIPELINE_QUEUE_NAMES) {
        expect(admissions.get(queue)).toEqual(
          expect.objectContaining({ admitted: false, reason: 'unmeasurable' }),
        );
      }
    });

    it('never throws — the caller is a scheduler, and a dead scheduler plans nothing', async () => {
      const h = makeService({ depthError: new Error('deadlock detected') });

      await expect(h.service.snapshot()).resolves.toBeInstanceOf(Map);
      await expect(h.service.admits(PIPELINE_QUEUES.INDEX)).resolves.toBe(false);
    });

    it('logs the failure it swallowed, so a stopped pipeline is not silent', async () => {
      const h = makeService({ depthError: new Error('deadlock detected') });

      await h.service.snapshot();

      expect(h.logger.error).toHaveBeenCalled();
    });

    it('closes only the class the query forgot, and says the query drifted', async () => {
      // Unreachable from this file's own statement; reachable the moment
      // somebody edits the SQL and not the loop. A missing row must never
      // default to zero — an absent queue would then read as an empty one.
      const h = makeService({
        rows: [
          { queue: PIPELINE_QUEUES.INDEX, ready: 0 },
          { queue: PIPELINE_QUEUES.ENRICH, ready: 0 },
        ],
      });

      const admissions = await h.service.snapshot();

      expect(admissions.get(PIPELINE_QUEUES.EMBED)).toEqual(
        expect.objectContaining({ admitted: false, reason: 'unmeasurable' }),
      );
      expect(admissions.get(PIPELINE_QUEUES.INDEX)?.admitted).toBe(true);
      expect(h.logger.error).toHaveBeenCalled();
    });

    it('reads a bigint-shaped count without turning it into a string', async () => {
      // node-postgres hands back `int8` as a string. The statement casts to int,
      // but the service coerces anyway, because a `'0' < 25` comparison is a
      // string comparison and would silently mis-admit.
      const h = makeService({
        rows: PIPELINE_QUEUE_NAMES.map((queue) => ({
          queue,
          ready: String(QUEUE_READY_CAPS[queue]) as unknown as number,
        })),
      });

      const admissions = await h.service.snapshot();

      for (const queue of PIPELINE_QUEUE_NAMES) {
        expect(admissions.get(queue)?.admitted).toBe(false);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Half two: the measurement, against real Postgres
  // -------------------------------------------------------------------------

  describeWithDatabase('measuring a real pg-boss queue (real Postgres)', () => {
    let dataSource: DataSource;
    let runner: QueryRunner;
    let service: BackpressureService;

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

      const [present] = await dataSource.query<Array<{ job: string | null }>>(
        `SELECT to_regclass('pgboss.job')::text AS job`,
      );

      // A database with no pg-boss is a BROKEN setup for this half, not an
      // absent one — absent is handled at collection time. Failing here names
      // the fix instead of silently reporting green for work never done.
      if (present.job == null) {
        throw new Error(
          'pgboss.job is missing — pg-boss creates it at boot, so start the API once against this database ' +
            '(or point PIPELINE_TEST_DATABASE_URL at the dev one) and re-run this suite.',
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

      service = new BackpressureService(
        { query: (sql: string, params?: unknown[]) => runner.query(sql, params) } as unknown as DataSource,
        {
          setContext: () => undefined,
          log: () => undefined,
          debug: () => undefined,
          warn: () => undefined,
          error: () => undefined,
          verbose: () => undefined,
        } as unknown as LoggerService,
      );
    });

    afterEach(async () => {
      // ALWAYS a rollback. Not one synthetic job is ever committed, so no worker
      // on the live appliance can fetch one.
      await runner.rollbackTransaction();
      await runner.release();
    });

    /** Enqueue `count` synthetic jobs onto `queue` in the given pg-boss state. */
    async function seed(queue: PipelineQueue, count: number, state = 'created'): Promise<void> {
      if (count === 0) {
        return;
      }

      await runner.query(
        `INSERT INTO pgboss.job (id, name, data, state, keep_until)
         SELECT gen_random_uuid(), $1, $2::jsonb, $3::pgboss.job_state, now() + interval '1 day'
           FROM generate_series(1, $4)`,
        [queue, JSON.stringify({ name: 'pipeline.slice', probe: randomUUID() }), state, count],
      );
    }

    /** Ready depth the service currently reports for one queue. */
    async function ready(queue: PipelineQueue): Promise<number> {
      return (await service.check(queue)).ready;
    }

    it('counts created and retry, and ignores everything already fetched or finished', async () => {
      // The whole measurement, in one assertion set. `active` is excluded
      // because admission gates ENQUEUES and cannot lower a number pg-boss's
      // fetcher owns; terminal states are excluded because they are not work.
      const before = await ready(PIPELINE_QUEUES.INDEX);

      await seed(PIPELINE_QUEUES.INDEX, 4, 'created');
      await seed(PIPELINE_QUEUES.INDEX, 3, 'retry');
      await seed(PIPELINE_QUEUES.INDEX, 5, 'active');
      await seed(PIPELINE_QUEUES.INDEX, 6, 'completed');
      await seed(PIPELINE_QUEUES.INDEX, 2, 'failed');
      await seed(PIPELINE_QUEUES.INDEX, 1, 'cancelled');

      // Deltas, never absolutes: the appliance running this suite may be
      // queueing real jobs on this very queue while it runs.
      expect(await ready(PIPELINE_QUEUES.INDEX)).toBe(before + 7);
    });

    it('reads each queue out of its own partition and nobody else’s', async () => {
      const before = {
        index: await ready(PIPELINE_QUEUES.INDEX),
        enrich: await ready(PIPELINE_QUEUES.ENRICH),
        embed: await ready(PIPELINE_QUEUES.EMBED),
      };

      await seed(PIPELINE_QUEUES.EMBED, 5);

      expect(await ready(PIPELINE_QUEUES.EMBED)).toBe(before.embed + 5);
      expect(await ready(PIPELINE_QUEUES.INDEX)).toBe(before.index);
      expect(await ready(PIPELINE_QUEUES.ENRICH)).toBe(before.enrich);
    });

    it('closes the class it filled and leaves the other two open', async () => {
      // The isolation property, this time with real rows in a real partitioned
      // table rather than a fake agreeing with the service.
      await seed(PIPELINE_QUEUES.EMBED, QUEUE_READY_CAPS[PIPELINE_QUEUES.EMBED] + 5);

      const admissions = await service.snapshot();

      expect(admissions.get(PIPELINE_QUEUES.EMBED)?.admitted).toBe(false);
      expect(admissions.get(PIPELINE_QUEUES.INDEX)?.admitted).toBe(true);
      expect(admissions.get(PIPELINE_QUEUES.ENRICH)?.admitted).toBe(true);
    });

    it('stops counting at the cap instead of counting the backlog', async () => {
      const cap = QUEUE_READY_CAPS[PIPELINE_QUEUES.EMBED];

      await seed(PIPELINE_QUEUES.EMBED, cap * 3);

      const admission = await service.check(PIPELINE_QUEUES.EMBED);

      // Not `cap * 3`: the correlated `LIMIT q.cap + 1` is what keeps the cost
      // of this question independent of how much work is waiting.
      expect(admission.ready).toBe(cap + 1);
      expect(admission.saturated).toBe(true);
    });

    it('admits a queue that is merely busy', async () => {
      await seed(PIPELINE_QUEUES.ENRICH, Math.max(1, config.queues.perQueueConcurrency));

      expect((await service.check(PIPELINE_QUEUES.ENRICH)).admitted).toBe(true);
    });

    /**
     * Insert `count` ready jobs carrying a probe id, so this suite can drain
     * exactly its own rows later and never a live one. Deleting an appliance's
     * real queued job — even inside a transaction that is rolled back — would
     * take a row lock a live worker could block on.
     */
    async function seedTagged(queue: PipelineQueue, count: number, probe: string): Promise<void> {
      if (count <= 0) {
        return;
      }

      await runner.query(
        `INSERT INTO pgboss.job (id, name, data, state, keep_until)
         SELECT gen_random_uuid(), $1, $2::jsonb, 'created'::pgboss.job_state, now() + interval '1 day'
           FROM generate_series(1, $3)`,
        [queue, JSON.stringify({ name: 'pipeline.slice', probe }), count],
      );
    }

    /** Remove `count` of this suite's own jobs, as a worker completing them would. */
    async function drainTagged(queue: PipelineQueue, count: number, probe: string): Promise<void> {
      await runner.query(
        `DELETE FROM pgboss.job
          WHERE id IN (SELECT id
                         FROM pgboss.job
                        WHERE name = $1
                          AND data->>'probe' = $2
                        LIMIT $3)`,
        [queue, probe, count],
      );
    }

    it('closes at its cap and reopens only a quarter-cap later — over real rows', async () => {
      // The hysteresis, end to end, with real partitioned pg-boss rows rather
      // than a fake agreeing with the service. A mock cannot show that the
      // BOUNDED count (`LIMIT cap + 1`) still resolves every depth the reopen
      // decision depends on — which it does, because the reopen depth is
      // strictly below the ceiling the count stops at.
      const queue = PIPELINE_QUEUES.EMBED;
      const cap = QUEUE_READY_CAPS[queue];
      const reopenAt = reopenDepth(queue);
      const probe = randomUUID();

      const baseline = await ready(queue);

      if (baseline > reopenAt) {
        throw new Error(
          `${queue} already holds ${baseline} ready jobs, above its reopen depth (${reopenAt}); this test ` +
            `needs a quiet queue to drive absolute depths. Let the appliance drain and re-run.`,
        );
      }

      await seedTagged(queue, cap - baseline, probe);

      const closed = await service.check(queue);

      expect(closed.ready).toBe(cap);
      expect(closed.slices).toBe(0);
      expect(closed.reason).toBe('queue_depth');
      expect(closed.latched).toBe(true);

      // Drain one job at a time and record the depth at which the count first
      // becomes positive again. The number is the deliverable.
      let reopenedAt: number | null = null;

      for (let depth = cap - 1; depth >= baseline; depth -= 1) {
        await drainTagged(queue, 1, probe);

        const admission = await service.check(queue);

        expect(admission.ready).toBe(depth);

        if (admission.slices > 0) {
          reopenedAt = depth;
          expect(admission.reason).toBe('ok');
          break;
        }

        expect(admission.reason).toBe('draining');
      }

      expect(reopenedAt).toBe(reopenAt);

      // And the grant it reopened with still fits: a queue is never reopened
      // straight back into its own cap.
      const reopened = await service.check(queue);
      expect(reopened.slices).toBe(QUEUE_ADMISSION_BURSTS[queue]);
      expect(reopened.ready + reopened.slices).toBeLessThan(cap);
    });

    it('counts a retry scheduled in the future — it is committed work', async () => {
      const before = await ready(PIPELINE_QUEUES.ENRICH);

      await runner.query(
        `INSERT INTO pgboss.job (id, name, data, state, start_after, keep_until)
         VALUES (gen_random_uuid(), $1, '{}'::jsonb, 'retry', now() + interval '6 hours',
                 now() + interval '1 day')`,
        [PIPELINE_QUEUES.ENRICH],
      );

      // A queue full of pending retries that looked empty would simply be
      // refilled, and the backoff those retries encode would be spent competing
      // with the work that replaced them.
      expect(await ready(PIPELINE_QUEUES.ENRICH)).toBe(before + 1);
    });
  });
});
