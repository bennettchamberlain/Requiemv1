import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { LoggerService } from '@ci/common/logging';

import {
  ENRICHMENT_ROTATION,
  ENRICHMENT_WINDOW,
  MAX_BUDGET_CHARGE_PER_TICK_MS,
  PIPELINE_TURNS_TABLE,
} from '../constants';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * THE NIGHTLY WINDOW, AND WHOSE TURN IT IS.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Two decisions the control tick could not previously make, because it had
 * nowhere to make them from:
 *
 *  1. **May the appliance spend on enrichment right now?** Before this, the
 *     answer was always yes. A five-minute tick with a queue-depth cap is not a
 *     budget — it is a permanent background tenant that is never egregious at
 *     any single moment and never stops. The stages it starts share ONE Ollama
 *     process with interactive chat, HBPE and the summary sidecar, and
 *     `BackpressureService` states outright that this process has no honest way
 *     to measure that contention. What cannot be measured must be bounded, and
 *     the only bound that needs no measurement is a clock.
 *
 *  2. **Whose turn is it?** Before this, nothing iterated users fairly. The
 *     tick read `ci.users` in `u.id` order behind a LIMIT, so a second user
 *     waited behind the WHOLE of the first user's archive — weeks, on a real
 *     import — and a user beyond the LIMIT was never examined at all.
 *
 * ── The contract, in one call ──────────────────────────────────────────────
 *
 * {@link takeTurn} is the tick's entire interaction with this service: hand it
 * the users it is considering, get back the ones it may serve. Everything else
 * here is either a cheaper form of the same question ({@link isOpen}, for the
 * sweep hop) or a correction ({@link releaseTurn}, when the holder turns out to
 * have nothing to do).
 *
 * ── What makes a small nightly budget safe ─────────────────────────────────
 *
 * Resumability, and it is not this service's doing — it is the ledger's. A
 * sweep stopped mid-flight loses only the slice in flight: `ci.pipeline_state`
 * already records every entity that finished, `ci.pipeline_shards.cursor`
 * already holds the keyset position, and THE ONE RULE re-derives exactly the
 * remainder on the next pass. So stopping is FREE, which is the property that
 * lets the budget be small. This service is careful to preserve it: it never
 * writes to `ci.pipeline_runs` or `ci.pipeline_shards`, never finalizes a run
 * and never clears a cursor. Closing the window stops work being STARTED; it
 * does not unwind work already recorded. Tomorrow resumes where tonight
 * stopped because nothing tore anything down.
 *
 * ── Why the state is in Postgres and not in this object ────────────────────
 *
 * An in-memory rotation pointer resets on every deploy, and a deploy at 23:00
 * every day would hand the window to the same user every night — the exact
 * starvation the rotation exists to remove — while looking perfectly fair in
 * any test that does not restart the process. Both facts therefore live in
 * `ci.pipeline_turns`: one row per user, `last_served_at` as the pointer and
 * `spent_ms` as tonight's cost. The migration that creates it explains why that
 * is a new table rather than a column on `ci.pipeline_runs`.
 *
 * ── What this service deliberately does NOT do ─────────────────────────────
 *
 * It does not decide WHICH STAGES are due — that is per-stage cadence, and it
 * belongs beside the stage declarations, not inside the clock. It does not
 * count queue depth (`BackpressureService`), does not read `desired_state`, and
 * has no opinion about a run a human started deliberately. The window governs
 * the TIMER. A person who presses "reprocess" at two in the afternoon has
 * already answered the question this service exists to ask.
 */

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

/**
 * Why the window is open or closed. A stable, greppable token — the same
 * discipline `AdmissionReason` and `StageResult.reason` follow, because "why is
 * nothing being enqueued?" has to be answerable by counting something.
 */
export type WindowState =
  /** Inside the window, with budget left. Work may be dispatched. */
  | 'open'
  /** Outside the window's wall-clock hours. */
  | 'closed'
  /** Inside the hours, but tonight's budget is spent. */
  | 'budget_spent'
  /** `enrichment.window.enabled` is false: enrichment is free-running. */
  | 'disabled'
  /** `ci.pipeline_turns` is not migrated on this database. Fails closed. */
  | 'unavailable';

/** Tonight's window, as one instant sees it. */
export interface WindowStatus {
  /** May enrichment be dispatched right now? */
  open: boolean;

  state: WindowState;

  /**
   * The night this status belongs to, `YYYY-MM-DD` — the LOCAL DATE of the
   * moment the window opened, so a window crossing midnight is one night.
   */
  night: string;

  /** When the most recent window opened. */
  opensAt: Date;

  /** When it closes on the clock, budget aside. */
  closesAt: Date;

  /** When the next one opens. What a UI says while the window is shut. */
  nextOpensAt: Date;

  /** Tonight's allowance. */
  budgetMs: number;

  /** Spent so far tonight, appliance-wide. */
  spentMs: number;

  /**
   * What is left to spend, which is the SMALLER of the remaining budget and the
   * time left on the clock — a budget cannot be spent after the window shuts.
   * Zero whenever {@link open} is false.
   */
  remainingMs: number;

  /** The IANA zone the wall clock was read in. Resolved, never empty. */
  timeZone: string;
}

/** What one tick may do, and to whom. */
export interface TurnDecision {
  window: WindowStatus;

  /**
   * The users this tick may serve, in the order the rotation chose them. Empty
   * whenever the window is not open — a caller can therefore iterate this and
   * never has to remember to check {@link WindowStatus.open} as well.
   */
  users: string[];

  /** Candidates that were not chosen. They are ahead in tomorrow's rotation. */
  waiting: number;

  /** Budget charged by THIS tick, in ms. Zero on the first tick of a night. */
  chargedMs: number;
}

/** One `ci.pipeline_turns` row, as this service reads it. */
interface TurnRow {
  user_id: string;
  last_served_at: Date | string | null;
  turn_started_at: Date | string | null;
  night: Date | string | null;
  spent_ms: number | string | null;
}

/** The appliance-wide tally for one night. */
interface NightTally {
  spent_ms: number | string | null;
  last_tick_at: Date | string | null;
}

/** A local wall-clock reading, with no zone attached. */
interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

// ---------------------------------------------------------------------------
// Zoned wall-clock arithmetic
// ---------------------------------------------------------------------------

/**
 * The window is stated in the OWNER'S wall clock ("01:00"), and a wall clock is
 * not a duration: 01:00 is 23 hours after the previous 01:00 on the day the
 * clocks go forward and 25 on the day they go back. Adding 24 hours to an
 * instant is therefore wrong twice a year, in the direction of running the
 * window while somebody is awake.
 *
 * These three functions are the whole of the correction, and they use `Intl`
 * rather than a date library because the zone database is already in the
 * runtime and this needs no dependency to be right.
 *
 * Exported so the spec can assert them directly. They are the part of this file
 * most likely to be subtly wrong and least likely to be noticed.
 */
export function wallClockIn(instant: Date, timeZone: string): WallClock & { second: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);

  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((candidate) => candidate.type === type);

    return part == null ? 0 : Number(part.value);
  };

  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    // `hourCycle: 'h23'` keeps midnight as 0 rather than the 24 that `hour12:
    // false` produces in some ICU versions — a difference that would put the
    // window's start on the wrong day exactly once per night.
    hour: read('hour') % 24,
    minute: read('minute'),
    second: read('second'),
  };
}

/** The zone's UTC offset, in ms, AT a given instant. Positive east of UTC. */
export function zoneOffsetMs(instant: Date, timeZone: string): number {
  const wall = wallClockIn(instant, timeZone);

  return (
    Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second) -
    // Whole seconds only, on both sides: `formatToParts` cannot report
    // milliseconds, so keeping them here would make every offset look a
    // fraction of a second off.
    Math.floor(instant.getTime() / 1000) * 1000
  );
}

/**
 * The instant at which a local wall-clock reading occurs in a zone.
 *
 * Two passes. The first guesses using the offset in force at the naive UTC
 * interpretation of the wall time; the second re-reads the offset at that
 * guess, which is what makes it correct across a DST transition — the offset
 * that applies is the one at the ANSWER, not the one at the question.
 *
 * A wall time inside a spring-forward gap (02:30 where 02:00 jumps to 03:00)
 * does not exist. Both passes land on the same side of the jump and the result
 * is the first instant after it, which is the useful answer: the window opens
 * as soon as that clock time is reachable.
 */
export function instantOfWallClock(wall: WallClock, timeZone: string): Date {
  const naive = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, 0, 0);

  const firstPass = naive - zoneOffsetMs(new Date(naive), timeZone);

  return new Date(naive - zoneOffsetMs(new Date(firstPass), timeZone));
}

/** `YYYY-MM-DD` in a zone. The `night` label, and a Postgres `date` literal. */
function dateKeyIn(instant: Date, timeZone: string): string {
  const wall = wallClockIn(instant, timeZone);

  return (
    `${String(wall.year).padStart(4, '0')}-` +
    `${String(wall.month).padStart(2, '0')}-` +
    `${String(wall.day).padStart(2, '0')}`
  );
}

/** Coerce a Postgres timestamp — `Date`, or a string on some drivers — to ms. */
function toMillis(value: Date | string | null | undefined): number | null {
  if (value == null) {
    return null;
  }

  const millis = value instanceof Date ? value.getTime() : new Date(value).getTime();

  return Number.isNaN(millis) ? null : millis;
}

/** node-postgres hands `bigint` back as a string; a string sum is not a sum. */
function toCount(value: number | string | null | undefined): number {
  const count = Number(value ?? 0);

  return Number.isFinite(count) ? count : 0;
}

// ---------------------------------------------------------------------------
// The service
// ---------------------------------------------------------------------------

@Injectable()
export class EnrichmentWindowService {
  /**
   * The zone the window's wall clock is read in, resolved once.
   *
   * An unusable configured zone is reported and replaced with the host's rather
   * than thrown, for the same reason `BackpressureService` never throws: this
   * is consulted by a scheduler, and a scheduler that dies at boot because a
   * timezone string had a typo has taken the whole appliance's enrichment down
   * over a cosmetic setting.
   */
  private readonly timeZone: string;

  /**
   * Whether `ci.pipeline_turns` has been seen. Only a TRUE result is cached: a
   * node that started before `migrate-database` finished must be able to notice
   * the table appearing, and a cached false would keep the window shut until
   * the next deploy.
   */
  private tablePresent = false;

  /** So the "not migrated" warning is one line, not one line every five minutes. */
  private warnedAboutMissingTable = false;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(EnrichmentWindowService.name);
    this.timeZone = this.resolveTimeZone(ENRICHMENT_WINDOW.timezone);
  }

  // -------------------------------------------------------------------------
  // Reading the window
  // -------------------------------------------------------------------------

  /**
   * Tonight's window, WITHOUT taking a turn or charging anything.
   *
   * Read-only in the strictest sense — no statement it issues writes — so it is
   * safe on an operator route, in a health check, and inside a sweep hop that
   * is deciding whether to re-enqueue itself.
   */
  async status(now: Date = new Date()): Promise<WindowStatus> {
    const bounds = this.bounds(now);

    if (!ENRICHMENT_WINDOW.enabled) {
      // Free-running. Reported as a state rather than as `open`, because "the
      // window let this through" and "there is no window" are different facts
      // and an operator reading a log line deserves to be told which.
      return { ...bounds, open: true, state: 'disabled', spentMs: 0, remainingMs: Infinity };
    }

    if (now.getTime() < bounds.opensAt.getTime() || now.getTime() >= bounds.closesAt.getTime()) {
      return { ...bounds, open: false, state: 'closed', spentMs: 0, remainingMs: 0 };
    }

    if (!(await this.turnsTablePresent())) {
      return { ...bounds, open: false, state: 'unavailable', spentMs: 0, remainingMs: 0 };
    }

    const tally = await this.nightTally(bounds.night);

    return this.applyBudget(bounds, toCount(tally?.spent_ms), now);
  }

  /**
   * May enrichment be dispatched right now? The cheap form of {@link status}.
   *
   * Meant for the places that are not the tick — most importantly a sweep hop
   * deciding whether to re-enqueue itself. A sweep is a self-requeuing chain
   * bounded only by `MAX_SWEEP_HOPS` (10,000 hops × 5 slices × 200 ids = 10M
   * entities), so a window that gates ONLY the tick would let a sweep started
   * at 01:05 run until dawn. Gating the hop is what makes the budget a bound on
   * the night rather than a bound on how often work is started.
   */
  async isOpen(now: Date = new Date()): Promise<boolean> {
    return (await this.status(now)).open;
  }

  // -------------------------------------------------------------------------
  // Taking a turn
  // -------------------------------------------------------------------------

  /**
   * Decide who this tick may serve, charge the budget, and persist the pointer.
   *
   * The candidates are the users the tick was already going to consider, so
   * this never widens the tick's scope — it only narrows and orders it.
   *
   * ── What is charged, and to whom ───────────────────────────────────────────
   *
   * The budget measures WALL TIME during which the appliance was dispatching,
   * so a tick charges the interval since the previous DISPATCHING tick of the
   * same night, capped at {@link MAX_BUDGET_CHARGE_PER_TICK_MS} so that a
   * suspended appliance is not billed for the hours it was asleep. The first
   * dispatching tick of a night charges nothing — it starts the clock; the
   * second charges the gap. That is deliberately an under-count of one tick per
   * night, in the only safe direction.
   *
   * With more than one holder the SAME wall time is spent on all of them at
   * once, so the charge is split rather than multiplied: the appliance-wide sum
   * over a night stays equal to the wall time actually spent, which is the
   * number the budget is stated in.
   *
   * ── Failure is a closed window ─────────────────────────────────────────────
   *
   * Every failure path answers "no users" and logs. The asymmetry is
   * `BackpressureService`'s: a wrong "no" costs one five-minute tick and the
   * next one re-asks, while a wrong "yes" is Ollama contention against a person
   * who is awake, or a metered geocoding call nobody authorised.
   */
  async takeTurn(candidateUserIds: readonly string[], now: Date = new Date()): Promise<TurnDecision> {
    const candidates = [...new Set(candidateUserIds)];

    let window: WindowStatus;

    try {
      window = await this.status(now);
    } catch (err: unknown) {
      this.logger.error(
        'The enrichment window could not be read; no enrichment will be dispatched this tick',
        err instanceof Error ? err : new Error(String(err)),
      );

      return {
        window: this.closedFor(now, 'unavailable'),
        users: [],
        waiting: candidates.length,
        chargedMs: 0,
      };
    }

    if (!window.open) {
      // NOTHING is written on this path — not a pointer, not a charge. A closed
      // window must be indistinguishable from a tick that never ran, or an
      // appliance left powered on through a month of closed windows would drift
      // its rotation without ever doing a minute of work.
      return { window, users: [], waiting: candidates.length, chargedMs: 0 };
    }

    if (candidates.length === 0) {
      return { window, users: [], waiting: 0, chargedMs: 0 };
    }

    if (window.state === 'disabled') {
      // No window means no rotation to arbitrate and no budget to charge: every
      // candidate is served, exactly as before this service existed. The
      // pointer is still stamped — when the table is there to stamp it on — so
      // switching the window back on picks the rotation up where free-running
      // left it instead of from nothing. No turn is opened: free-running has no
      // turns to take, and stamping one every tick would make `turns` count
      // ticks rather than handovers.
      if (await this.turnsTablePresent()) {
        await this.recordServed(candidates, now, window.night, 0, new Map());
      }

      return { window, users: candidates, waiting: 0, chargedMs: 0 };
    }

    let rows: TurnRow[];
    let tally: NightTally | null;

    try {
      [rows, tally] = await Promise.all([this.turnRows(candidates), this.nightTally(window.night)]);
    } catch (err: unknown) {
      this.logger.error(
        'The enrichment rotation could not be read; no enrichment will be dispatched this tick',
        err instanceof Error ? err : new Error(String(err)),
      );

      return {
        window: this.closedFor(now, 'unavailable'),
        users: [],
        waiting: candidates.length,
        chargedMs: 0,
      };
    }

    const byUser = new Map(rows.map((row) => [row.user_id, row]));

    // ── Who holds the window right now? ────────────────────────────────────
    //
    // A turn is durable and survives a restart: `turn_started_at` is a column,
    // so a deploy at 02:00 resumes the same holder rather than reshuffling the
    // rotation and giving everybody a fraction of a turn.
    const holding = candidates
      .filter((userId) => this.holdsTurn(byUser.get(userId), window.night, now))
      .slice(0, ENRICHMENT_ROTATION.usersPerTurn);

    // ── Who is next? ───────────────────────────────────────────────────────
    //
    // Least-recently-served first, and a user with NO ROW has never been served
    // at all, so they sort ahead of everybody. That is the late-joiner
    // guarantee: joining today does not mean queueing behind every archive that
    // arrived before yours.
    const waitingTurn = candidates
      .filter((userId) => !holding.includes(userId))
      .sort((left, right) => {
        const leftServed = toMillis(byUser.get(left)?.last_served_at ?? null);
        const rightServed = toMillis(byUser.get(right)?.last_served_at ?? null);

        if (leftServed !== rightServed) {
          // NULLS FIRST. Never served outranks served-a-year-ago, which
          // outranks served-tonight.
          return (leftServed ?? -Infinity) - (rightServed ?? -Infinity);
        }

        // A stable, arbitrary tiebreak. Two users with identical pointers is
        // the first-boot case; without this the order would come from the
        // database's row order and the rotation would not be reproducible.
        return left < right ? -1 : left > right ? 1 : 0;
      });

    const users = [...holding, ...waitingTurn].slice(0, ENRICHMENT_ROTATION.usersPerTurn);

    // ── Charge ─────────────────────────────────────────────────────────────
    const lastTickAt = toMillis(tally?.last_tick_at ?? null);
    const chargedMs =
      lastTickAt == null
        ? 0
        : Math.min(Math.max(now.getTime() - lastTickAt, 0), MAX_BUDGET_CHARGE_PER_TICK_MS);

    const turnStartedAt = new Map<string, Date | null>();

    for (const userId of users) {
      const existing = this.holdsTurn(byUser.get(userId), window.night, now)
        ? toMillis(byUser.get(userId)?.turn_started_at ?? null)
        : null;

      turnStartedAt.set(userId, existing == null ? now : new Date(existing));
    }

    try {
      await this.recordServed(users, now, window.night, chargedMs, turnStartedAt);
    } catch (err: unknown) {
      // The pointer is what stops the same user being served forever. If it
      // cannot be written, serving anybody would be unbounded, so nothing is
      // served — one tick lost, and the next tick re-derives the same decision.
      this.logger.error(
        'The enrichment rotation pointer could not be written; nothing is dispatched this tick',
        err instanceof Error ? err : new Error(String(err)),
      );

      return { window, users: [], waiting: candidates.length, chargedMs: 0 };
    }

    return {
      window: { ...window, spentMs: window.spentMs + chargedMs },
      users,
      waiting: candidates.length - users.length,
      chargedMs,
    };
  }

  /**
   * Hand the window back early, because the holder had nothing to do.
   *
   * The tick discovers this AFTER probing twelve stages, which is too late to
   * have chosen somebody else — but it is not too late to make sure the next
   * tick does. Without this, a drained user would hold a twenty-minute turn
   * doing nothing while a user with a real backlog waited, and a household
   * where most people are converged would spend most of the night idle.
   *
   * `last_served_at` is stamped as it is released, so the released user goes to
   * the BACK of the rotation. A user who was offered the window and had nothing
   * to do has had their turn.
   */
  async releaseTurn(userId: string, now: Date = new Date()): Promise<void> {
    if (!ENRICHMENT_WINDOW.enabled || !(await this.turnsTablePresent())) {
      return;
    }

    try {
      await this.dataSource.query(
        `UPDATE ${PIPELINE_TURNS_TABLE}
            SET turn_started_at = NULL,
                last_served_at  = $2::timestamptz,
                updated_at      = now()
          WHERE user_id = $1::uuid`,
        [userId, now.toISOString()],
      );
    } catch (err: unknown) {
      // Never fatal. The turn expires on its own after `turnMs`, so the worst
      // case is that the rotation moves on at the end of the turn rather than
      // immediately — slower, never stuck.
      this.logger.error(
        `Could not release the enrichment turn for user ${userId}; it will expire on its own`,
        err instanceof Error ? err : new Error(String(err)),
      );
    }
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /**
   * The most recent window on the clock, and the next one.
   *
   * "Most recent occurrence at or before now", never "today's". At 00:30 with a
   * 01:00 start it is YESTERDAY's window that is relevant, and if that one is
   * still open (a duration that crosses midnight) the appliance is inside it.
   * Computing today's and comparing would close the window at midnight every
   * night, silently halving any window that spans it.
   */
  private bounds(now: Date): Omit<WindowStatus, 'open' | 'state' | 'spentMs' | 'remainingMs'> {
    const [startHour, startMinute] = ENRICHMENT_WINDOW.start.split(':').map(Number);
    const wall = wallClockIn(now, this.timeZone);

    const startOn = (dayOffset: number): Date =>
      instantOfWallClock(
        {
          year: wall.year,
          month: wall.month,
          // Overflow is intended and handled by `Date.UTC`: day 0 is the last
          // day of the previous month, day 32 is the 1st of the next.
          day: wall.day + dayOffset,
          hour: startHour,
          minute: startMinute,
        },
        this.timeZone,
      );

    const today = startOn(0);
    const opensAt = today.getTime() <= now.getTime() ? today : startOn(-1);
    const closesAt = new Date(opensAt.getTime() + ENRICHMENT_WINDOW.durationMs);
    const nextOpensAt = today.getTime() > now.getTime() ? today : startOn(1);

    return {
      night: dateKeyIn(opensAt, this.timeZone),
      opensAt,
      closesAt,
      nextOpensAt,
      budgetMs: ENRICHMENT_WINDOW.budgetMs,
      timeZone: this.timeZone,
    };
  }

  /** Apply tonight's spend to the clock bounds. */
  private applyBudget(
    bounds: Omit<WindowStatus, 'open' | 'state' | 'spentMs' | 'remainingMs'>,
    spentMs: number,
    now: Date,
  ): WindowStatus {
    const budgetLeft = bounds.budgetMs - spentMs;
    // The smaller of the two limits: the budget cannot be spent after the
    // window shuts, and the window's remaining hours are worth nothing without
    // budget to spend in them.
    const remainingMs = Math.min(budgetLeft, bounds.closesAt.getTime() - now.getTime());

    if (remainingMs <= 0) {
      return {
        ...bounds,
        open: false,
        state: budgetLeft <= 0 ? 'budget_spent' : 'closed',
        spentMs,
        remainingMs: 0,
      };
    }

    return { ...bounds, open: true, state: 'open', spentMs, remainingMs };
  }

  /** A closed status for a failure path, computed without touching the database. */
  private closedFor(now: Date, state: WindowState): WindowStatus {
    return { ...this.bounds(now), open: false, state, spentMs: 0, remainingMs: 0 };
  }

  /** Does this row hold a live turn tonight? */
  private holdsTurn(row: TurnRow | undefined, night: string, now: Date): boolean {
    if (row == null) {
      return false;
    }

    const startedAt = toMillis(row.turn_started_at);

    if (startedAt == null) {
      return false;
    }

    // A turn from a previous night is not a turn. Without this, an appliance
    // that shut down mid-turn would resume tomorrow with a turn that started
    // 24 hours ago, which is neither expired nor current.
    if (this.nightOf(row) !== night) {
      return false;
    }

    return now.getTime() < startedAt + ENRICHMENT_ROTATION.turnMs;
  }

  /** `night` as `YYYY-MM-DD`, whatever shape the driver returned it in. */
  private nightOf(row: TurnRow): string | null {
    if (row.night == null) {
      return null;
    }

    if (row.night instanceof Date) {
      // A `date` column arrives as a Date at local midnight, so the UTC
      // components would be the PREVIOUS day west of Greenwich. Read the local
      // ones, which are the ones Postgres put there.
      return (
        `${String(row.night.getFullYear()).padStart(4, '0')}-` +
        `${String(row.night.getMonth() + 1).padStart(2, '0')}-` +
        `${String(row.night.getDate()).padStart(2, '0')}`
      );
    }

    return String(row.night).slice(0, 10);
  }

  /** Turn rows for a set of candidates, including the users that have none. */
  private async turnRows(userIds: readonly string[]): Promise<TurnRow[]> {
    return this.dataSource.query<TurnRow[]>(
      `SELECT c.user_id::text AS user_id,
              t.last_served_at,
              t.turn_started_at,
              t.night,
              t.spent_ms
         FROM unnest($1::uuid[]) AS c(user_id)
         LEFT JOIN ${PIPELINE_TURNS_TABLE} t ON t.user_id = c.user_id`,
      [[...userIds]],
    );
  }

  /**
   * What one night has cost appliance-wide, and when it was last charged.
   *
   * Summed over EVERY user, not only this tick's candidates: the budget is a
   * property of the appliance, and a user who dropped out of the candidate set
   * mid-night (deactivated, deleted) still spent what they spent.
   */
  private async nightTally(night: string): Promise<NightTally | null> {
    const rows = await this.dataSource.query<NightTally[]>(
      `SELECT COALESCE(sum(spent_ms), 0)::bigint AS spent_ms,
              max(last_served_at)                AS last_tick_at
         FROM ${PIPELINE_TURNS_TABLE}
        WHERE night = $1::date`,
      [night],
    );

    return rows[0] ?? null;
  }

  /**
   * Stamp the pointer, the turn and tonight's charge, in ONE statement.
   *
   * `spent_ms` accumulates only while the night is unchanged; a new night
   * REPLACES it. That is what makes "tonight's spend" a `sum ... WHERE night =
   * $1` with no history to reap and no reset job to forget to run.
   *
   * `turns` increments only when the turn actually changed hands, so the
   * counter answers "is the rotation rotating?" rather than "how many ticks
   * were there?".
   */
  private async recordServed(
    userIds: readonly string[],
    now: Date,
    night: string,
    chargedMs: number,
    turnStartedAt: ReadonlyMap<string, Date | null>,
  ): Promise<void> {
    if (userIds.length === 0) {
      return;
    }

    // Split, not multiplied: two holders spend the same wall time at once, so
    // charging each of them the full interval would spend a 90-minute budget in
    // 45 minutes of clock.
    const share = Math.round(chargedMs / userIds.length);

    await this.dataSource.query(
      `INSERT INTO ${PIPELINE_TURNS_TABLE} AS t
              (user_id, last_served_at, turn_started_at, night, spent_ms, turns, updated_at)
       SELECT u.user_id,
              $2::timestamptz,
              u.turn_started_at,
              $3::date,
              $4::bigint,
              CASE WHEN u.turn_started_at IS NULL THEN 0 ELSE 1 END,
              now()
         FROM unnest($1::uuid[], $5::timestamptz[]) AS u(user_id, turn_started_at)
       ON CONFLICT (user_id) DO UPDATE
          SET last_served_at  = EXCLUDED.last_served_at,
              turn_started_at = EXCLUDED.turn_started_at,
              spent_ms        = CASE
                                  WHEN t.night = EXCLUDED.night THEN t.spent_ms + EXCLUDED.spent_ms
                                  ELSE EXCLUDED.spent_ms
                                END,
              night           = EXCLUDED.night,
              turns           = t.turns
                                  + CASE
                                      WHEN t.turn_started_at IS DISTINCT FROM EXCLUDED.turn_started_at
                                      THEN 1 ELSE 0
                                    END,
              updated_at      = now()`,
      [
        [...userIds],
        now.toISOString(),
        night,
        share,
        // `null` where the caller opened no turn (free-running). `IS DISTINCT
        // FROM` treats NULL-to-NULL as unchanged, so `turns` is not incremented
        // by a tick that took no turn.
        userIds.map((userId) => turnStartedAt.get(userId)?.toISOString() ?? null),
      ],
    );
  }

  /**
   * Is `ci.pipeline_turns` migrated on this database?
   *
   * Same guard, and the same reason, as `PipelineControlService.controlPlanePresent`:
   * the migration is applied by dbmate, not by pg-boss at boot, so the table is
   * absent on a node that started before `migrate-database` finished. Answered
   * closed, and said once — on a five-minute timer an unguarded missing relation
   * is a stack trace every five minutes forever.
   */
  private async turnsTablePresent(): Promise<boolean> {
    if (this.tablePresent) {
      return true;
    }

    const rows = await this.dataSource.query<Array<{ present: boolean }>>(
      `SELECT to_regclass($1) IS NOT NULL AS present`,
      [PIPELINE_TURNS_TABLE],
    );

    this.tablePresent = rows[0]?.present === true;

    if (!this.tablePresent && !this.warnedAboutMissingTable) {
      this.warnedAboutMissingTable = true;

      this.logger.warn(
        `${PIPELINE_TURNS_TABLE} is missing, so the enrichment window cannot record whose turn it is or ` +
          `what tonight has cost. Nothing will be dispatched until \`yarn workspace @ci/be-api migrate\` ` +
          `has run. Dispatching without the pointer would serve the same user every tick, forever.`,
      );
    }

    return this.tablePresent;
  }

  /**
   * The configured zone, or the host's.
   *
   * The host's zone is the right default on an appliance: it is the box sitting
   * in the owner's house, so its clock is already the clock they sleep by. The
   * override exists for a box that is not — a hosted instance, or a household
   * spread across timezones that has picked one.
   */
  private resolveTimeZone(configured: string): string {
    const hostZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

    if (configured.trim().length === 0) {
      return hostZone;
    }

    try {
      // The only reliable validity check: constructing a formatter with an
      // unknown zone throws a RangeError.
      new Intl.DateTimeFormat('en-US', { timeZone: configured }).format(new Date());

      return configured;
    } catch {
      this.logger.error(
        `enrichment.window.timezone is "${configured}", which is not a zone this runtime knows. Falling ` +
          `back to the host zone "${hostZone}", so the window may open at the wrong local hour until it is ` +
          `corrected.`,
      );

      return hostZone;
    }
  }
}
