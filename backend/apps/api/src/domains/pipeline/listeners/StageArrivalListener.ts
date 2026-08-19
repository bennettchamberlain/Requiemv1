import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { LoggerService } from '@ci/common/logging';
import { DEFAULT_JOB_PRIORITY, EventService, OnEvent } from '@ci/domains/events';
import { ContentCreatedEvent } from '@ci/domains/memory/events';

import {
  DEFAULT_SLICE_SIZE,
  MAX_SLICES_PER_SWEEP,
  PIPELINE_CONTROL_QUEUE,
  STAGE_IDS,
  type PipelineQueue,
  type StageId,
} from '../constants';
import { PipelineSliceEvent } from '../events';
import { STAGE_SCHEDULES, stageSchedule } from '../schedule';
import { BackpressureService, type QueueAdmissions } from '../services/BackpressureService';
import { StageRegistry } from '../services/StageRegistry';
import type { PipelineSlicePayload, Stage, StageSchedule } from '../types';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ARRIVAL DISPATCH — enrich a row when it lands, and let the sweep be the net.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The pipeline's primary path used to be the five-minute tick: a row imported at
 * 09:01 waited for the sweep at 09:05, and a row imported into a stage confined
 * to the nightly window waited until 01:00. This listener makes ARRIVAL the
 * primary path for the stages that declare `trigger: 'onArrival'`, and demotes
 * the sweep to what it is best at — being the thing that catches whatever the
 * fast path dropped.
 *
 * ── THE PROPERTY THAT MAKES ALL OF THIS SIMPLE ─────────────────────────────
 *
 * `ci.pipeline_state` — not this listener, and not a queue — is the source of
 * truth for "has this stage run for this row?". THE ONE RULE selects a row when
 * the ledger has no entry for it, when the entry is below the current stage
 * version, or when a failed entry's retry gate is due.
 *
 * So an arrival this listener SHEDS is safe, in the strongest sense available:
 * nothing was written, so the row is still stale, so the next sweep selects it.
 * There is no work to remember, no deferred queue to drain, no retry bookkeeping
 * to get wrong, and no way to leak — because the thing that would have to be
 * remembered is already a row in a table that a query re-derives from scratch.
 *
 * **That is what "backpressure relieves over time" means here, and it is why
 * there is no deferral queue in this file.** A future reader will reach for one
 * — a buffer of shed ids, a retry timer, a "pending arrivals" table — and every
 * version of that is strictly worse than shedding: it is a second, in-memory,
 * lossy copy of a fact the ledger already holds durably. If you are about to add
 * one, the question to answer first is "what does it know that
 * `selectStale()` cannot re-derive?", and the answer is nothing.
 *
 * The same argument covers three other losses, so they are all fine and all
 * deliberate:
 *
 *  - the coalescing buffer is IN MEMORY, so a process killed mid-window drops
 *    it (see {@link StageArrivalListener.onModuleDestroy});
 *  - the buffer is BOUNDED, so a flood past {@link MAX_PENDING_ARRIVALS} drops
 *    the excess rather than growing without limit;
 *  - a malformed or unroutable arrival is dropped rather than retried.
 *
 * None of the three loses anything, because none of them writes anything.
 *
 * ── What an arrival dispatches: a SLICE, never a sweep ─────────────────────
 *
 * A sweep is a query over the corpus — the anti-join in `selectStale`, which on
 * a converged 324,044-row table is the expensive case by design. An arrival
 * already knows the id, so it enqueues `pipeline.slice` for exactly that row.
 * The payload is byte-identical to the one `PipelineDispatchService` produces,
 * which is the whole point: it is worked by the same `PipelineSliceListener`,
 * which claims through the same `PipelineStateService.claim()`. The arrival path
 * therefore CANNOT process a row twice with a racing sweep — the claim's
 * `ON CONFLICT ... WHERE` lets exactly one of them take the row, and the loser
 * gets a shorter list back and does correspondingly less work.
 *
 * **This listener never writes `ci.pipeline_state`.** It does not inject
 * `PipelineStateService`, and that absence is the design: an arrival path that
 * recorded its own bookkeeping would be a second writer of the ledger and a
 * second definition of "claimed", which is precisely the drift the pipeline
 * rebuild exists to delete.
 *
 * ── Why the arrivals are coalesced ─────────────────────────────────────────
 *
 * A bulk import emits arrivals in floods: 309,689 records in 50 seconds was
 * measured on this appliance, ~6,200 rows a second. One slice job per row would
 * be catastrophic in exactly the way the event bus has already been catastrophic
 * once — `send()` used to fan every event out to every queue and each worker
 * discarded what it could not handle, ~93 % waste, invisible because nothing
 * failed. So arrivals are batched over a short window and enqueued with
 * `sendMany` (ONE bulk insert), never with N awaited `send()` calls.
 *
 * ── The one cost this file adds, stated plainly ────────────────────────────
 *
 * Binding `@OnEvent` to an arrival event adds that event's queue to the bus's
 * routing set, so every `send(ContentCreatedEvent, …)` now enqueues one MORE
 * pg-boss job than it did. That job is deliberately the cheapest one available:
 * it rides {@link PIPELINE_CONTROL_QUEUE} (`pipeline-index`, Postgres-bound, the
 * loosest ready cap of the three, and already the home of sweep hops and
 * dead-letter reaps), and all it does is add a uuid to a Set. It must NOT ride a
 * stage queue: arrival notes would then count toward that queue's ready depth
 * and the backpressure gate would shed the actual slices to make room for the
 * notifications about them.
 *
 * Note also which paths do NOT pay it: `ContentService.createMany` and the bulk
 * ingest controllers deliberately emit no per-row `*CreatedEvent` at all, which
 * is why the sweep remains the only way a bulk import gets enriched, and why the
 * backstop in `STAGE_SCHEDULES` is not optional.
 */

// ---------------------------------------------------------------------------
// Coalescing policy
// ---------------------------------------------------------------------------

/**
 * How long arrivals accumulate before one flush turns them into slices.
 *
 * A FIXED window measured from the first arrival of a batch, NOT a sliding
 * debounce. A sliding debounce is the obvious implementation and it is wrong
 * here in the worst possible way: during a sustained 50-second flood the window
 * would be re-armed by every arrival and never fire at all, so the mechanism
 * meant to handle the flood is the one the flood switches off.
 *
 * Two seconds, and each bound is a real one:
 *
 *  - **Short enough to be "prompt".** The user-visible latency this exists to
 *    fix is search freshness ("I added it and it is not there"). Two seconds is
 *    invisible next to the work it schedules — an embed slice is an Ollama round
 *    trip, and pg-boss's own empty-queue backoff is 5 s, so the window is not
 *    even the largest delay on the path.
 *  - **Long enough to collapse a flood.** At the measured ~6,200 arrivals/s one
 *    window covers ~12,400 rows. Against one-job-per-row that is three orders of
 *    magnitude fewer jobs, and it is what makes the difference between arrival
 *    dispatch and the fan-out defect.
 *  - **Far shorter than the tick** (`PIPELINE_TICK_CRON`, five minutes), which is
 *    what makes arrival the primary path rather than a slightly faster sweep.
 */
export const ARRIVAL_COALESCE_WINDOW_MS = 2_000;

/**
 * Ids one arrival event may hold between flushes. Arrivals past it are SHED.
 *
 * Sized as `DEFAULT_SLICE_SIZE * MAX_SLICES_PER_SWEEP` so one flush enqueues no
 * more work than one sweep hop does — the pipeline already decided that five
 * slices is the amount of committed work worth deciding at once, and an arrival
 * flush has no better claim on the queue than a sweep hop has.
 *
 * This is the MEMORY bound, and it is deliberately the coarser of the two. What
 * actually decides how much of a flush is enqueued is `QueueAdmission.slices` —
 * a measured per-queue grant that degrades one slice at a time as the queue
 * fills. This ceiling only has to keep a 300,000-row import from being a
 * 300,000-element Set in the API process.
 *
 * The ceiling is what keeps a 300,000-row import from being a 300,000-element
 * Set in the API process. Shedding at the edge is safe for the reason the class
 * comment gives at length: the shed rows are still stale, and the sweep is
 * already the mechanism that drains a bulk import. A flood is precisely the
 * situation in which the appliance CANNOT enrich as fast as rows land, so the
 * only real choice is which mechanism absorbs the backlog, and the sweep is the
 * one built for it.
 */
export const MAX_PENDING_ARRIVALS = DEFAULT_SLICE_SIZE * MAX_SLICES_PER_SWEEP;

// ---------------------------------------------------------------------------
// THE ARRIVAL SIGNALS, DECLARED
// ---------------------------------------------------------------------------

/**
 * One bus event that means "a row a stage cares about now exists".
 *
 * Declared as a flat, reviewable map in the style of `STAGE_REGISTRY` and
 * `STAGE_SCHEDULES`, and for the same reason: what an arrival triggers is a cost
 * decision, and a cost decision that exists only as a string literal inside a
 * decorator cannot be reviewed in a diff or checked at boot.
 */
export interface ArrivalSignal {
  /** Bus event name. Must have a matching `@OnEvent` binding on this class. */
  event: string;

  /**
   * Payload field carrying the new row's id, e.g. `contentId`. The payload comes
   * off `pgboss.job.data`, so this is read defensively and a payload without it
   * is dropped rather than retried.
   */
  idField: string;

  /**
   * The stages this arrival makes stale.
   *
   * The reviewable claim each entry makes is "this event announces a row in
   * these stages' `source` table". It is not checkable at module load — a
   * stage's `source` lives on the Nest-constructed provider, not in a
   * declaration — so it is checked where it can be: {@link assertArrivalSignals}
   * proves every id here is a real stage on `trigger: 'onArrival'`, and the
   * flush resolves the stage and reads its actual `source`, so an event wired to
   * the wrong stage produces an empty resolve rather than a wrong slice.
   */
  stages: readonly StageId[];
}

/**
 * Every arrival the pipeline reacts to.
 *
 * ONE entry today, matching the one stage that declares `trigger: 'onArrival'`.
 * That is not an accident of implementation, it is the schedule's decision:
 * search freshness is the only thing on this appliance a user notices within the
 * hour, so `index.embed` is the only stage for which a per-row job at import
 * rate buys anything.
 *
 * ── Adding one ─────────────────────────────────────────────────────────────
 *
 * A signal and a `trigger: 'onArrival'` in `STAGE_SCHEDULES` are HALVES OF ONE
 * CHANGE, and {@link assertArrivalSignals} refuses either half alone — a stage
 * on `onArrival` with no signal is a stage that quietly only ever gets its
 * sweep, and a signal naming a `scheduled` stage is a per-row job for work
 * nobody asked to be prompt. Three lines, together:
 *
 *  1. `STAGE_SCHEDULES[<stage>].trigger = 'onArrival'` (and `window: 'any'`);
 *  2. an entry here naming the event, its id field and that stage;
 *  3. an `@OnEvent(<event>, { queue: PIPELINE_CONTROL_QUEUE })` method below.
 *
 * ── What must never be added ───────────────────────────────────────────────
 *
 *  - **A metered stage.** `assertStageSchedules` already refuses `cost:
 *    'metered'` on `onArrival`, because that is one provider call per imported
 *    row: an import of 66,579 position fixes would bill 66,579 lookups in the
 *    time it takes to write them.
 *  - **A stage with producers in `STAGE_DEPENDENCIES`.** Ordering is the control
 *    tick's, and there is deliberately no ordering graph on this path — an
 *    arrival dispatches one row for one stage and knows nothing about what
 *    should have run first. `promote.place` triggered on arrival would promote
 *    events whose coordinates the geocoder has not written yet and record a
 *    skip that only a version bump re-opens.
 *  - **A stage with batch affinity.** `enrich.person_link` resolves a message's
 *    participants against every identifier accumulated so far, so a nightly pass
 *    matches strictly more than a per-arrival one. Faster is worse there, and
 *    `STAGE_SCHEDULES` says so at length.
 */
export const ARRIVAL_SIGNALS: readonly ArrivalSignal[] = [
  {
    event: ContentCreatedEvent,
    idField: 'contentId',
    stages: [STAGE_IDS.INDEX_EMBED],
  },
];

/**
 * Module-load guard over {@link ARRIVAL_SIGNALS}, in the style of
 * `assertStageSchedules` and `assertStageRegistryComplete`.
 *
 * Every mistake below is SILENT at runtime, which is why this throws while the
 * import graph is still being built rather than warning later:
 *
 *  - **A signal naming an unknown stage id** — the arrival resolves nothing, so
 *    the per-row job is pure waste forever.
 *  - **A signal naming a `scheduled` or `manual` stage** — the difference
 *    between a prompt embed and an unbudgeted job (or, for a metered stage, an
 *    unbudgeted CHARGE) per imported row. This is the guard that makes
 *    requirement "only `onArrival` stages react" a fact rather than a comment.
 *  - **An `onArrival` stage no signal names** — it declares that new data
 *    dispatches it directly and nothing ever does, so it silently degrades to
 *    its sweep and the declaration lies.
 *  - **Two signals for one event** — `EventListenerRegistry` permits exactly one
 *    listener per `(event, queue)` pair and throws at decorator evaluation; the
 *    check is here anyway so the failure names this file instead of a stack in
 *    the bus.
 *
 * Takes both maps as parameters so a spec can prove the guard FIRES rather than
 * merely proving today's declarations pass it.
 */
export function assertArrivalSignals(
  signals: readonly ArrivalSignal[] = ARRIVAL_SIGNALS,
  schedules: Record<string, StageSchedule> = STAGE_SCHEDULES,
): void {
  const problems: string[] = [];
  const seenEvents = new Set<string>();
  const signalled = new Set<string>();

  for (const signal of signals) {
    if (seenEvents.has(signal.event)) {
      problems.push(
        `event "${signal.event}" is declared twice. One listener per (event, queue) pair is allowed, so ` +
          `the second binding would throw at decorator evaluation; merge the two entries' stages instead`,
      );
    }

    seenEvents.add(signal.event);

    if (signal.stages.length === 0) {
      problems.push(`event "${signal.event}" names no stages, so its per-row job would do nothing`);
    }

    for (const stageId of signal.stages) {
      signalled.add(stageId);

      const schedule = schedules[stageId];

      if (schedule == null) {
        problems.push(
          `event "${signal.event}" names "${stageId}", which has no STAGE_SCHEDULES entry (it is not a ` +
            `declared stage, so nothing would ever resolve it)`,
        );

        continue;
      }

      if (schedule.trigger !== 'onArrival') {
        problems.push(
          `event "${signal.event}" names "${stageId}", which is trigger: '${schedule.trigger}'. Only a ` +
            `stage declared 'onArrival' may be dispatched by arrival — for a 'scheduled' stage this is an ` +
            `unbudgeted job per imported row, and for a metered one it is an unbudgeted charge`,
        );
      }
    }
  }

  for (const [stageId, schedule] of Object.entries(schedules)) {
    if (schedule.trigger === 'onArrival' && !signalled.has(stageId)) {
      problems.push(
        `"${stageId}" is trigger: 'onArrival' but no ARRIVAL_SIGNALS entry names it, so nothing ever ` +
          `dispatches it on arrival and it silently degrades to its sweep. Add a signal in ` +
          `domains/pipeline/listeners/StageArrivalListener.ts, or declare the stage 'scheduled'`,
      );
    }
  }

  if (problems.length > 0) {
    throw new Error(`Pipeline arrival signals are invalid — ${problems.join('; ')}.`);
  }
}

// Module load, not `onModuleInit`: a stage that says `onArrival` with nothing
// arriving, or an arrival wired to a stage nobody budgeted for, is a programming
// error, and the cheapest place to discover one is before a queue exists to
// enqueue anything onto.
assertArrivalSignals();

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

/** What one flush did. Returned for the log line, and for tests. */
export interface ArrivalFlushReport {
  /** Distinct ids taken out of the buffer. */
  arrivals: number;

  /** Ids actually enqueued, summed over stages (one id can be enqueued for several). */
  dispatched: number;

  /** Slice jobs enqueued. The number that must stay far below {@link arrivals}. */
  slices: number;

  /** Ids dropped because their stage's queue refused admission. */
  shedByBackpressure: number;

  /** Ids dropped at the buffer ceiling since the previous flush. */
  shedByOverflow: number;

  /** Ids that no longer exist, changed owner, or do not satisfy a stage's predicate. */
  notApplicable: number;
}

function emptyReport(): ArrivalFlushReport {
  return {
    arrivals: 0,
    dispatched: 0,
    slices: 0,
    shedByBackpressure: 0,
    shedByOverflow: 0,
    notApplicable: 0,
  };
}

/** Row shape of the ownership/applicability resolve. */
interface OwnerRow {
  id: string;
  user_id: string;
}

/**
 * SQL identifiers arrive from `StageSource`, which is in-repo declaration and
 * never request input. The pattern check is a tripwire rather than a sanitiser,
 * duplicated from `PipelineStateService` (where it is private, and where the
 * same statement shape is built) so a stage that ever computes a table name from
 * data gets a legible error here too instead of a valid query over something
 * unexpected.
 */
const SQL_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

// ---------------------------------------------------------------------------
// The listener
// ---------------------------------------------------------------------------

@Injectable()
export class StageArrivalListener implements OnModuleDestroy {
  /**
   * The signals this instance reacts to.
   *
   * A field defaulting to {@link ARRIVAL_SIGNALS} rather than a direct read, in
   * the style of `PipelineTickCron`'s lock ids: a spec subclasses and overrides
   * it to prove the runtime behaviour (an `onArrival` stage reacts, a
   * `scheduled` one does not) without editing a shipped declaration.
   */
  protected readonly signals: readonly ArrivalSignal[] = ARRIVAL_SIGNALS;

  /** Event name → the ids seen since the last flush. A Set: an id arriving twice is one row. */
  private readonly pending = new Map<string, Set<string>>();

  /** Ids refused at the buffer ceiling since the last flush. Reported, never logged per arrival. */
  private overflowShed = 0;

  /** The fixed window's timer. Non-null exactly while a batch is accumulating. */
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly stageRegistry: StageRegistry,
    private readonly backpressure: BackpressureService,
    private readonly eventService: EventService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(StageArrivalListener.name);
  }

  // -------------------------------------------------------------------------
  // Bus bindings
  //
  // One method per arrival event, all delegating to `noteArrival`. The listener
  // registry keys on `${eventName}:${queue}` and permits exactly one handler per
  // pair, so a loop could not register several events even if it wanted to —
  // and, as with `PipelineSliceListener`'s three queue bindings, being forced to
  // write the binding out is the point: each one is a standing per-row job on
  // every emit of that event.
  //
  // Every binding rides PIPELINE_CONTROL_QUEUE. See the class comment: an
  // arrival note on a stage queue would count toward that queue's ready depth
  // and make the backpressure gate shed slices to make room for notifications.
  // -------------------------------------------------------------------------

  @OnEvent(ContentCreatedEvent, { queue: PIPELINE_CONTROL_QUEUE })
  onContentCreated(payload: unknown): void {
    this.noteArrival(ContentCreatedEvent, payload);
  }

  /**
   * Record one arrival and arm the window. Never throws, never awaits anything.
   *
   * Synchronous by construction: this runs once per imported row, so anything it
   * does is multiplied by the import. It adds a string to a Set and, on the first
   * arrival of a batch, schedules a timer.
   *
   * A payload that carries no usable id is DROPPED, with a warning, rather than
   * thrown. A throw would fail the pg-boss job, spend its three retries and
   * dead-letter a NOTIFICATION — three more attempts at a payload that will
   * never parse, and a dead letter nobody can replay usefully. Dropping loses
   * nothing that the sweep does not recover; see the class comment.
   *
   * Public so a spec (and, later, an in-process emitter that wants to skip the
   * bus hop entirely) can drive it without a queue.
   */
  noteArrival(eventName: string, payload: unknown): void {
    const signal = this.signals.find((candidate) => candidate.event === eventName);

    if (signal == null) {
      // Reachable only if a binding outlives its declaration. Warned rather than
      // ignored: the per-row job is still being enqueued by the bus, so this is
      // pure measurable waste until the binding is removed.
      this.logger.warn('Arrival for an event with no ARRIVAL_SIGNALS entry; ignoring it', { eventName });

      return;
    }

    const entityId = readId(payload, signal.idField);

    if (entityId == null) {
      this.logger.warn('Arrival payload carried no usable entity id; dropping it', {
        eventName,
        idField: signal.idField,
      });

      return;
    }

    let ids = this.pending.get(eventName);

    if (ids == null) {
      ids = new Set<string>();
      this.pending.set(eventName, ids);
    }

    if (ids.size >= MAX_PENDING_ARRIVALS && !ids.has(entityId)) {
      // The buffer ceiling. Counted, never logged here — a log line per shed
      // arrival during a 300,000-row import is its own outage. The count reaches
      // the flush's single log line.
      this.overflowShed += 1;

      return;
    }

    ids.add(entityId);

    this.arm();
  }

  /**
   * Turn everything buffered into slice jobs.
   *
   * Public so a spec can drive one window without timers, and so an operator
   * route could force one.
   *
   * Takes the buffer FIRST and replaces it, so arrivals landing while this runs
   * accumulate into the next window instead of being flushed twice or lost. Two
   * flushes overlapping is harmless anyway — overlapping slices over the same id
   * are absorbed by the claim, exactly as two overlapping sweeps are.
   */
  async flush(): Promise<ArrivalFlushReport> {
    this.disarm();

    const taken = [...this.pending.entries()].map(([eventName, ids]) => ({ eventName, ids: [...ids] }));
    const report = emptyReport();

    report.shedByOverflow = this.overflowShed;

    this.pending.clear();
    this.overflowShed = 0;

    report.arrivals = taken.reduce((total, batch) => total + batch.ids.length, 0);

    if (report.arrivals === 0) {
      return report;
    }

    // ONE measurement for the whole flush, in the discipline `PipelineTickCron`
    // already follows: three per-queue calls would measure three different
    // moments and make "embed is deep, index is not" a claim about two clocks.
    // `snapshot()` never throws — an unmeasurable queue comes back CLOSED — so
    // backpressure can shed work but can never stop this listener from running.
    const admissions = await this.backpressure.snapshot();

    for (const batch of taken) {
      const signal = this.signals.find((candidate) => candidate.event === batch.eventName);

      if (signal == null) {
        continue;
      }

      for (const stageId of signal.stages) {
        await this.dispatchArrivals(stageId, batch.ids, admissions, report);
      }
    }

    // One line per flush, not per arrival. Logged only when something happened,
    // so an idle appliance's log is not a heartbeat.
    if (report.slices > 0 || report.shedByBackpressure > 0 || report.shedByOverflow > 0) {
      this.logger.log('Dispatched pipeline arrivals', { ...report });
    }

    return report;
  }

  /**
   * Drop whatever is buffered, without enqueuing it.
   *
   * The shutdown case, and it is the class comment's argument one more time: the
   * buffered ids have no ledger row, so they are still stale and the next sweep
   * selects them. Flushing here instead would mean issuing queries and enqueues
   * against a DataSource and an event bus that are themselves being torn down —
   * trading a guaranteed-safe drop for a likely-failing write.
   */
  onModuleDestroy(): void {
    this.disarm();

    const dropped = [...this.pending.values()].reduce((total, ids) => total + ids.size, 0);

    this.pending.clear();
    this.overflowShed = 0;

    if (dropped > 0) {
      this.logger.debug('Dropped buffered pipeline arrivals on shutdown; the sweep will collect them', {
        dropped,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /** Enqueue one stage's slices for the ids that just arrived. */
  private async dispatchArrivals(
    stageId: StageId,
    ids: string[],
    admissions: QueueAdmissions,
    report: ArrivalFlushReport,
  ): Promise<void> {
    // Re-checked at dispatch, not only at boot. `assertArrivalSignals` proves the
    // declarations agree; this proves the executing path honours the schedule
    // even for a signal assembled at runtime, which is the difference between
    // "only onArrival stages react" being a guard and being a property.
    if (stageSchedule(stageId).trigger !== 'onArrival') {
      this.logger.debug('Arrival names a stage that is not onArrival; not dispatching it', {
        stage: stageId,
      });

      return;
    }

    let stage: Stage;

    try {
      stage = this.stageRegistry.get(stageId);
    } catch (err: unknown) {
      // One unbound stage must not cost the other stages in this flush their
      // arrivals, and this runs on a timer where a throw is an unhandled
      // rejection. Loud, but not fatal — same trade `PipelineControlService`
      // makes when a leg cannot be resolved.
      this.logger.error(
        `Arrival dispatch cannot resolve stage "${stageId}"; skipping it`,
        err instanceof Error ? err : new Error(String(err)),
      );

      return;
    }

    const admission = admissions.get(stage.queue as PipelineQueue);

    // `slices`, not `admitted`. The admission is a COUNT — how many slices this
    // queue may be given right now — and a caller that reads the boolean and
    // then enqueues an unbounded batch has re-created the cliff the graded grant
    // exists to remove. `admitted` is only `slices > 0`.
    //
    // A queue with no admission at all is treated as granting nothing:
    // `StageRegistry` already refuses a stage on an unknown queue, so reaching
    // this means the queue set and the stage disagree, and the fail-closed
    // answer costs one flush while the other costs an unworked queue filling up.
    const grant = admission?.slices ?? 0;

    if (grant <= 0) {
      // SHED. Nothing is written, nothing is remembered, nothing is retried:
      // these rows have no ledger entry, so they are still stale and the next
      // sweep selects them. This is the entire backpressure mechanism on the
      // arrival path, and it is why there is no deferral queue in this file.
      report.shedByBackpressure += ids.length;

      this.logger.debug('Shed arrivals under backpressure; they stay stale for the next sweep', {
        stage: stage.id,
        queue: stage.queue,
        shed: ids.length,
        reason: admission?.reason ?? 'unknown_queue',
        ready: admission?.ready,
        cap: admission?.cap,
        latched: admission?.latched,
      });

      return;
    }

    const entityType = this.entityTypeFor(stage);

    if (entityType == null) {
      return;
    }

    let rows: OwnerRow[];

    try {
      rows = await this.resolveOwners(stage, ids);
    } catch (err: unknown) {
      // A failed resolve sheds this stage's arrivals for the same reason a
      // closed queue does, and with the same consequence: nothing was written.
      this.logger.error(
        `Could not resolve owners for ${ids.length} arrival(s) of stage "${stage.id}"; they stay stale ` +
          `for the next sweep`,
        err instanceof Error ? err : new Error(String(err)),
      );

      return;
    }

    report.notApplicable += ids.length - rows.length;

    if (rows.length === 0) {
      return;
    }

    // Grouped by owner because `ci.pipeline_state` and every stage's `run` are
    // user-scoped: a slice carries exactly one `userId`, and mixing owners into
    // one would embed one user's content under another's id.
    const byUser = new Map<string, string[]>();

    for (const row of rows) {
      const owned = byUser.get(row.user_id);

      if (owned == null) {
        byUser.set(row.user_id, [row.id]);
      } else {
        owned.push(row.id);
      }
    }

    const slices: Array<{ name: string; data: Record<string, unknown> }> = [];

    for (const [userId, owned] of byUser) {
      for (let offset = 0; offset < owned.length; offset += DEFAULT_SLICE_SIZE) {
        const slicePayload: PipelineSlicePayload = {
          stage: stage.id,
          entityType,
          userId,
          ids: owned.slice(offset, offset + DEFAULT_SLICE_SIZE),
          // Arrival dispatch belongs to no run and no shard. A run is a
          // reconciled unit of work the control tick owns and finalises; an
          // arrival is a single row's worth of promptness, and attributing it to
          // whatever run happened to be open would make that run's shard
          // accounting describe work it never planned.
          runId: null,
          shardId: null,
        };

        slices.push({ name: PipelineSliceEvent, data: { ...slicePayload } });
      }
    }

    if (slices.length === 0) {
      return;
    }

    // The grant is a CEILING on slices, so a queue with room for two takes two
    // and the rest of the flush is shed — not queued, not remembered, not
    // retried. This is the graded half of the same argument as the shed above:
    // admission degrades one slice at a time as the queue fills, and the ids that
    // do not fit are simply still stale.
    const admitted = slices.slice(0, grant);
    const refused = slices.slice(grant);

    if (refused.length > 0) {
      const shed = refused.reduce((total, job) => total + (job.data.ids as string[]).length, 0);

      report.shedByBackpressure += shed;

      this.logger.debug('Shed arrivals past the queue grant; they stay stale for the next sweep', {
        stage: stage.id,
        queue: stage.queue,
        grant,
        wanted: slices.length,
        shed,
        ready: admission?.ready,
        cap: admission?.cap,
      });
    }

    // ONE bulk insert for the whole flush's worth of this stage, exactly as
    // `PipelineDispatchService.runSweepHop` does it. N awaited `send()` calls
    // would be N round trips — the shape that made the search-index backfill
    // block a request for minutes.
    //
    // DEFAULT_JOB_PRIORITY, deliberately between the two other tiers: an arrival
    // slice sits AHEAD of the sweep's backlog (BACKFILL_JOB_PRIORITY, -10), which
    // is the whole point of dispatching on arrival — otherwise a fresh row would
    // queue behind a corpus-wide re-embed. It sits BEHIND interactive work,
    // because nobody is watching a spinner for it.
    await this.eventService.sendMany(stage.queue, admitted, { priority: DEFAULT_JOB_PRIORITY });

    report.slices += admitted.length;
    report.dispatched += admitted.reduce((total, job) => total + (job.data.ids as string[]).length, 0);
  }

  /**
   * Which ids still exist, who owns them, and which the stage APPLIES to.
   *
   * One statement per stage per flush. It answers three questions the arrival
   * payload cannot:
   *
   *  - **the owner.** `*CreatedEvent` payloads carry an id and nothing else, and
   *    a slice payload requires a `userId`.
   *  - **applicability.** `StageSource.predicate` declares which rows the stage
   *    applies to (`variant = 'ORIGINAL' AND content_type LIKE 'image/%'`).
   *    Handing a stage a row it does not apply to would make it record a real
   *    ledger outcome about a row it should never have seen, and coverage would
   *    then be a number about the wrong population.
   *  - **existence.** A row created and deleted inside one window resolves to
   *    nothing and is simply not enqueued.
   *
   * What it deliberately does NOT ask is whether the stage has already RUN.
   * That is THE ONE RULE's question, it has exactly one implementation
   * (`selectStale`), and re-stating a piece of it here would be a second
   * definition of "stale" free to drift from the one that dispatches. It is also
   * unnecessary: `claim()` already refuses an id that is terminal at the current
   * version, so an arrival for an already-processed row costs an enqueue and a
   * claim that returns nothing — the ledger arbitrates, as it does for two
   * racing sweeps.
   */
  private async resolveOwners(stage: Stage, ids: string[]): Promise<OwnerRow[]> {
    const { schema, table, idColumn, userColumn, predicate } = stage.source;

    assertIdentifier('schema', schema);
    assertIdentifier('table', table);
    assertIdentifier('id column', idColumn);
    assertIdentifier('user column', userColumn);

    const applicability = predicate != null && predicate.trim().length > 0 ? predicate : 'TRUE';

    return this.dataSource.query<OwnerRow[]>(
      `SELECT s."${idColumn}"::text AS id, s."${userColumn}"::text AS user_id
         FROM "${schema}"."${table}" s
        WHERE s."${idColumn}" = ANY($1::uuid[])
          AND s."${userColumn}" IS NOT NULL
          AND (${applicability})`,
      [ids],
    );
  }

  /**
   * The ledger `entity_type` an arrival slice is keyed under.
   *
   * Single-type stages (every stage today) answer immediately. A multi-type
   * stage cannot: `ci.pipeline_state` is keyed per `(entity_type, entity_id,
   * stage)`, and guessing would record one type's progress under another's key —
   * the same refusal `PipelineStateService.resolveEntityType` and
   * `runSweepHop` make. Reported and skipped rather than thrown, because this
   * runs on a timer, and the fix (name the type in the signal) is in the message.
   */
  private entityTypeFor(stage: Stage): string | null {
    if (stage.entityTypes.length === 1) {
      return stage.entityTypes[0];
    }

    this.logger.error(
      `Stage "${stage.id}" declares ${stage.entityTypes.length} entity types ` +
        `(${stage.entityTypes.join(', ')}), so an arrival cannot know which ledger leg it belongs to. ` +
        `Give ARRIVAL_SIGNALS a per-stage entity type before declaring this stage 'onArrival'.`,
    );

    return null;
  }

  /** Start the fixed window, if one is not already running. */
  private arm(): void {
    if (this.timer != null) {
      return;
    }

    this.timer = setTimeout(() => {
      this.timer = null;

      // Nothing awaits this, so it must not reject: `application.ts` answers an
      // unhandled rejection with `process.exit(1)`, and a listener on the
      // import hot path taking the API down is a strictly worse outcome than a
      // window's worth of arrivals falling back to the sweep.
      void this.flush().catch((err: unknown) => {
        this.logger.error(
          'Pipeline arrival flush failed; the arrivals stay stale for the next sweep',
          err instanceof Error ? err : new Error(String(err)),
        );
      });
    }, ARRIVAL_COALESCE_WINDOW_MS);

    // The window must never be the reason a process stays alive. Guarded rather
    // than called outright because `setTimeout` returns a plain number under a
    // browser-shaped or faked timer environment, and this file is on the import
    // hot path where a TypeError would be a per-row throw.
    const handle = this.timer as { unref?: () => void };

    if (typeof handle.unref === 'function') {
      handle.unref();
    }
  }

  private disarm(): void {
    if (this.timer != null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}

// ---------------------------------------------------------------------------
// Payload reading
// ---------------------------------------------------------------------------

/**
 * The id out of an arrival payload, or `null`.
 *
 * The payload came off `pgboss.job.data` — untrusted JSON written by some
 * earlier release, carrying whatever envelope keys the bus adds. Read, never
 * cast. Deliberately not a zod schema: this runs once per imported row, the
 * shape is one optional string, and a per-row schema parse on the import hot
 * path buys nothing over a typeof check.
 */
function readId(payload: unknown, idField: string): string | null {
  if (typeof payload !== 'object' || payload == null) {
    return null;
  }

  const value = (payload as Record<string, unknown>)[idField];

  if (typeof value !== 'string' || value.trim().length === 0) {
    return null;
  }

  return value;
}

function assertIdentifier(kind: string, value: string): void {
  if (!SQL_IDENTIFIER.test(value)) {
    throw new Error(
      `Invalid SQL ${kind} "${value}" in a StageSource. Identifiers are interpolated into the arrival ` +
        `resolve and must be plain in-repo literals matching ${String(SQL_IDENTIFIER)}.`,
    );
  }
}
