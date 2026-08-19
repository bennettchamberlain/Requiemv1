import {
  MAX_ATTEMPTS_BEFORE_QUARANTINE,
  RETRY_BACKOFF_BASE_SECONDS,
  RETRY_BACKOFF_MAX_SECONDS,
  TRANSIENT_FAILURE_REASONS,
  TRANSIENT_RETRY_BACKOFF_BASE_SECONDS,
  isTransientFailureReason,
} from '../constants';
import { PipelineStateService } from '../services/PipelineStateService';
import type { StageResult } from '../types';

/**
 * THE RETRY BUDGET — who is allowed to spend it, and who is not.
 *
 * ## The defect this file exists to keep dead
 *
 * `MAX_ATTEMPTS_BEFORE_QUARANTINE` is 5 and the backoff starts at 60 s and
 * doubles, so a row's whole attempt budget is spent 60 + 120 + 240 + 480 = 900
 * seconds — FIFTEEN MINUTES — after its first failure. Quarantine is terminal:
 * `selectStale` reclaims only `failed` rows whose gate is due, so nothing looks
 * at a quarantined row again short of a stage-version bump, which on a metered
 * stage means re-billing the whole corpus to retry a handful of rows.
 *
 * That budget is correct for a poison record and catastrophic for an outage,
 * and until `TRANSIENT_FAILURE_REASONS` existed the ledger could not tell them
 * apart. Measured on a real appliance: a brief reverse-geocode provider outage
 * left 12,237 `ci.position` rows — 19 % of that corpus — `quarantined` with
 * `reason = 'provider_unavailable'`. None of them could ever get an address,
 * become a Location entity, or appear on the map again.
 *
 * ## How this file tests it
 *
 * There is no Postgres here. The fake `DataSource` recognises `claim()`,
 * `complete()` and `fail()` by their statement shape and then EVALUATES each
 * one's retry policy in TypeScript from the BOUND PARAMETERS, in the contract's
 * order — the same technique `theOneRule.spec.ts` uses for the sweep, and for
 * the same reason: the assertions then cover the policy's SEMANTICS (which
 * status, which counter, which gate, after which sequence of outcomes) rather
 * than a SQL string. A change to the parameter list is a contract violation and
 * is reported as one, because a silent re-ordering is exactly the change that
 * would make the policy quietly wrong.
 *
 * What this deliberately does NOT prove is that the SQL says what the evaluator
 * says — the double is written from the same understanding as the code. That is
 * `pipeline.integration.spec.ts`'s job, against a real database.
 */

/* ===================================================================== *
 * Fixture
 * ===================================================================== */

const USER = '00000000-0000-4000-8000-00000000aaaa';
const ENTITY_TYPE = 'position';
const STAGE_ID = 'enrich.position_reverse';
const STAGE_VERSION = 3;

/** The reason the 12,237 rows carried. */
const TRANSIENT_REASON = 'provider_unavailable';
/** A failure that IS the row's fault, and should still quarantine. */
const PERMANENT_REASON = 'address_write_failed';

function srcId(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

function makeStage(version = STAGE_VERSION) {
  return {
    id: STAGE_ID,
    version,
    queue: 'pipeline-enrich',
    entityTypes: [ENTITY_TYPE],
    source: {
      schema: 'ci',
      table: 'position',
      idColumn: 'id',
      userColumn: 'user_id',
    },
    run: jest.fn(async () => new Map()),
  };
}

/* ===================================================================== *
 * The fake DataSource: the ledger's retry policy, evaluated
 * ===================================================================== */

interface LedgerRow {
  stageVersion: number;
  status: string;
  reason: string | null;
  /** Attempts that cost the row something. Quarantine is measured against this. */
  attempts: number;
  /** Consecutive failures blamed on the world. Never counted toward quarantine. */
  transientAttempts: number;
  nextAttemptAt: Date | null;
  updatedAt: Date;
}

function cap(seconds: number, maxSeconds: number): number {
  return Math.min(seconds, maxSeconds);
}

function gate(seconds: number): Date {
  return new Date(Date.now() + seconds * 1000);
}

function makeHarness() {
  const ledger = new Map<string, LedgerRow>();

  /**
   * `claim()`: charge an attempt and mark the row running.
   *
   * $1 entity_type, $2 stage, $3 user_id, $4 ids[], $5 stage_version,
   * $6 lease seconds.
   */
  function evaluateClaim(params: unknown[]): Array<{ entity_id: string }> {
    if (params.length !== 6) {
      throw new Error(
        `claim() binds exactly six parameters ($1 entity_type, $2 stage, $3 user_id, $4 ids, ` +
          `$5 stage_version, $6 lease seconds); got ${params.length}: ${JSON.stringify(params)}`,
      );
    }

    const [, , , ids, stageVersion, leaseSeconds] = params as [
      string,
      string,
      string | null,
      string[],
      number,
      number,
    ];

    const claimed: Array<{ entity_id: string }> = [];

    for (const entityId of ids) {
      const row = ledger.get(entityId);

      if (row === undefined) {
        // The load-bearing zero: a claim never stamps the stage version.
        ledger.set(entityId, {
          stageVersion: 0,
          status: 'running',
          reason: null,
          attempts: 1,
          transientAttempts: 0,
          nextAttemptAt: null,
          updatedAt: new Date(),
        });
        claimed.push({ entity_id: entityId });

        continue;
      }

      const leaseExpired = row.updatedAt.getTime() < Date.now() - leaseSeconds * 1000;
      const notHeld = row.status !== 'running' || leaseExpired;
      const notTerminalAtVersion =
        row.stageVersion < stageVersion || ['pending', 'running', 'failed'].includes(row.status);

      if (!notHeld || !notTerminalAtVersion) {
        continue;
      }

      row.status = 'running';
      row.attempts += 1;
      row.nextAttemptAt = null;
      row.updatedAt = new Date();
      claimed.push({ entity_id: entityId });
    }

    return claimed;
  }

  /**
   * `complete()`: one terminal outcome per row, with the retry policy applied.
   *
   * $1 entity_type, $2 stage, $3 stage_version, $4 permanent backoff base,
   * $5 backoff cap, $6 ids[], $7 statuses[], $8 reasons[], $9 transient flags[],
   * $10 transient backoff base, $11 max attempts.
   */
  function evaluateComplete(params: unknown[]): Array<{ status: string }> {
    if (params.length !== 11) {
      throw new Error(
        `complete() binds exactly eleven parameters ($1 entity_type, $2 stage, $3 stage_version, ` +
          `$4 backoff base, $5 backoff cap, $6 ids, $7 statuses, $8 reasons, $9 transient flags, ` +
          `$10 transient backoff base, $11 max attempts); got ${params.length}. A failure class that ` +
          `is not bound cannot be honoured, which is the defect this file guards.`,
      );
    }

    const [
      ,
      ,
      version,
      baseSeconds,
      maxSeconds,
      ids,
      statuses,
      reasons,
      transient,
      transientBase,
      maxAttempts,
    ] = params as [
      string,
      string,
      number,
      number,
      number,
      string[],
      string[],
      Array<string | null>,
      boolean[],
      number,
      number,
    ];

    return ids.map((entityId, index) => {
      const status = statuses[index];
      const isTransientFailure = status === 'failed' && transient[index] === true;
      const existing = ledger.get(entityId);

      if (existing === undefined) {
        const row: LedgerRow = {
          stageVersion: version,
          status,
          reason: reasons[index],
          attempts: isTransientFailure ? 0 : 1,
          transientAttempts: isTransientFailure ? 1 : 0,
          nextAttemptAt:
            status === 'failed'
              ? gate(cap(isTransientFailure ? transientBase : baseSeconds, maxSeconds))
              : null,
          updatedAt: new Date(),
        };

        ledger.set(entityId, row);

        return { status: row.status };
      }

      const quarantines = status === 'failed' && !isTransientFailure && existing.attempts >= maxAttempts;

      const next: LedgerRow = {
        stageVersion: version,
        status: quarantines ? 'quarantined' : status,
        reason: reasons[index],
        // The refund.
        attempts: isTransientFailure ? Math.max(existing.attempts - 1, 0) : existing.attempts,
        transientAttempts: isTransientFailure ? existing.transientAttempts + 1 : 0,
        nextAttemptAt: isTransientFailure
          ? gate(cap(transientBase * 2 ** existing.transientAttempts, maxSeconds))
          : status === 'failed' && existing.attempts < maxAttempts
            ? gate(cap(baseSeconds * 2 ** Math.max(existing.attempts - 1, 0), maxSeconds))
            : null,
        updatedAt: new Date(),
      };

      ledger.set(entityId, next);

      return { status: next.status };
    });
  }

  /**
   * `fail()`: one shared reason for a whole slice.
   *
   * $1 entity_type, $2 stage, $3 stage_version, $4 reason, $5 backoff base,
   * $6 backoff cap, $7 ids[], $8 max attempts, $9 transient, $10 transient base.
   */
  function evaluateFail(params: unknown[]): Array<{ status: string }> {
    if (params.length !== 10) {
      throw new Error(
        `fail() binds exactly ten parameters ($1 entity_type, $2 stage, $3 stage_version, $4 reason, ` +
          `$5 backoff base, $6 backoff cap, $7 ids, $8 max attempts, $9 transient, ` +
          `$10 transient backoff base); got ${params.length}: ${JSON.stringify(params)}`,
      );
    }

    const [, , version, reason, baseSeconds, maxSeconds, ids, maxAttempts, transient, transientBase] =
      params as [string, string, number, string, number, number, string[], number, boolean, number];

    return ids.map((entityId) => {
      const existing = ledger.get(entityId);

      if (existing === undefined) {
        const row: LedgerRow = {
          stageVersion: version,
          status: 'failed',
          reason,
          attempts: transient ? 0 : 1,
          transientAttempts: transient ? 1 : 0,
          nextAttemptAt: gate(cap(transient ? transientBase : baseSeconds, maxSeconds)),
          updatedAt: new Date(),
        };

        ledger.set(entityId, row);

        return { status: row.status };
      }

      const quarantines = !transient && existing.attempts >= maxAttempts;

      const next: LedgerRow = {
        stageVersion: version,
        status: quarantines ? 'quarantined' : 'failed',
        reason,
        attempts: transient ? Math.max(existing.attempts - 1, 0) : existing.attempts,
        transientAttempts: transient ? existing.transientAttempts + 1 : 0,
        nextAttemptAt: transient
          ? gate(cap(transientBase * 2 ** existing.transientAttempts, maxSeconds))
          : quarantines
            ? null
            : gate(cap(baseSeconds * 2 ** Math.max(existing.attempts - 1, 0), maxSeconds)),
        updatedAt: new Date(),
      };

      ledger.set(entityId, next);

      return { status: next.status };
    });
  }

  const query = jest.fn(async (raw: string, params: unknown[] = []) => {
    const sql = raw.replace(/\s+/g, ' ').trim();

    if (/AS t\(entity_id, status, reason/i.test(sql)) {
      return evaluateComplete(params);
    }

    if (/'running'/.test(sql)) {
      return evaluateClaim(params);
    }

    if (/'failed', \$4/.test(sql)) {
      return evaluateFail(params);
    }

    throw new Error(`Retry-budget simulator saw a statement it does not model: ${sql}`);
  });

  const manager = { query };
  const dataSource = {
    query,
    manager,
    getRepository: jest.fn(() => ({ manager })),
    transaction: jest.fn(async (a: unknown, b?: unknown) =>
      typeof a === 'function'
        ? (a as (m: typeof manager) => Promise<unknown>)(manager)
        : (b as (m: typeof manager) => Promise<unknown>)(manager),
    ),
  };

  const logger = {
    setContext: jest.fn(),
    log: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };

  const service = new PipelineStateService(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    dataSource as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    logger as any,
  );

  /** One full worker round trip over a single entity: claim, then record. */
  async function attempt(entityId: string, result: StageResult): Promise<void> {
    await service.claim(makeStage() as never, ENTITY_TYPE, [entityId], USER);
    await service.complete(makeStage() as never, ENTITY_TYPE, new Map([[entityId, result]]));
  }

  /** The same, for the slice-level path where the stage threw. */
  async function attemptSliceFailure(entityId: string, reason: string): Promise<void> {
    await service.claim(makeStage() as never, ENTITY_TYPE, [entityId], USER);
    await service.fail(makeStage() as never, ENTITY_TYPE, [entityId], reason);
  }

  function row(entityId: string): LedgerRow {
    const found = ledger.get(entityId);

    if (found === undefined) {
      throw new Error(`No ledger row for ${entityId}`);
    }

    return found;
  }

  /** The gate the row is currently sitting behind, in seconds from now. */
  function gateSeconds(entityId: string): number | null {
    const at = row(entityId).nextAttemptAt;

    return at === null ? null : Math.round((at.getTime() - Date.now()) / 1000);
  }

  return { service, attempt, attemptSliceFailure, row, gateSeconds };
}

/* ===================================================================== *
 * The classifier
 * ===================================================================== */

describe('isTransientFailureReason', () => {
  it('names the provider outage reasons the enrich and embed stages actually write', () => {
    expect(isTransientFailureReason('provider_unavailable')).toBe(true);
    expect(isTransientFailureReason('ollama_unreachable')).toBe(true);
  });

  it('leaves a failure that is the ROW’s fault permanent, so quarantine still works', () => {
    // Every one of these is reachable only when this specific entity is the
    // problem, and retrying it forever is the invisible self-renewing workload
    // the ledger was built to delete.
    for (const reason of [
      'address_write_failed',
      'coordinate_write_failed',
      'embedding_write_failed',
      'empty_embedding_vector',
      'provider_status_unrecognized',
      'stage_returned_no_result',
    ]) {
      expect(isTransientFailureReason(reason)).toBe(false);
    }
  });

  it('treats an absent reason as permanent rather than as "retry forever"', () => {
    expect(isTransientFailureReason(null)).toBe(false);
    expect(isTransientFailureReason(undefined)).toBe(false);
    expect(isTransientFailureReason('')).toBe(false);
  });

  it('does not pattern-match, so a stage_threw message cannot smuggle itself in', () => {
    // Classifying an arbitrary error message would be a guess. The operator's
    // remedy for these is `releaseQuarantined()`, which is a human's judgement
    // rather than a substring.
    expect(isTransientFailureReason('stage_threw: connect ECONNREFUSED 127.0.0.1:11434')).toBe(false);
    expect(isTransientFailureReason('provider_unavailable_ish')).toBe(false);
  });
});

/* ===================================================================== *
 * The permanent path, which must not change
 * ===================================================================== */

describe('a row that can never succeed', () => {
  it('quarantines on exactly the MAX_ATTEMPTS_BEFORE_QUARANTINE-th attempt', async () => {
    const h = makeHarness();
    const id = srcId(1);

    for (let n = 0; n < MAX_ATTEMPTS_BEFORE_QUARANTINE - 1; n += 1) {
      await h.attempt(id, { outcome: 'failed', reason: PERMANENT_REASON });
      expect(h.row(id).status).toBe('failed');
    }

    // `claim()` charges the attempt before the stage runs, so the fifth attempt
    // is the one whose `complete()` sees `attempts >= 5` already stored.
    await h.attempt(id, { outcome: 'failed', reason: PERMANENT_REASON });

    expect(h.row(id).status).toBe('quarantined');
    expect(h.row(id).attempts).toBe(MAX_ATTEMPTS_BEFORE_QUARANTINE);
    // A quarantined row carries no gate: `selectStale` reclaims only `failed`
    // rows whose gate is due, so this is what stops a poison record costing a
    // worker slot every hour forever.
    expect(h.row(id).nextAttemptAt).toBeNull();
  });

  it('doubles its gate from the 60 s base, capped', async () => {
    const h = makeHarness();
    const id = srcId(2);

    const observed: number[] = [];

    for (let n = 0; n < 4; n += 1) {
      await h.attempt(id, { outcome: 'failed', reason: PERMANENT_REASON });
      observed.push(h.gateSeconds(id) as number);
    }

    expect(observed).toEqual([
      RETRY_BACKOFF_BASE_SECONDS,
      RETRY_BACKOFF_BASE_SECONDS * 2,
      RETRY_BACKOFF_BASE_SECONDS * 4,
      RETRY_BACKOFF_BASE_SECONDS * 8,
    ]);

    // 60 + 120 + 240 + 480 = 900 s. THIS is why a fifteen-minute outage used to
    // be fatal: the whole budget is spent inside it.
    expect(observed.reduce((sum, seconds) => sum + seconds, 0)).toBe(900);
  });
});

/* ===================================================================== *
 * The transient path — the defect
 * ===================================================================== */

describe('a provider outage', () => {
  it('never quarantines, however long it lasts', async () => {
    const h = makeHarness();
    const id = srcId(3);

    // Twenty attempts is four times the budget: under the old policy this row
    // was terminally parked after five, about fifteen minutes in.
    for (let n = 0; n < 20; n += 1) {
      await h.attempt(id, { outcome: 'failed', reason: TRANSIENT_REASON });

      expect(h.row(id).status).toBe('failed');
      expect(h.row(id).nextAttemptAt).not.toBeNull();
    }

    expect(h.row(id).transientAttempts).toBe(20);
  });

  it('refunds the attempt it was charged, so the budget is exactly where it started', async () => {
    const h = makeHarness();
    const id = srcId(4);

    for (let n = 0; n < 20; n += 1) {
      await h.attempt(id, { outcome: 'failed', reason: TRANSIENT_REASON });
    }

    // claim() charged twenty attempts; every one of them came back.
    expect(h.row(id).attempts).toBe(0);
  });

  it('backs off far enough to outlast an outage, from 15 minutes to the 6 hour cap', async () => {
    const h = makeHarness();
    const id = srcId(5);

    const observed: number[] = [];

    for (let n = 0; n < 8; n += 1) {
      await h.attempt(id, { outcome: 'failed', reason: TRANSIENT_REASON });
      observed.push(h.gateSeconds(id) as number);
    }

    expect(observed).toEqual([
      TRANSIENT_RETRY_BACKOFF_BASE_SECONDS, //      15 m
      TRANSIENT_RETRY_BACKOFF_BASE_SECONDS * 2, //  30 m
      TRANSIENT_RETRY_BACKOFF_BASE_SECONDS * 4, //   1 h
      TRANSIENT_RETRY_BACKOFF_BASE_SECONDS * 8, //   2 h
      TRANSIENT_RETRY_BACKOFF_BASE_SECONDS * 16, //  4 h
      RETRY_BACKOFF_MAX_SECONDS, //                  6 h — capped from here on
      RETRY_BACKOFF_MAX_SECONDS,
      RETRY_BACKOFF_MAX_SECONDS,
    ]);

    // Six attempts absorb over eight hours of outage. The permanent schedule
    // spends its entire budget in fifteen minutes.
    expect(observed.slice(0, 6).reduce((sum, seconds) => sum + seconds, 0)).toBeGreaterThan(8 * 60 * 60);
  });

  it('leaves the full permanent budget available once the provider comes back', async () => {
    // THE REGRESSION TEST. A transient class that merely delays quarantine still
    // burns the budget meant for poison records: the first REAL failure after an
    // outage would then quarantine on attempt one.
    const h = makeHarness();
    const id = srcId(6);

    for (let n = 0; n < 12; n += 1) {
      await h.attempt(id, { outcome: 'failed', reason: TRANSIENT_REASON });
    }

    for (let n = 0; n < MAX_ATTEMPTS_BEFORE_QUARANTINE - 1; n += 1) {
      await h.attempt(id, { outcome: 'failed', reason: PERMANENT_REASON });

      expect(h.row(id).status).toBe('failed');
    }

    await h.attempt(id, { outcome: 'failed', reason: PERMANENT_REASON });

    expect(h.row(id).status).toBe('quarantined');
  });

  it('starts the next outage at 15 minutes again once the row succeeds', async () => {
    const h = makeHarness();
    const id = srcId(7);

    for (let n = 0; n < 6; n += 1) {
      await h.attempt(id, { outcome: 'failed', reason: TRANSIENT_REASON });
    }

    expect(h.gateSeconds(id)).toBe(RETRY_BACKOFF_MAX_SECONDS);

    await h.attempt(id, { outcome: 'done' });

    expect(h.row(id).status).toBe('done');
    expect(h.row(id).transientAttempts).toBe(0);

    await h.attempt(id, { outcome: 'failed', reason: TRANSIENT_REASON });

    // Not the 6-hour cap it left off at: an episode that ended is over.
    expect(h.gateSeconds(id)).toBe(TRANSIENT_RETRY_BACKOFF_BASE_SECONDS);
  });

  it('applies the same rule to the slice-level fail() path', async () => {
    const h = makeHarness();
    const id = srcId(8);

    for (let n = 0; n < 10; n += 1) {
      await h.attemptSliceFailure(id, TRANSIENT_REASON);
    }

    expect(h.row(id).status).toBe('failed');
    expect(h.row(id).attempts).toBe(0);
    expect(h.row(id).transientAttempts).toBe(10);
  });

  it('still quarantines a slice that keeps throwing, because stage_threw is not classifiable', async () => {
    const h = makeHarness();
    const id = srcId(9);

    for (let n = 0; n < MAX_ATTEMPTS_BEFORE_QUARANTINE + 1; n += 1) {
      await h.attemptSliceFailure(id, 'stage_threw: probe host unreachable');
    }

    expect(h.row(id).status).toBe('quarantined');
  });
});

/* ===================================================================== *
 * The classifier and the ledger, wired together
 * ===================================================================== */

describe('the ledger classifies by reason, not by outcome', () => {
  it.each([...TRANSIENT_FAILURE_REASONS])('treats %s as transient end to end', async (reason) => {
    const h = makeHarness();
    const id = srcId(10);

    for (let n = 0; n < MAX_ATTEMPTS_BEFORE_QUARANTINE + 3; n += 1) {
      await h.attempt(id, { outcome: 'failed', reason });
    }

    expect(h.row(id).status).toBe('failed');
    expect(h.row(id).attempts).toBe(0);
  });

  it('does not refund a SKIP that happens to carry a transient-sounding reason', async () => {
    // Only a `failed` outcome has a budget to refund. A skip is terminal at the
    // current version either way, and giving it a counter would be noise.
    const h = makeHarness();
    const id = srcId(11);

    await h.attempt(id, { outcome: 'skipped', reason: TRANSIENT_REASON });

    expect(h.row(id).status).toBe('skipped');
    expect(h.row(id).attempts).toBe(1);
    expect(h.row(id).transientAttempts).toBe(0);
    expect(h.row(id).nextAttemptAt).toBeNull();
  });

  it('mixes classes correctly within one slice', async () => {
    const h = makeHarness();
    const permanent = srcId(12);
    const transientId = srcId(13);

    // Both rows arrive at their fifth attempt together; only one of them has
    // spent anything, so only one of them quarantines.
    for (let n = 0; n < MAX_ATTEMPTS_BEFORE_QUARANTINE + 1; n += 1) {
      await h.service.claim(makeStage() as never, ENTITY_TYPE, [permanent, transientId], USER);
      await h.service.complete(
        makeStage() as never,
        ENTITY_TYPE,
        new Map<string, StageResult>([
          [permanent, { outcome: 'failed', reason: PERMANENT_REASON }],
          [transientId, { outcome: 'failed', reason: TRANSIENT_REASON }],
        ]),
      );
    }

    expect(h.row(permanent).status).toBe('quarantined');
    expect(h.row(transientId).status).toBe('failed');
  });
});
