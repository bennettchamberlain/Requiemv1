import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { LoggerService } from '@ci/common/logging';
import config from '@ci/configuration';

import { PIPELINE_QUEUE_NAMES, PIPELINE_QUEUES, type PipelineQueue } from '../constants';

// ---------------------------------------------------------------------------
// The caps
// ---------------------------------------------------------------------------

/**
 * Ready jobs a queue may already be carrying before the pipeline stops adding
 * more, PER RESOURCE CLASS.
 *
 * "Ready" is `pgboss.job.state < 'active'` — `created` plus `retry`, i.e. work
 * that has been committed to the queue and not yet fetched by a worker. It is
 * the only depth number this service measures; see
 * {@link BackpressureService} for why in-flight is deliberately not counted.
 *
 * These are ADMISSION gates, not concurrency limits. pg-boss already caps
 * execution at `queues.concurrency` (10) appliance-wide and
 * `queues.perQueueConcurrency` (6) per queue; nothing here can make a queue run
 * more or fewer jobs at once. What a cap decides is how much work the pipeline
 * is willing to have COMMITTED to a queue at any moment, which is a different
 * and more consequential question: every ready job is a decision that has
 * already been made, so the depth is the length of the pipeline's commitment
 * horizon. A shallow queue means the next tick re-decides with fresh
 * information, a pause or cancel takes effect in minutes rather than hours, and
 * a mistake costs the work already queued rather than the whole corpus.
 *
 * Sizing, at the per-queue concurrency of 6 and the ~60 s slice budget
 * `DEFAULT_SLICE_SIZE` is sized for:
 *
 *  - `pipeline-index` (500) — Postgres-bound. A slice here is one bulk
 *    statement, seconds rather than a minute, so 500 ready jobs is minutes of
 *    work. This queue also carries the pipeline's own housekeeping (sweep hops,
 *    dead-letter reaps), and starving it starves the machinery that would
 *    notice anything else being wrong, so it is the loosest cap of the three.
 *  - `pipeline-enrich` (100) — local CPU, object storage, and METERED external
 *    providers: `enrich.geocode` and `enrich.position_reverse` egress through
 *    Portal to a paid provider. 100 ready slices is roughly 17 minutes of
 *    committed work, which is also 17 minutes of committed BILL. A runaway loop
 *    on this queue is an invoice, not just load, and the cap is what bounds it.
 *  - `pipeline-embed` (25) — Ollama. One host process, shared with interactive
 *    chat, HBPE and the summary sidecar. The tightest cap by a wide margin, and
 *    the one that is a DECLARED RESERVATION rather than a measurement — see the
 *    honesty note on {@link BackpressureService}.
 *
 * Changing one of these changes how much work the appliance commits to before
 * it looks up again. They are declared here rather than in `constants.ts`
 * because they are this service's policy, and reviewing them means reading the
 * argument above them.
 */
export const QUEUE_READY_CAPS: Record<PipelineQueue, number> = {
  [PIPELINE_QUEUES.INDEX]: 500,
  [PIPELINE_QUEUES.ENRICH]: 100,
  [PIPELINE_QUEUES.EMBED]: 25,
};

/**
 * Slices ONE admission decision may start on a queue that is otherwise empty.
 *
 * The cap above is a horizon — how much work may be COMMITTED to a queue at
 * once. This is a step size — how much of the remaining headroom a single
 * caller may take. The two are different questions, and collapsing them is what
 * produces the convoy: with only a cap, every decision is "fill it to the brim
 * or add nothing", so the queue floods, drains to empty while admission is shut,
 * and floods again. A burst that is a fraction of the cap means a saturating
 * queue is approached in steps rather than in one jump, and the taper in
 * {@link admissibleSlices} means the last few slots are handed out one at a
 * time.
 *
 * Sized as a fraction of each queue's own cap, because the cap already encodes
 * how much that resource class is worth committing to:
 *
 *  - `pipeline-index` (50 of 500) — a tenth. Postgres-bound, seconds per slice;
 *    50 is a few minutes of committed ledger work and the class is deliberately
 *    the loosest, because it also carries the pipeline's own housekeeping.
 *  - `pipeline-enrich` (20 of 100) — a fifth, ~3.5 minutes of committed work,
 *    and therefore ~3.5 minutes of committed BILL for the two stages that
 *    egress to a metered provider.
 *  - `pipeline-embed` (`queues.perQueueConcurrency`, 6 of 25) — ONE SLICE PER
 *    WORKER, and the number is derived from the worker count rather than chosen,
 *    because it is the only honest bound available here. Ollama contention is
 *    not measurable from this process (see the class comment); what IS knowable
 *    is that pg-boss will run at most `perQueueConcurrency` embed slices at a
 *    time, so admitting more than that per decision commits work no worker can
 *    start. It is a CONCURRENCY CAP standing in for a contention signal, and it
 *    is labelled as one.
 */
export const QUEUE_ADMISSION_BURSTS: Record<PipelineQueue, number> = {
  [PIPELINE_QUEUES.INDEX]: 50,
  [PIPELINE_QUEUES.ENRICH]: 20,
  [PIPELINE_QUEUES.EMBED]: config.queues.perQueueConcurrency,
};

/**
 * HYSTERESIS. The fraction of the cap a closed queue must drain BELOW before
 * admission reopens.
 *
 * 0.75 — a gap of a quarter of the cap: 125 ready jobs on `pipeline-index`, 25
 * on `pipeline-enrich`, 7 on `pipeline-embed`.
 *
 * ── Why a gap at all ───────────────────────────────────────────────────────
 *
 * Without one, admission reopens the instant a single job leaves the queue, at
 * `cap - 1`. The next decision refills to the cap, the gate shuts, one job
 * leaves, and so on: the gate flaps once per completed job forever. Every flap
 * is a measurement, a log line and a scheduling decision, and none of them
 * change what the workers are doing — pg-boss's concurrency is what actually
 * paces execution. The gap converts that per-job chatter into one reopen per
 * quarter-cap of drained work.
 *
 * ── Why a QUARTER, and not a half or a tenth ───────────────────────────────
 *
 * The gap is a wait, and the unit that matters is WORK TIME, not jobs. A
 * quarter of `pipeline-embed`'s cap is 7 slices, which at 6 workers and the
 * ~60 s slice budget `DEFAULT_SLICE_SIZE` is sized for is roughly one minute
 * before the gate reopens. A quarter of `pipeline-enrich` is 25 slices, ~4
 * minutes. Both are shorter than the five-minute tick, so the sweep never
 * arrives to find the gate still shut from the previous burst.
 *
 * A half would be two to eight minutes of shut gate, which on `pipeline-embed`
 * starts to look like the convoy the hysteresis exists to damp: the queue would
 * routinely be down to 12 of 25 — two slices per worker — before more is
 * admitted, and a slow slice on one worker is then a genuinely idle worker. A
 * tenth (2 jobs on embed) is inside the noise of a single slice completing and
 * would barely damp anything.
 *
 * ── The property that makes the gap safe, and it is checked below ──────────
 *
 * `burst <= cap - reopenAt`. The full burst granted at the moment of reopening
 * still fits under the cap, so a queue cannot be reopened and immediately
 * slammed shut by the very grant that reopening permitted. That is the
 * difference between hysteresis and a slower oscillation.
 */
export const ADMISSION_REOPEN_FRACTION = 0.75;

/**
 * Ready depth at or below which a CLOSED queue reopens.
 *
 * Strictly below the cap, so the two thresholds are different numbers — which
 * is the whole of what "hysteresis" means here.
 */
export function reopenDepth(queue: PipelineQueue): number {
  return Math.floor(QUEUE_READY_CAPS[queue] * ADMISSION_REOPEN_FRACTION);
}

/**
 * How many slices may be started on this queue right now, given a measured
 * depth and whether the queue is currently latched shut.
 *
 * Pure, exported, and the whole of the admission policy — so it can be asserted
 * over its entire domain without a database, a queue or a clock.
 *
 * ```
 *   slices(ready) = latched ? 0
 *                           : min(burst, cap - ready)      // clamped at 0
 * ```
 *
 * Three properties fall out of that one line, and each is a failure this
 * replaced:
 *
 *  1. **It never grants more than fits.** The grant is bounded by the MEASURED
 *     headroom, so admission cannot push a queue over its own cap. The cap is
 *     never exceeded by a decision this service made.
 *  2. **It degrades one slice at a time.** As depth rises the count falls by at
 *     most one per additional queued job — `min` of a constant and a slope-one
 *     line. There is no depth at which the answer jumps from "plenty" to
 *     "nothing", which is exactly the cliff that produces convoy behaviour.
 *  3. **It trickles rather than stopping.** At `cap - 1` the answer is 1, not 0.
 *     A nearly-full queue still admits the single slice it has room for, so
 *     arriving work keeps flowing at the rate the workers are draining.
 */
export function admissibleSlices(queue: PipelineQueue, ready: number, latched: boolean): number {
  if (latched) {
    return 0;
  }

  const headroom = QUEUE_READY_CAPS[queue] - ready;

  return Math.max(0, Math.min(QUEUE_ADMISSION_BURSTS[queue], headroom));
}

/**
 * Guards over the three declarations above, at module load in the style of
 * `versions.ts` — every one of these mistakes is SILENT at runtime, and shows up
 * as a pipeline running at a fraction of its capacity rather than as an error
 * anybody sees.
 *
 *  - **A cap below the queue's worker count** refuses to keep its own workers
 *    busy: admission closes while workers sit idle and the queue never reaches
 *    steady state.
 *  - **A reopen depth below the worker count** is the same failure one level
 *    down: the gate would stay shut until the queue had drained past what its
 *    own workers can hold, so every close would idle the class.
 *  - **A reopen depth at or above the cap** is not hysteresis at all — the two
 *    thresholds collapse and the gate flaps once per completed job.
 *  - **A burst larger than the hysteresis gap** means the grant that reopening
 *    permits refills past the cap and shuts the gate again immediately: a
 *    slower, larger-amplitude version of the oscillation the gap exists to
 *    remove.
 */
for (const queue of PIPELINE_QUEUE_NAMES) {
  const cap = QUEUE_READY_CAPS[queue];
  const burst = QUEUE_ADMISSION_BURSTS[queue];
  const reopenAt = reopenDepth(queue);
  const workers = config.queues.perQueueConcurrency;

  if (!Number.isInteger(cap) || cap < workers) {
    throw new Error(
      `QUEUE_READY_CAPS["${queue}"] is ${String(cap)}, which is not an integer at or above the per-queue ` +
        `worker count (${workers}). A cap below the worker count closes admission ` +
        `while that queue's own workers are idle.`,
    );
  }

  if (!Number.isInteger(burst) || burst < 1) {
    throw new Error(
      `QUEUE_ADMISSION_BURSTS["${queue}"] is ${String(burst)}, which is not a positive integer. A burst of ` +
        `0 admits nothing on an empty queue, which is indistinguishable from a permanently saturated one.`,
    );
  }

  if (reopenAt >= cap) {
    throw new Error(
      `The reopen depth for "${queue}" is ${reopenAt}, which is not below its cap (${cap}). Admission would ` +
        `reopen at the same depth it closed at, so the gate flaps once per completed job. ` +
        `ADMISSION_REOPEN_FRACTION must be < 1.`,
    );
  }

  if (reopenAt < workers) {
    throw new Error(
      `The reopen depth for "${queue}" is ${reopenAt}, below the per-queue worker count (${workers}). A ` +
        `closed queue would stay closed until it held less work than its own workers can run, so every ` +
        `close would idle the class.`,
    );
  }

  if (burst > cap - reopenAt) {
    throw new Error(
      `QUEUE_ADMISSION_BURSTS["${queue}"] (${burst}) exceeds the hysteresis gap (${cap} - ${reopenAt} = ` +
        `${cap - reopenAt}). The burst granted at the moment admission reopens would refill the queue to ` +
        `its cap and shut the gate again, which is oscillation with extra steps.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

/**
 * Why admission was open or closed. A stable, greppable token — the same
 * discipline `StageResult.reason` follows, and for the same reason: an operator
 * asking "why is nothing being enqueued?" needs an answer they can count.
 */
export type AdmissionReason =
  /** Headroom under the cap. {@link QueueAdmission.slices} says how much. */
  | 'ok'
  /** The queue already carries at least its cap in ready jobs. */
  | 'queue_depth'
  /**
   * Latched shut by hysteresis: this queue hit its cap and has not yet drained
   * to {@link QueueAdmission.reopenAt}. There IS headroom — admission is
   * withholding it on purpose, so that the gate reopens once per quarter-cap of
   * drained work rather than once per completed job.
   */
  | 'draining'
  /** The depth could not be read. Closed on purpose — see the class comment. */
  | 'unmeasurable'
  /** There is no pg-boss in this process, so there is no queue to be deep. */
  | 'no_queue';

/** One resource class's answer to "how much more work may be admitted right now?". */
export interface QueueAdmission {
  queue: PipelineQueue;

  /**
   * Convenience for `slices > 0`. Kept because "may I enqueue anything at all?"
   * is a real question with a one-bit answer; anything deciding HOW MUCH to
   * enqueue should read {@link slices} instead, because a caller that treats
   * `admitted` as permission for an unbounded batch has re-created the cliff.
   */
  admitted: boolean;

  /**
   * **The answer.** Slices the caller may start on this queue right now — a
   * count, not a verdict, so admission degrades one slice at a time as the
   * queue fills instead of flipping open and shut at a threshold.
   *
   * Never exceeds the measured headroom (`cap - ready`), so acting on it in
   * full cannot push the queue past its own cap. It is nonetheless ADVISORY and
   * measured at an instant: two callers acting on the same snapshot can
   * together exceed it. That is tolerable precisely because over-admission
   * costs a deeper queue and nothing else — pg-boss's `queues.concurrency` is
   * what actually bounds execution.
   */
  slices: number;

  reason: AdmissionReason;

  /**
   * Ready jobs counted. Saturates at `cap + 1` — the count is bounded, so this
   * is a LOWER BOUND whenever {@link saturated} is true, never a queue length
   * to report as one.
   *
   * The ceiling does not blunt the hysteresis: {@link reopenAt} is strictly
   * below the cap, so every depth the reopen decision depends on is counted
   * exactly.
   */
  ready: number;

  /** `ready` hit the bounded-count ceiling; the real depth may be far higher. */
  saturated: boolean;

  cap: number;

  /** Most slices one decision may grant on this queue. @see QUEUE_ADMISSION_BURSTS */
  burst: number;

  /** Depth this queue must drain to before a closed gate reopens. @see reopenDepth */
  reopenAt: number;

  /**
   * The queue is being held shut by hysteresis rather than by its cap — it hit
   * the cap at some earlier measurement and has not yet drained to
   * {@link reopenAt}.
   */
  latched: boolean;

  /** When the depth was read. Present so a caller can tell a stale snapshot. */
  measuredAt: Date;
}

/** Every resource class's answer, from one measurement. */
export type QueueAdmissions = Map<PipelineQueue, QueueAdmission>;

interface DepthRow {
  queue: string;
  ready: number | string;
}

/**
 * Admission control for the pipeline, per RESOURCE CLASS.
 *
 * ── The one question ───────────────────────────────────────────────────────
 *
 * `admissible(queue)` — HOW MANY slices may be started on this resource class
 * right now? Nothing else. It does not schedule, does not throttle a running
 * job, and cannot slow anything already committed; it is consulted BEFORE work
 * is enqueued, and its only power is to say "this many, and no more".
 *
 * A count rather than a boolean, because the appliance now processes rows AS
 * THEY ARRIVE and a yes/no gate at a threshold is a cliff. A cliff produces
 * convoy behaviour: the queue fills to the cap, admission slams shut, every
 * arriving row is refused, the workers drain the queue to empty, admission
 * reopens, and the whole accumulated backlog is admitted at once. The
 * appliance then alternates between saturated and idle, and the assistant it
 * shares an Ollama process with feels it every time. {@link admissibleSlices}
 * is the fix: the answer falls by at most one slice per additional queued job,
 * so pressure is relieved continuously rather than in a burst.
 *
 * ── Shedding is SAFE, and that is why there is no deferral queue ───────────
 *
 * **THE property this whole design rests on.** `ci.pipeline_state` is the
 * source of truth for "has this stage run for this row?", and the sweep finds
 * work with an anti-join against it. So an on-arrival enqueue that this service
 * SHEDS is not lost work — it is simply a row that is still stale, and the next
 * sweep finds it exactly as if the arrival had never happened. Shedding is
 * therefore free: no queue of deferred work, no retry bookkeeping, no
 * timers, nothing to reconcile, and no way to leak. The arrival path is an
 * OPTIMISATION over the sweep, not a channel that must be made reliable.
 *
 * **Do not add a retry buffer here.** It is the obvious-looking fix — "we
 * dropped an enqueue, we should remember it" — and it is strictly worse than
 * what the ledger already gives for nothing: a buffer is unbounded memory, it
 * is lost on restart (which the ledger is not), it needs its own admission
 * policy, and it would duplicate work the sweep is going to do anyway. The
 * relief mechanism is the sweep. It is already there, it is already durable,
 * and it is already the thing that guarantees convergence.
 *
 * ── Hysteresis, and where the latch lives ──────────────────────────────────
 *
 * A queue that reaches its cap stays shut until it has drained to
 * {@link reopenDepth} — a quarter of the cap below it. The latch is a field on
 * this object, and it is per-process on purpose:
 *
 *  - it is a DAMPER, never a correctness mechanism. The cap is what bounds
 *    commitment; the latch only chooses the moment the gate reopens;
 *  - losing it fails SAFE. A restarted process starts unlatched, immediately
 *    re-measures, and re-latches on the spot if the queue is still at its cap —
 *    the worst case is one early reopen at a depth below the cap, which admits
 *    at most the measured headroom;
 *  - two replicas would keep two latches and could disagree by one decision.
 *    That is within the noise of an advisory count measured at an instant, and
 *    the alternative — a durable latch row — would need a writer, a reaper and
 *    a lock, to damp an oscillation that costs nothing when it happens.
 *
 * ── Per resource class, never globally ─────────────────────────────────────
 *
 * The answer is per queue and the queues do not see each other. A full
 * `pipeline-embed` — a corpus-wide re-embed, hours of Ollama — must not stop
 * cheap Postgres-bound ledger work on `pipeline-index`, because those two
 * contend for nothing except the ten global worker slots that pg-boss is
 * already arbitrating. A global gate would convert "the slowest resource is
 * busy" into "the pipeline is stopped", which is exactly the coupling the
 * three-queue split exists to prevent.
 *
 * ── What is measured, and what that measurement costs ──────────────────────
 *
 * One number per queue: ready depth, `pgboss.job.state < 'active'` (`created`
 * plus `retry`). pg-boss partitions `pgboss.job` BY LIST (name) and indexes
 * each partition with `(name, start_after) INCLUDE (priority, created_on, id)
 * WHERE state < 'active'`, so this is an index-only scan of exactly the
 * partition for that queue. Measured on the dev appliance: `Index Only Scan
 * using …_i5`, 2 buffers, 0.09 ms.
 *
 * The count is additionally BOUNDED — `LIMIT cap + 1` inside the aggregate — so
 * the cost does not grow with the backlog. A queue holding a million jobs is
 * answered by reading `cap + 1` index entries, and the answer to a yes/no
 * question never requires counting a million rows. The price is that `ready`
 * saturates: past the cap it reports `cap + 1` and sets {@link
 * QueueAdmission.saturated}, so nothing downstream can mistake it for a queue
 * length. That is the honest trade — an exact depth for a metric nobody reads
 * is not worth a scan on the hot path.
 *
 * ── What is NOT measured: in-flight ────────────────────────────────────────
 *
 * `state = 'active'` has no partial index on those partitions; the planner
 * falls back to the `(name, id)` primary key with a filter, which is a scan of
 * every row that queue still holds, completed ones included, once per tick.
 * That was measured too, and it is why in-flight is absent here rather than
 * silently expensive. It also buys nothing: in-flight is already capped by
 * pg-boss itself at `queues.perQueueConcurrency` (6) per queue and
 * `queues.concurrency` (10) appliance-wide, and admission gates enqueues, not
 * fetches — refusing to enqueue cannot lower a number the fetcher owns.
 *
 * ── Ollama: what this service does NOT know ────────────────────────────────
 *
 * `index.embed` runs through the single host Ollama process that also serves
 * interactive chat, HBPE and the summary sidecar. A full-corpus re-embed can
 * make the assistant unusable, so the obvious thing to want here is a
 * contention signal for `pipeline-embed`.
 *
 * **There is no honest one available, and this service does not invent one.**
 * Chat, HBPE and the summary sidecar do not record their Ollama usage anywhere
 * this process can read: Ollama exposes loaded models (`/api/ps`), not queue
 * depth or wait time, and the in-process `plimit` inside the embedding path
 * covers one process and one caller — it cannot see the other three, so a
 * number derived from it would look authoritative and be wrong precisely when
 * it mattered, which is worse than no number at all.
 *
 * So `pipeline-embed` is governed by the same queue-depth rule as everything
 * else, with a deliberately tight cap ({@link QUEUE_READY_CAPS}) that is a
 * DECLARED RESERVATION and is documented as one, and a per-decision burst that
 * is literally `queues.perQueueConcurrency` — the CONCURRENCY CAP, standing in
 * for the contention signal there is no honest way to obtain. Neither number
 * measures Ollama. Together they bound how much embedding work the pipeline
 * commits to between ticks, and one slice per worker is the largest grant that
 * cannot be committing work no worker can start.
 *
 * If a real signal ever exists — end-to-end latency of recently completed embed
 * jobs would be one, measured rather than assumed — it belongs here, as an
 * additional closed reason and as an input to {@link admissibleSlices}. Until
 * then the honest statement is the one above, and a fabricated one would be
 * worse than none: a signal that reads as authoritative and is wrong silently
 * starves or floods the appliance, and nobody would think to distrust it.
 *
 * ── Failing open, and failing closed ───────────────────────────────────────
 *
 * Two different absences, two different answers, and the asymmetry is
 * deliberate:
 *
 *  - **`pgboss.job` does not exist** → OPEN (`no_queue`). pg-boss creates that
 *    table at boot rather than in a migration, so it is missing under
 *    `LocalEventService` (tests, some dev setups) where listeners run inline at
 *    the call site. There is no queue, so there is no depth, and closing would
 *    stop a pipeline that has no backlog to protect.
 *  - **The measurement fails** → CLOSED (`unmeasurable`), logged. A wrong "no"
 *    costs one tick, and the next one re-measures. A wrong "yes" on
 *    `pipeline-enrich` egresses to a metered provider. When the two errors are
 *    that asymmetric, the gate closes.
 *
 * {@link snapshot} therefore never throws. Every caller is a scheduler deciding
 * whether to add work, and a scheduler that dies because it could not count a
 * queue has failed at the one thing it was for.
 */
@Injectable()
export class BackpressureService {
  /**
   * Which queues are latched shut by hysteresis.
   *
   * Absent or false means "the cap is the only thing gating this queue". Set
   * when a measurement finds the queue at or above its cap, cleared when one
   * finds it at or below {@link reopenDepth}, and left alone in between — which
   * is what makes the gap a gap rather than two names for the same threshold.
   *
   * Only a REAL measurement moves it. An `unmeasurable` snapshot closes every
   * queue for that decision (see the class comment) but must not latch them: a
   * dead connection is not evidence about queue depth, and latching on it would
   * keep the pipeline shut for a quarter-cap of drain that already happened.
   */
  private readonly latched = new Map<PipelineQueue, boolean>();

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(BackpressureService.name);
  }

  /**
   * How many slices may be started on this resource class right now?
   *
   * The number every caller deciding how much work to enqueue should read. A
   * caller deciding for more than one queue should take a single
   * {@link snapshot} instead — one statement covers every queue, and three
   * separate calls measure three different moments.
   */
  async admissible(queue: PipelineQueue): Promise<number> {
    return (await this.check(queue)).slices;
  }

  /**
   * May ANY more work be enqueued onto this resource class right now?
   *
   * The one-bit form of {@link admissible}, for a caller with exactly one thing
   * to enqueue. A caller with a batch must read the count: treating this
   * boolean as permission for an unbounded enqueue is the cliff the count
   * exists to remove.
   */
  async admits(queue: PipelineQueue): Promise<boolean> {
    const admission = await this.check(queue);

    return admission.admitted;
  }

  /** One queue's decision, with the numbers it was made from. */
  async check(queue: PipelineQueue): Promise<QueueAdmission> {
    const admissions = await this.snapshot();

    return admissions.get(queue) as QueueAdmission;
  }

  /**
   * Every resource class's decision, from ONE measurement.
   *
   * Never throws: a failure closes every queue and is logged. Always answers
   * for every queue in {@link PIPELINE_QUEUE_NAMES}, so a caller may index the
   * map without a null check — a missing entry read as "no opinion" would be
   * read as permission by the next thing that touched it.
   */
  async snapshot(): Promise<QueueAdmissions> {
    const measuredAt = new Date();

    // pg-boss builds `pgboss.job` at boot, not in a migration, so a process
    // running on `LocalEventService` has no such relation and the depth query
    // below would fail to PARSE — a CASE around it would not help. Guarded the
    // same way `DeadLetterReaperListener` guards its harvest, and answered the
    // opposite way: the reaper has nothing to harvest, this has nothing to
    // throttle.
    let queueExists: boolean;

    try {
      const [row] = await this.dataSource.query<Array<{ exists: boolean }>>(
        `SELECT to_regclass('pgboss.job') IS NOT NULL AS exists`,
      );

      queueExists = row?.exists === true;
    } catch (err: unknown) {
      return this.closedSnapshot(measuredAt, 'the pg-boss job table could not be probed', err);
    }

    if (!queueExists) {
      this.logger.debug('pgboss.job does not exist; admitting every pipeline queue', {
        queues: PIPELINE_QUEUE_NAMES,
      });

      return this.uniformSnapshot(measuredAt, { admitted: true, reason: 'no_queue' });
    }

    const queues = [...PIPELINE_QUEUE_NAMES];
    const caps = queues.map((queue) => QUEUE_READY_CAPS[queue]);

    let rows: DepthRow[];

    try {
      // One statement for every resource class, so all three decisions are made
      // from the same instant. Per-queue round trips would measure three
      // different moments and make "embed is deep, index is not" a claim about
      // two different clocks.
      //
      // The inner `LIMIT q.cap + 1` is the bounded count: correlated to each
      // queue's own cap, so the work is `cap + 1` index entries per queue no
      // matter how deep the backlog is. `state < 'active'` is the enum ordering
      // (`created`, `retry`, then `active`) and is exactly the predicate the
      // partition's fetch index carries, which is what keeps this an index-only
      // scan.
      //
      // Jobs scheduled into the future (a retry with `start_after > now()`) are
      // counted. They are committed work that will run without anybody deciding
      // again; treating them as absent would let a queue full of pending
      // retries look empty and be refilled.
      rows = await this.dataSource.query<DepthRow[]>(
        `SELECT q.queue, d.ready
           FROM unnest($1::text[], $2::int[]) AS q(queue, cap)
           CROSS JOIN LATERAL (
                  SELECT count(*)::int AS ready
                    FROM (SELECT 1
                            FROM pgboss.job j
                           WHERE j.name = q.queue
                             AND j.state < 'active'
                           LIMIT q.cap + 1) probe
                ) d`,
        [queues, caps],
      );
    } catch (err: unknown) {
      return this.closedSnapshot(measuredAt, 'pipeline queue depth could not be read', err);
    }

    const depthByQueue = new Map(rows.map((row) => [row.queue, Number(row.ready)]));
    const admissions: QueueAdmissions = new Map();

    for (const queue of PIPELINE_QUEUE_NAMES) {
      const cap = QUEUE_READY_CAPS[queue];
      const measured = depthByQueue.get(queue);

      if (measured == null || !Number.isFinite(measured)) {
        // The statement answered for a queue set that is not the one asked
        // for. Nothing in this file can produce that, so it means the query was
        // changed and this loop was not; closed rather than defaulted, because
        // a defaulted zero would read as an empty queue.
        admissions.set(queue, {
          queue,
          admitted: false,
          slices: 0,
          reason: 'unmeasurable',
          ready: 0,
          saturated: false,
          cap,
          burst: QUEUE_ADMISSION_BURSTS[queue],
          reopenAt: reopenDepth(queue),
          latched: this.latched.get(queue) === true,
          measuredAt,
        });

        this.logger.error(
          `Queue depth query returned no row for "${queue}"; admission closed for this class. ` +
            `The measurement statement and PIPELINE_QUEUE_NAMES have drifted.`,
        );

        continue;
      }

      admissions.set(queue, this.decide(queue, measured, measuredAt));
    }

    return admissions;
  }

  /**
   * Turn one measured depth into one decision, moving the hysteresis latch.
   *
   * The order is: latch first, then count. A queue that has just hit its cap is
   * latched by THIS measurement and answers 0 in the same breath, so there is
   * never a decision made against a latch state the caller cannot see in the
   * `latched` field it was handed.
   */
  private decide(queue: PipelineQueue, ready: number, measuredAt: Date): QueueAdmission {
    const cap = QUEUE_READY_CAPS[queue];
    const reopenAt = reopenDepth(queue);
    const wasLatched = this.latched.get(queue) === true;

    // The three-way transition IS the hysteresis. At or above the cap: shut. At
    // or below the reopen depth: open. Between the two: whatever it already was
    // — which is the only branch that distinguishes this from a plain threshold,
    // and the reason a queue filling up behaves differently from one draining
    // down through the same depth.
    let latched: boolean;

    if (ready >= cap) {
      latched = true;
    } else if (ready <= reopenAt) {
      latched = false;
    } else {
      latched = wasLatched;
    }

    if (latched !== wasLatched) {
      this.latched.set(queue, latched);

      // Debug, not warn. Reaching the cap is the mechanism working, and on a
      // saturated appliance this fires roughly once per quarter-cap of drained
      // work — which is exactly the rate the gap was chosen to produce, and is
      // why it is worth having a log line at all.
      this.logger.debug(
        latched
          ? `Admission closed for ${queue} at its cap; it will reopen at a ready depth of ${reopenAt}`
          : `Admission reopened for ${queue}; it drained to ${ready} (reopen depth ${reopenAt})`,
        { queue, ready, cap, reopenAt },
      );
    }

    const slices = admissibleSlices(queue, ready, latched);

    return {
      queue,
      admitted: slices > 0,
      slices,
      // `slices > 0` is the only path to `ok`; below the cap with nothing
      // admitted can only be the latch, and it says so rather than blaming the
      // depth, so an operator asking "why is nothing being enqueued at 400 of
      // 500?" gets the true answer.
      reason: slices > 0 ? 'ok' : ready >= cap ? 'queue_depth' : 'draining',
      ready,
      // The count stops at `cap + 1`, so anything above the cap is a floor.
      saturated: ready > cap,
      cap,
      burst: QUEUE_ADMISSION_BURSTS[queue],
      reopenAt,
      latched,
      measuredAt,
    };
  }

  /** Every queue closed for the same reason, after a failed measurement. */
  private closedSnapshot(measuredAt: Date, what: string, err: unknown): QueueAdmissions {
    // Error, not warn: the pipeline stops admitting work until this recovers,
    // and a silent stop is the failure mode the whole subsystem was rebuilt to
    // delete. Swallowed rather than rethrown — see the class comment.
    this.logger.error(
      `${what}; admission is closed for every pipeline queue until the next measurement succeeds`,
      err instanceof Error ? err : new Error(String(err)),
    );

    return this.uniformSnapshot(measuredAt, { admitted: false, reason: 'unmeasurable' });
  }

  /**
   * Every queue answered the same way, for a reason that is not a measurement.
   *
   * The latch is READ (so the caller can see it) but never WRITTEN: neither an
   * absent pg-boss nor a failed probe is evidence about queue depth, and
   * latching on either would hold the gate shut through a drain that already
   * happened. An open uniform snapshot grants the full burst — there is no
   * queue, so there is no headroom to ration.
   */
  private uniformSnapshot(
    measuredAt: Date,
    decision: { admitted: boolean; reason: AdmissionReason },
  ): QueueAdmissions {
    const admissions: QueueAdmissions = new Map();

    for (const queue of PIPELINE_QUEUE_NAMES) {
      const burst = QUEUE_ADMISSION_BURSTS[queue];

      admissions.set(queue, {
        queue,
        admitted: decision.admitted,
        slices: decision.admitted ? burst : 0,
        reason: decision.reason,
        ready: 0,
        saturated: false,
        cap: QUEUE_READY_CAPS[queue],
        burst,
        reopenAt: reopenDepth(queue),
        latched: this.latched.get(queue) === true,
        measuredAt,
      });
    }

    return admissions;
  }
}
