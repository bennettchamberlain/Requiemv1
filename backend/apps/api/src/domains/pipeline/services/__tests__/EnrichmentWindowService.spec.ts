import { randomUUID } from 'node:crypto';

import { DataSource, type QueryRunner } from 'typeorm';

import type { LoggerService } from '@ci/common/logging';

import { databaseAvailability, resolveConnection } from '../../__tests__/harness/pipelineHarness';
import {
  ENRICHMENT_ROTATION,
  ENRICHMENT_WINDOW,
  MAX_BUDGET_CHARGE_PER_TICK_MS,
  PIPELINE_TURNS_TABLE,
} from '../../constants';
import { EnrichmentWindowService, instantOfWallClock, wallClockIn } from '../EnrichmentWindowService';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * A NIGHTLY BUDGET, AND A ROTATION THAT SURVIVES A DEPLOY.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The properties under test are not "it reads a clock" and "it sorts a list".
 * They are the four ways this component is allowed to be wrong, each of which
 * is silent in production:
 *
 *  - **it dispatches outside the window.** The whole point is that the
 *    appliance is quiet while its owner is awake. A window that leaks is a
 *    window that does not exist, and nothing in a log would say so — enrichment
 *    running at 3pm looks exactly like enrichment running at 3am.
 *  - **the budget is not a bound.** A budget that is only checked when work
 *    STARTS is not a budget: a sweep re-enqueues itself for up to
 *    `MAX_SWEEP_HOPS` hops, so one tick at 01:05 could run until dawn. The
 *    countdown has to be readable cheaply enough that the hop can ask too.
 *  - **stopping costs work.** A small nightly budget is only safe because a
 *    stopped sweep RESUMES: the cursor is in `ci.pipeline_shards`, the ledger
 *    holds every finished entity, and closing the window must not disturb
 *    either. If closing the window finalized runs or cleared cursors, every
 *    night would restart the corpus and a 324,044-row appliance would never
 *    converge.
 *  - **the rotation is in memory.** An in-memory pointer looks perfectly fair
 *    in any test that does not restart the process, and starves the same user
 *    every night on a box that is deployed to daily.
 *
 * ## Two halves
 *
 * **Against a fake `DataSource`** — the decisions, with an explicit clock and
 * an in-memory stand-in for `ci.pipeline_turns`. Fast, hermetic, always runs,
 * and able to model "the table is missing" and "the write failed", which a real
 * database cannot be asked for politely.
 *
 * **Against real Postgres** — the statements. The upsert's `ON CONFLICT`
 * arithmetic (accumulate within a night, RESET across one), `bigint` coming
 * back as a string, `unnest` over parallel arrays with NULLs in them, and the
 * `date` round trip. A mock agrees with whatever the statement asks it.
 *
 * The database half creates `ci.pipeline_turns` inside its transaction if the
 * migration has not been applied yet, and **always rolls back** — so it runs on
 * an un-migrated database, writes nothing to the live appliance, and leaves
 * nothing to clean up.
 */

const availability = databaseAvailability();
const describeWithDatabase = availability.available ? describe : describe.skip;

if (!availability.available) {
  console.warn(`[EnrichmentWindowService.spec] SKIPPED (database half) — ${availability.reason}`);
}

// ---------------------------------------------------------------------------
// A clock the tests own
// ---------------------------------------------------------------------------

/**
 * Every assertion is anchored to a real instant INSIDE the configured window,
 * computed the same way the service computes it, rather than to a hardcoded
 * "02:00Z". The suite must pass on a laptop in any timezone and on a CI box in
 * UTC, and the window is stated in local wall-clock time.
 */
function windowOpensOn(dayOffset = 0): Date {
  const [hour, minute] = ENRICHMENT_WINDOW.start.split(':').map(Number);
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const wall = wallClockIn(new Date(), zone);

  return instantOfWallClock(
    { year: wall.year, month: wall.month, day: wall.day + dayOffset, hour, minute },
    zone,
  );
}

/** `minutes` after the window opened. */
function insideWindow(minutes: number, dayOffset = 0): Date {
  return new Date(windowOpensOn(dayOffset).getTime() + minutes * 60_000);
}

/** An instant safely outside the window: one minute before it opens. */
function beforeWindow(dayOffset = 0): Date {
  return new Date(windowOpensOn(dayOffset).getTime() - 60_000);
}

/** An instant after the window has shut on the clock. */
function afterWindow(dayOffset = 0): Date {
  return new Date(windowOpensOn(dayOffset).getTime() + ENRICHMENT_WINDOW.durationMs + 60_000);
}

// ---------------------------------------------------------------------------
// Half one: the decisions, against a fake DataSource
// ---------------------------------------------------------------------------

/** One `ci.pipeline_turns` row, as the fake store holds it. */
interface FakeTurn {
  user_id: string;
  last_served_at: Date | null;
  turn_started_at: Date | null;
  night: string | null;
  spent_ms: number;
  turns: number;
}

interface Statement {
  sql: string;
  params: unknown[];
}

interface HarnessOptions {
  /** Rows already in `ci.pipeline_turns`. */
  seed?: FakeTurn[];
  /** Model an un-migrated database. */
  tableMissing?: boolean;
  /** Make the upsert fail, the way a dead connection would. */
  writeError?: Error;
  /** Make every read fail. */
  readError?: Error;
}

/**
 * `ci.pipeline_turns` in memory, plus a `DataSource` that speaks to it.
 *
 * The store is shared by reference so a test can build a SECOND service over
 * the same rows — which is how "the pointer survives a restart" is expressed
 * without a container to restart.
 */
function makeStore(seed: FakeTurn[] = []): Map<string, FakeTurn> {
  return new Map(seed.map((row) => [row.user_id, { ...row }]));
}

function makeService(store: Map<string, FakeTurn>, options: HarnessOptions = {}) {
  const statements: Statement[] = [];

  const query = jest.fn(async (raw: string, params?: unknown[]) => {
    const sql = raw.replace(/\s+/g, ' ').trim();
    statements.push({ sql, params: params ?? [] });

    if (/to_regclass/i.test(sql)) {
      return [{ present: options.tableMissing !== true }];
    }

    if (options.readError != null && /^select/i.test(sql)) {
      throw options.readError;
    }

    // The night tally: sum(spent_ms), max(last_served_at), for one night.
    if (/sum\(spent_ms\)/i.test(sql)) {
      const night = (params ?? [])[0] as string;
      const rows = [...store.values()].filter((row) => row.night === night);

      return [
        {
          // node-postgres hands `bigint` back as a STRING. Modelled, because a
          // string sum silently compares as text against the budget.
          spent_ms: String(rows.reduce((total, row) => total + row.spent_ms, 0)),
          last_tick_at: rows.reduce<Date | null>(
            (latest, row) =>
              row.last_served_at != null && (latest == null || row.last_served_at > latest)
                ? row.last_served_at
                : latest,
            null,
          ),
        },
      ];
    }

    // The candidate LEFT JOIN.
    if (/left join/i.test(sql)) {
      const userIds = ((params ?? [])[0] ?? []) as string[];

      return userIds.map((userId) => {
        const row = store.get(userId);

        return {
          user_id: userId,
          last_served_at: row?.last_served_at ?? null,
          turn_started_at: row?.turn_started_at ?? null,
          night: row?.night ?? null,
          spent_ms: row == null ? null : String(row.spent_ms),
        };
      });
    }

    if (/^insert into ci\.pipeline_turns/i.test(sql)) {
      if (options.writeError != null) {
        throw options.writeError;
      }

      const [userIds, servedAt, night, share, turnStarts] = (params ?? []) as [
        string[],
        string,
        string,
        number,
        Array<string | null>,
      ];

      userIds.forEach((userId, index) => {
        const existing = store.get(userId);
        const turnStartedAt = turnStarts[index] == null ? null : new Date(turnStarts[index] as string);
        const sameNight = existing?.night === night;
        const changedTurn =
          (existing?.turn_started_at?.getTime() ?? null) !== (turnStartedAt?.getTime() ?? null);

        store.set(userId, {
          user_id: userId,
          last_served_at: new Date(servedAt),
          turn_started_at: turnStartedAt,
          night,
          spent_ms: (sameNight ? (existing?.spent_ms ?? 0) : 0) + Number(share),
          turns: (existing?.turns ?? 0) + (turnStartedAt != null && changedTurn ? 1 : 0),
        });
      });

      return [];
    }

    if (/^update ci\.pipeline_turns/i.test(sql)) {
      const [userId, servedAt] = (params ?? []) as [string, string];
      const existing = store.get(userId);

      if (existing != null) {
        existing.turn_started_at = null;
        existing.last_served_at = new Date(servedAt);
      }

      return [];
    }

    throw new Error(`EnrichmentWindowService issued an unexpected statement: ${sql}`);
  });

  const logger = {
    setContext: jest.fn(),
    log: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    verbose: jest.fn(),
  };

  const service = new EnrichmentWindowService(
    { query } as unknown as DataSource,
    logger as unknown as LoggerService,
  );

  return { service, logger, statements, store, query };
}

/** Ids that sort in a known order, so a tiebreak is assertable. */
const USER_A = '00000000-0000-4000-8000-00000000000a';
const USER_B = '00000000-0000-4000-8000-00000000000b';
const USER_C = '00000000-0000-4000-8000-00000000000c';

describe('EnrichmentWindowService', () => {
  // Every one of these assumes the shipped defaults are a real window with a
  // budget smaller than it. Stated once so a config change that would make the
  // suite meaningless fails here rather than making every test below vacuous.
  it('is testing an actually-bounded window', () => {
    expect(ENRICHMENT_WINDOW.enabled).toBe(true);
    expect(ENRICHMENT_WINDOW.budgetMs).toBeGreaterThan(0);
    expect(ENRICHMENT_WINDOW.budgetMs).toBeLessThanOrEqual(ENRICHMENT_WINDOW.durationMs);
    expect(ENRICHMENT_WINDOW.durationMs).toBeLessThan(24 * 60 * 60 * 1000);
  });

  // -------------------------------------------------------------------------

  describe('nothing is dispatched outside the window', () => {
    it.each([
      ['before it opens', beforeWindow],
      ['after it closes', afterWindow],
    ])('serves nobody %s', async (_label, at) => {
      const h = makeService(makeStore());

      const decision = await h.service.takeTurn([USER_A, USER_B], at());

      expect(decision.users).toEqual([]);
      expect(decision.window.open).toBe(false);
      expect(decision.window.state).toBe('closed');
      expect(decision.waiting).toBe(2);
    });

    it('writes NOTHING while closed — not a pointer, not a charge', async () => {
      // A closed window must be indistinguishable from a tick that never ran.
      // An appliance left on through a month of closed windows would otherwise
      // drift its rotation without doing a minute of work, and the first user
      // to actually need the window would be at the back of it.
      const h = makeService(makeStore());

      await h.service.takeTurn([USER_A], beforeWindow());

      for (const { sql } of h.statements) {
        expect(sql).not.toMatch(/\b(insert|update|delete)\b/i);
      }

      expect(h.store.size).toBe(0);
    });

    it('says when the next window opens, so the wait is reportable', async () => {
      const status = await makeService(makeStore()).service.status(afterWindow());

      expect(status.nextOpensAt.getTime()).toBeGreaterThan(afterWindow().getTime());
      expect(status.nextOpensAt.getTime()).toBe(windowOpensOn(1).getTime());
    });

    it('opens inside the window', async () => {
      const h = makeService(makeStore());

      const decision = await h.service.takeTurn([USER_A], insideWindow(1));

      expect(decision.window.open).toBe(true);
      expect(decision.window.state).toBe('open');
      expect(decision.users).toEqual([USER_A]);
    });

    it('stays shut on a database the rotation table is missing from, and says so once', async () => {
      // Failing CLOSED is the asymmetry BackpressureService uses: a wrong "no"
      // costs one five-minute tick, a wrong "yes" is Ollama contention against
      // somebody who is awake, or a metered geocode nobody authorised.
      const h = makeService(makeStore(), { tableMissing: true });

      const first = await h.service.takeTurn([USER_A], insideWindow(10));
      const second = await h.service.takeTurn([USER_A], insideWindow(15));

      expect(first.users).toEqual([]);
      expect(first.window.state).toBe('unavailable');
      expect(second.users).toEqual([]);
      expect(h.logger.warn).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------

  describe('the budget stops the night', () => {
    it('reports the budget remaining, counting down as it is spent', async () => {
      const night = await nightKeyFor(insideWindow(10));
      const h = makeService(
        makeStore([
          {
            user_id: USER_A,
            last_served_at: insideWindow(5),
            turn_started_at: null,
            night,
            spent_ms: 30 * 60_000,
            turns: 1,
          },
        ]),
      );

      const status = await h.service.status(insideWindow(10));

      expect(status.spentMs).toBe(30 * 60_000);
      expect(status.remainingMs).toBe(
        Math.min(ENRICHMENT_WINDOW.budgetMs - 30 * 60_000, ENRICHMENT_WINDOW.durationMs - 10 * 60_000),
      );
      expect(status.open).toBe(true);
    });

    it('closes the window once the budget is spent, though the clock says hours left', async () => {
      // THE property. The window is permission; the budget is spend. An
      // appliance with hours of darkness left still stops, because the cost is
      // what was being bounded.
      const night = await nightKeyFor(insideWindow(20));
      const h = makeService(
        makeStore([
          {
            user_id: USER_A,
            last_served_at: insideWindow(19),
            turn_started_at: null,
            night,
            spent_ms: ENRICHMENT_WINDOW.budgetMs,
            turns: 3,
          },
        ]),
      );

      const decision = await h.service.takeTurn([USER_A, USER_B], insideWindow(20));

      expect(decision.window.state).toBe('budget_spent');
      expect(decision.window.open).toBe(false);
      expect(decision.users).toEqual([]);
      // Still inside the window on the clock — which is exactly why the budget
      // had to be a separate number.
      expect(insideWindow(20).getTime()).toBeLessThan(decision.window.closesAt.getTime());
    });

    it('charges the gap between two dispatching ticks, not the tick itself', async () => {
      const store = makeStore();
      const h = makeService(store);

      // First tick of the night starts the clock and charges nothing: there is
      // no previous dispatching tick to measure from.
      const first = await h.service.takeTurn([USER_A], insideWindow(0));
      expect(first.chargedMs).toBe(0);

      // Second tick, five minutes later, charges those five minutes.
      const second = await h.service.takeTurn([USER_A], insideWindow(5));
      expect(second.chargedMs).toBe(5 * 60_000);
      expect(store.get(USER_A)?.spent_ms).toBe(5 * 60_000);
    });

    it('does not bill a night for the hours the appliance was suspended', async () => {
      // A laptop-shaped box suspended at 01:10 and resumed at 05:00 would
      // otherwise spend a 90-minute budget on time when nothing ran — every
      // night, forever.
      const store = makeStore();
      const h = makeService(store);

      await h.service.takeTurn([USER_A], insideWindow(0));
      const resumed = await h.service.takeTurn([USER_A], insideWindow(200));

      expect(resumed.chargedMs).toBe(MAX_BUDGET_CHARGE_PER_TICK_MS);
      expect(store.get(USER_A)?.spent_ms).toBe(MAX_BUDGET_CHARGE_PER_TICK_MS);
    });

    it('starts a fresh budget on the next night', async () => {
      const store = makeStore();
      const h = makeService(store);

      await h.service.takeTurn([USER_A], insideWindow(0, -1));
      await h.service.takeTurn([USER_A], insideWindow(30, -1));

      const spentLastNight = store.get(USER_A)?.spent_ms ?? 0;
      expect(spentLastNight).toBeGreaterThan(0);

      const tonight = await h.service.status(insideWindow(1));

      // Last night's spend belongs to last night's key and is invisible to
      // tonight's sum, so nothing has to be reset and nothing has to be reaped.
      expect(tonight.spentMs).toBe(0);
      expect(tonight.open).toBe(true);
    });

    it('never lets remaining budget outlast the window on the clock', async () => {
      const status = await makeService(makeStore()).service.status(
        new Date(windowOpensOn().getTime() + ENRICHMENT_WINDOW.durationMs - 60_000),
      );

      expect(status.remainingMs).toBeLessThanOrEqual(60_000);
    });
  });

  // -------------------------------------------------------------------------

  describe('a stopped sweep resumes rather than restarting', () => {
    it('never touches a run, a shard or the ledger', async () => {
      // This is the whole reason a small nightly budget is safe. The cursor
      // lives in `ci.pipeline_shards`, every finished entity lives in
      // `ci.pipeline_state`, and THE ONE RULE re-derives the remainder. If
      // closing the window finalized runs or cleared cursors, each night would
      // restart the corpus and a 324,044-row appliance would never converge.
      const store = makeStore();
      const h = makeService(store);

      await h.service.takeTurn([USER_A], insideWindow(0));
      await h.service.takeTurn([USER_A], insideWindow(5));
      await h.service.takeTurn([USER_A], afterWindow());
      await h.service.releaseTurn(USER_A, afterWindow());

      for (const { sql } of h.statements) {
        expect(sql).not.toMatch(/pipeline_runs/i);
        expect(sql).not.toMatch(/pipeline_shards/i);
        expect(sql).not.toMatch(/pipeline_state/i);
      }
    });

    it('resumes the same turn after a restart instead of reshuffling the rotation', async () => {
      // A deploy at 02:00 must not hand the window to somebody else mid-turn:
      // both users would then get a fraction of a turn and neither would finish
      // a sweep. `turn_started_at` is a column for exactly this.
      const store = makeStore();
      const before = makeService(store);

      await before.service.takeTurn([USER_A, USER_B], insideWindow(0));

      // A brand-new instance: no fields, no caches, nothing carried over. The
      // only thing shared is the table.
      const after = makeService(store);
      const resumed = await after.service.takeTurn([USER_A, USER_B], insideWindow(3));

      expect(resumed.users).toEqual([USER_A]);
      expect(store.get(USER_A)?.turns).toBe(1);
    });
  });

  // -------------------------------------------------------------------------

  describe('rotation gives every user a turn', () => {
    it('hands the window on when the turn expires', async () => {
      const store = makeStore();
      const h = makeService(store);

      const turnMinutes = ENRICHMENT_ROTATION.turnMs / 60_000;

      const first = await h.service.takeTurn([USER_A, USER_B, USER_C], insideWindow(0));
      const midTurn = await h.service.takeTurn([USER_A, USER_B, USER_C], insideWindow(turnMinutes - 1));
      const nextTurn = await h.service.takeTurn([USER_A, USER_B, USER_C], insideWindow(turnMinutes + 1));

      expect(first.users).toEqual([USER_A]);
      // Held for the whole turn: a handover every tick would mean nobody ever
      // gets far enough into a sweep for it to be worth starting.
      expect(midTurn.users).toEqual([USER_A]);
      expect(nextTurn.users).toEqual([USER_B]);
    });

    it('comes round to everybody before anybody gets a second turn', async () => {
      const store = makeStore();
      const h = makeService(store);
      const turnMinutes = ENRICHMENT_ROTATION.turnMs / 60_000;

      const served: string[] = [];

      for (let turn = 0; turn < 4; turn += 1) {
        const decision = await h.service.takeTurn(
          [USER_A, USER_B, USER_C],
          insideWindow(turn * (turnMinutes + 1)),
        );

        served.push(...decision.users);
      }

      // Three distinct users in the first three turns, and only then a repeat.
      expect(new Set(served.slice(0, 3)).size).toBe(3);
      expect(served[3]).toBe(served[0]);
    });

    it('releases the turn early when the holder had nothing to do', async () => {
      // The tick only learns a user is drained AFTER probing twelve stages —
      // too late to have chosen somebody else, not too late to make sure the
      // next tick does. Without this, a converged household spends the night
      // holding turns and doing nothing.
      const store = makeStore();
      const h = makeService(store);

      await h.service.takeTurn([USER_A, USER_B], insideWindow(0));
      await h.service.releaseTurn(USER_A, insideWindow(1));

      const next = await h.service.takeTurn([USER_A, USER_B], insideWindow(2));

      expect(next.users).toEqual([USER_B]);
    });

    it('reports how many are waiting, so a stalled rotation is visible', async () => {
      const h = makeService(makeStore());

      const decision = await h.service.takeTurn([USER_A, USER_B, USER_C], insideWindow(0));

      expect(decision.users).toHaveLength(ENRICHMENT_ROTATION.usersPerTurn);
      expect(decision.waiting).toBe(3 - ENRICHMENT_ROTATION.usersPerTurn);
    });
  });

  // -------------------------------------------------------------------------

  describe('the rotation pointer survives a restart', () => {
    it('does not start the rotation over when the process does', async () => {
      // An in-memory pointer looks perfectly fair here and starves the same
      // user every night on a box that is deployed to daily — which is the
      // whole reason the pointer is a row.
      const store = makeStore();
      const turnMinutes = ENRICHMENT_ROTATION.turnMs / 60_000;

      const firstBoot = makeService(store);
      const first = await firstBoot.service.takeTurn([USER_A, USER_B], insideWindow(0));
      expect(first.users).toEqual([USER_A]);

      // The deploy.
      const secondBoot = makeService(store);
      const second = await secondBoot.service.takeTurn([USER_A, USER_B], insideWindow(turnMinutes + 1));

      // Had the pointer been in memory, this would be USER_A again — forever,
      // once a day, with a perfectly green test suite.
      expect(second.users).toEqual([USER_B]);
    });

    it('carries the rotation across nights, so a nightly deploy cannot pin one user', async () => {
      const store = makeStore();

      await makeService(store).service.takeTurn([USER_A, USER_B], insideWindow(0, -2));
      const tonight = await makeService(store).service.takeTurn([USER_A, USER_B], insideWindow(0, -1));

      expect(tonight.users).toEqual([USER_B]);
    });

    it('carries the budget across a restart, so a deploy is not a fresh night', async () => {
      // Restarting the API at 02:00 must not hand the appliance another
      // ninety minutes. `spent_ms` is a column for the same reason the pointer
      // is.
      const store = makeStore();

      const before = makeService(store);
      await before.service.takeTurn([USER_A], insideWindow(0));
      await before.service.takeTurn([USER_A], insideWindow(5));

      const after = makeService(store);
      const status = await after.service.status(insideWindow(6));

      expect(status.spentMs).toBe(5 * 60_000);
    });
  });

  // -------------------------------------------------------------------------

  describe('a late-joining user is not starved', () => {
    it('serves a user who has never been served before anybody takes a second turn', async () => {
      // THE fairness property. A user who signs up this afternoon has no row at
      // all; NULL sorts first, so they are served tonight rather than after
      // every archive that arrived before theirs has drained — which on a real
      // import is weeks.
      const night = await nightKeyFor(insideWindow(0));
      const store = makeStore([
        {
          user_id: USER_A,
          last_served_at: insideWindow(-30),
          turn_started_at: null,
          night,
          spent_ms: 5 * 60_000,
          turns: 4,
        },
        {
          user_id: USER_B,
          last_served_at: insideWindow(-20),
          turn_started_at: null,
          night,
          spent_ms: 5 * 60_000,
          turns: 4,
        },
      ]);

      const h = makeService(store);
      const decision = await h.service.takeTurn([USER_A, USER_B, USER_C], insideWindow(0));

      expect(decision.users).toEqual([USER_C]);
    });

    it('does not let a long-running user hold the window by having a long backlog', async () => {
      // Backlog size is not an input to the rotation, on purpose. A user with
      // 66,579 position rows and a user with four notes get the same turn; the
      // first simply needs more nights. The alternative — serving the biggest
      // backlog first — is the starvation this exists to remove.
      const night = await nightKeyFor(insideWindow(0));
      const store = makeStore([
        {
          user_id: USER_A,
          last_served_at: insideWindow(-1),
          turn_started_at: insideWindow(-1),
          night,
          spent_ms: 60 * 60_000,
          turns: 40,
        },
        {
          user_id: USER_B,
          last_served_at: null,
          turn_started_at: null,
          night: null,
          spent_ms: 0,
          turns: 0,
        },
      ]);

      const turnMinutes = ENRICHMENT_ROTATION.turnMs / 60_000;
      const h = makeService(store);

      const decision = await h.service.takeTurn([USER_A, USER_B], insideWindow(turnMinutes));

      expect(decision.users).toEqual([USER_B]);
    });

    it('breaks a tie the same way every time', async () => {
      // Two users with identical pointers is the first-boot case. Without a
      // declared tiebreak the order would come from the database's row order,
      // and "the rotation is fair" would not be reproducible.
      const runs = await Promise.all(
        [0, 1, 2].map(async () => {
          const h = makeService(makeStore());

          return (await h.service.takeTurn([USER_C, USER_B, USER_A], insideWindow(0))).users;
        }),
      );

      expect(runs[0]).toEqual([USER_A]);
      expect(runs[1]).toEqual(runs[0]);
      expect(runs[2]).toEqual(runs[0]);
    });
  });

  // -------------------------------------------------------------------------

  describe('when something goes wrong', () => {
    it('serves nobody, and does not throw, when the pointer cannot be written', async () => {
      // Serving without recording who was served is unbounded: the same user
      // would be chosen every tick for the rest of the night.
      const h = makeService(makeStore(), { writeError: new Error('deadlock detected') });

      const decision = await h.service.takeTurn([USER_A, USER_B], insideWindow(0));

      expect(decision.users).toEqual([]);
      expect(h.logger.error).toHaveBeenCalled();
    });

    it('serves nobody, and does not throw, when the window cannot be read', async () => {
      const h = makeService(makeStore(), { readError: new Error('connection terminated unexpectedly') });

      await expect(h.service.takeTurn([USER_A], insideWindow(0))).resolves.toEqual(
        expect.objectContaining({ users: [] }),
      );
      expect(h.logger.error).toHaveBeenCalled();
    });

    it('does not throw when a turn cannot be released', async () => {
      // The turn expires on its own after `turnMs`, so the worst case is a
      // slower rotation, never a stuck one.
      const h = makeService(makeStore(), { writeError: new Error('nope') });

      await expect(h.service.releaseTurn(USER_A, insideWindow(0))).resolves.toBeUndefined();
    });

    it('takes no turn when there are no candidates', async () => {
      const h = makeService(makeStore());

      const decision = await h.service.takeTurn([], insideWindow(0));

      expect(decision.users).toEqual([]);
      expect(decision.window.open).toBe(true);
      expect(h.store.size).toBe(0);
    });

    it('serves a user once even if the caller passes them twice', async () => {
      const h = makeService(makeStore());

      const decision = await h.service.takeTurn([USER_A, USER_A], insideWindow(0));

      expect(decision.users).toEqual([USER_A]);
    });
  });

  // -------------------------------------------------------------------------

  describe('the wall clock', () => {
    it('reads a zone that is not the host, without a date library', () => {
      const at = new Date('2026-06-15T12:00:00Z');

      expect(wallClockIn(at, 'UTC').hour).toBe(12);
      expect(wallClockIn(at, 'Asia/Tokyo').hour).toBe(21);
      // Midnight is 0, never 24 — `hour12: false` produces 24 in some ICU
      // versions, which would put the window's start on the wrong day.
      expect(wallClockIn(new Date('2026-06-15T00:00:00Z'), 'UTC').hour).toBe(0);
    });

    it('round-trips a wall time through a zone', () => {
      const zones = ['UTC', 'America/Los_Angeles', 'Asia/Kolkata', 'Australia/Sydney'];

      for (const zone of zones) {
        const instant = instantOfWallClock({ year: 2026, month: 3, day: 15, hour: 1, minute: 30 }, zone);
        const wall = wallClockIn(instant, zone);

        expect({ hour: wall.hour, minute: wall.minute }).toEqual({ hour: 1, minute: 30 });
      }
    });

    it('is not fooled by a daylight-saving transition', () => {
      // 01:00 is 23 hours after the previous 01:00 on the day the clocks go
      // forward. Adding 24 hours to an instant is wrong twice a year, in the
      // direction of running the window while somebody is awake.
      const zone = 'America/New_York';
      const before = instantOfWallClock({ year: 2026, month: 3, day: 7, hour: 1, minute: 0 }, zone);
      const after = instantOfWallClock({ year: 2026, month: 3, day: 9, hour: 1, minute: 0 }, zone);

      expect(wallClockIn(before, zone).hour).toBe(1);
      expect(wallClockIn(after, zone).hour).toBe(1);
      expect(after.getTime() - before.getTime()).toBe(47 * 60 * 60 * 1000);
    });
  });
});

/** The `night` key the service would compute for an instant. */
async function nightKeyFor(at: Date): Promise<string> {
  const h = makeService(makeStore());

  return (await h.service.status(at)).night;
}

// ---------------------------------------------------------------------------
// Half two: the statements, against real Postgres
// ---------------------------------------------------------------------------

describeWithDatabase('EnrichmentWindowService (real Postgres)', () => {
  let dataSource: DataSource;
  let runner: QueryRunner;
  let service: EnrichmentWindowService;

  // Unique per run (so nothing can collide with a migrated appliance's real
  // rows) but ORDERED, because the rotation's declared tiebreak is the user id
  // and a test that cannot predict the tiebreak cannot assert the rotation.
  const seed = randomUUID().slice(0, 23);
  const userA = `${seed}-00000000000a`;
  const userB = `${seed}-00000000000b`;

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
  });

  afterAll(async () => {
    await dataSource?.destroy();
  });

  beforeEach(async () => {
    runner = dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();

    // The migration ships in the same change as this file, so on a database
    // where it has not been applied yet the table is created HERE — inside the
    // transaction that is always rolled back. On a migrated database this is a
    // no-op and the real DDL is what gets exercised. Either way the live
    // appliance is untouched.
    await runner.query(`CREATE TABLE IF NOT EXISTS ${PIPELINE_TURNS_TABLE} (
        user_id         UUID PRIMARY KEY,
        last_served_at  TIMESTAMPTZ,
        turn_started_at TIMESTAMPTZ,
        night           DATE,
        spent_ms        BIGINT NOT NULL DEFAULT 0 CHECK (spent_ms >= 0),
        turns           BIGINT NOT NULL DEFAULT 0 CHECK (turns >= 0),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT now())`);

    service = new EnrichmentWindowService(
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
    // ALWAYS a rollback. Not one synthetic turn is ever committed, so the live
    // appliance's own rotation cannot be perturbed by running this suite.
    await runner.rollbackTransaction();
    await runner.release();
  });

  /** The stored row for a user, as Postgres holds it. */
  async function storedRow(userId: string): Promise<Record<string, unknown> | undefined> {
    const rows = await runner.query(
      `SELECT user_id::text, last_served_at, turn_started_at, night::text, spent_ms, turns
         FROM ${PIPELINE_TURNS_TABLE} WHERE user_id = $1::uuid`,
      [userId],
    );

    return rows[0];
  }

  it('accumulates a night’s spend and RESETS it on the next night', async () => {
    // The `ON CONFLICT` arithmetic, which is the one piece of logic that lives
    // entirely in SQL. A mock agrees with whatever the statement asks it.
    await service.takeTurn([userA], insideWindow(0, -1));
    await service.takeTurn([userA], insideWindow(5, -1));
    await service.takeTurn([userA], insideWindow(10, -1));

    const lastNight = await storedRow(userA);
    expect(Number(lastNight?.spent_ms)).toBe(10 * 60_000);

    await service.takeTurn([userA], insideWindow(0));
    await service.takeTurn([userA], insideWindow(5));

    const tonight = await storedRow(userA);
    // Reset, not accumulated — which is what makes "tonight's spend" a
    // `sum ... WHERE night = $1` with no history to reap.
    expect(Number(tonight?.spent_ms)).toBe(5 * 60_000);
  });

  it('reads a bigint sum back as a number, not a string', async () => {
    await service.takeTurn([userA], insideWindow(0));
    await service.takeTurn([userA], insideWindow(5));

    const status = await service.status(insideWindow(6));

    // `'300000' < 5400000` is a STRING comparison, and would silently decide
    // the budget was spent (or not) at random.
    expect(typeof status.spentMs).toBe('number');
    expect(status.spentMs).toBe(5 * 60_000);
    expect(status.remainingMs).toBe(
      Math.min(ENRICHMENT_WINDOW.budgetMs - 5 * 60_000, ENRICHMENT_WINDOW.durationMs - 6 * 60_000),
    );
  });

  it('round-trips the night label through a Postgres date', async () => {
    // A `date` column comes back as a Date at LOCAL midnight, so reading its
    // UTC components would name the previous day west of Greenwich — and the
    // turn would then look like it belonged to a night that had not happened.
    const at = insideWindow(0);
    await service.takeTurn([userA], at);

    const status = await service.status(at);
    const row = await storedRow(userA);

    expect(row?.night).toBe(status.night);

    const resumed = await service.takeTurn([userA], insideWindow(2));
    expect(resumed.users).toEqual([userA]);
    // Same turn, not a new one: the night matched, so `turns` did not move.
    expect(Number((await storedRow(userA))?.turns)).toBe(1);
  });

  it('rotates across users through the real upsert', async () => {
    const turnMinutes = ENRICHMENT_ROTATION.turnMs / 60_000;

    const first = await service.takeTurn([userA, userB], insideWindow(0));
    const second = await service.takeTurn([userA, userB], insideWindow(turnMinutes + 1));
    const third = await service.takeTurn([userA, userB], insideWindow(2 * turnMinutes + 2));

    expect(new Set([...first.users, ...second.users]).size).toBe(2);
    expect(third.users).toEqual(first.users);
  });

  it('releases a turn without losing the pointer', async () => {
    await service.takeTurn([userA, userB], insideWindow(0));
    await service.releaseTurn(userA, insideWindow(1));

    const row = await storedRow(userA);

    expect(row?.turn_started_at).toBeNull();
    // Released, not un-served: the pointer moved, so the released user goes to
    // the BACK of the rotation rather than straight back to the front.
    expect(row?.last_served_at).not.toBeNull();

    expect((await service.takeTurn([userA, userB], insideWindow(2))).users).toEqual([userB]);
  });

  it('leaves a half-finished sweep exactly where it stopped', async () => {
    // THE reason a small nightly budget is safe, asserted against the real
    // rows. A run mid-import holds a shard whose `cursor` is the keyset
    // position; the window shutting must leave the run ACTIVE and the cursor
    // UNMOVED, so tomorrow resumes from there instead of re-scanning a
    // 324,044-row corpus from the top every night.
    const [run] = await runner.query(
      `INSERT INTO ci.pipeline_runs (user_id, kind, desired_state, status, detail)
       VALUES ($1::uuid, 'continuous', 'running', 'running', '{}'::jsonb)
       RETURNING id`,
      [userA],
    );

    const cursor = '00000000-0000-4000-8000-000000004242';

    await runner.query(
      `INSERT INTO ci.pipeline_shards (run_id, stage, shard_key, "cursor", status)
       VALUES ($1::uuid, 'enrich.media_dimensions', 'file', $2, 'pending')`,
      [run.id, cursor],
    );

    // A night's worth of ticks, then the window shuts under a sweep that is
    // half-way through its corpus.
    await service.takeTurn([userA, userB], insideWindow(0));
    await service.takeTurn([userA, userB], insideWindow(5));
    await service.takeTurn([userA, userB], afterWindow());
    await service.releaseTurn(userA, afterWindow());

    const [shard] = await runner.query(
      `SELECT s."cursor", s.status, r.finished_at
         FROM ci.pipeline_shards s
         JOIN ci.pipeline_runs r ON r.id = s.run_id
        WHERE s.run_id = $1::uuid`,
      [run.id],
    );

    expect(shard.cursor).toBe(cursor);
    expect(shard.status).toBe('pending');
    // Still active: the window stops work being STARTED, it does not finalize
    // anything. A finalized run would strand its shards and restart the corpus.
    expect(shard.finished_at).toBeNull();
  });
});
