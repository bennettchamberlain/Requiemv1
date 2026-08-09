import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { DataSource } from 'typeorm';

import type { UserServiceContext } from '@ci/common/context';
import type { LoggerService } from '@ci/common/logging';
import { BACKFILL_JOB_PRIORITY, type EventService } from '@ci/domains/events';

import { DEAD_LETTER_QUEUE, STAGE_ID_LIST } from '../../constants';
import { stageVersion } from '../../versions';
import { MAX_SHARDS_PER_RUN, PipelineRunService } from '../PipelineRunService';

/**
 * The run lifecycle and the operator's read/control plane.
 *
 * What is worth testing here is NOT "the service issues a query". It is the
 * three properties that, if wrong, wedge an appliance in a way nobody can see:
 *
 * 1. **A second run for a user is a normal outcome, not a 500.**
 *    `pipeline_runs_active_uniq` makes concurrent runs a database error on
 *    purpose — an operator double-clicking "reprocess" gets SQLSTATE 23505
 *    instead of two workers racing over the same rows. The service has to read
 *    that as "one is already going" and hand back the run that IS going.
 *
 * 2. **Finalization always stamps `finished_at`, including on cancel.** That
 *    column IS the index's predicate, so a terminal run that never gets it stays
 *    "active" forever and its user can never start another run — silently, with
 *    no error anywhere and no repair short of SQL. Cancel is the case most
 *    likely to get this wrong, because it feels like a different kind of ending.
 *
 * 3. **A replay either re-emits the payload verbatim or leaves `replayed_at`
 *    alone.** A letter marked replayed that was never re-emitted is worse than
 *    one that was never touched: the payload is frequently the only surviving
 *    copy of the record, and the flag is what removes it from the replay queue.
 *
 * No Postgres. The `DataSource` double records every statement and answers from
 * a per-test responder, in the style of `PipelineStateService.spec.ts` — the
 * semantics under test are in this file's control flow and in which parameters
 * it binds, both of which a real database would only obscure.
 */

const USER = '00000000-0000-4000-8000-0000000000aa';
const OTHER_USER = '00000000-0000-4000-8000-0000000000bb';
const RUN_ID = '00000000-0000-7000-8000-0000000000c1';
const LETTER_ID = '00000000-0000-7000-8000-0000000000d1';

const CTX: UserServiceContext = { userId: USER };

/** One statement the service issued, whitespace-collapsed for matching. */
interface Statement {
  sql: string;
  params: unknown[];
}

/**
 * Answers a statement. Returning rows resolves the query; throwing rejects it,
 * which is how the unique-violation paths are driven.
 */
type Responder = (statement: Statement, nth: number) => unknown[];

interface Harness {
  service: PipelineRunService;
  statements: Statement[];
  send: jest.Mock;
  logger: { warn: jest.Mock; error: jest.Mock; log: jest.Mock; debug: jest.Mock };
  /** Statements whose collapsed SQL matches. */
  matching(pattern: RegExp): Statement[];
}

function makeHarness(respond: Responder = () => [], sendResult: string[] = ['job-1']): Harness {
  const statements: Statement[] = [];

  const query = jest.fn(async (raw: string, params: unknown[] = []) => {
    const statement: Statement = { sql: raw.replace(/\s+/g, ' ').trim(), params };

    statements.push(statement);

    return respond(statement, statements.length - 1);
  });

  const dataSource = { query } as unknown as DataSource;

  const send = jest.fn(async () => sendResult);
  const eventService = { send } as unknown as EventService;

  const logger = {
    setContext: jest.fn(),
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };

  return {
    service: new PipelineRunService(dataSource, eventService, logger as unknown as LoggerService),
    statements,
    send,
    logger,
    matching: (pattern) => statements.filter((statement) => pattern.test(statement.sql)),
  };
}

/** A `ci.pipeline_runs` row as the projection returns it. */
function runRow(overrides: Record<string, unknown> = {}) {
  return {
    id: RUN_ID,
    kind: 'reprocess',
    desired_state: 'running',
    status: 'queued',
    started_at: new Date('2026-08-09T10:00:00Z'),
    finished_at: null,
    detail: {},
    shard_count: 0,
    shards_by_status: null,
    ...overrides,
  };
}

/** The error node-postgres raises when `pipeline_runs_active_uniq` is violated. */
function activeRunConflict(constraint: string | undefined = 'pipeline_runs_active_uniq') {
  return Object.assign(new Error('duplicate key value violates unique constraint'), {
    code: '23505',
    constraint,
  });
}

// ---------------------------------------------------------------------------
// startRun — the 23505 that is not an error
// ---------------------------------------------------------------------------

describe('PipelineRunService.startRun', () => {
  it('inserts a run and reports it as created', async () => {
    const harness = makeHarness(() => [runRow()]);

    const result = await harness.service.startRun(CTX, { kind: 'reprocess', detail: { trigger: 'ui' } });

    expect(result.created).toBe(true);
    expect(result.run.id).toBe(RUN_ID);
    expect(result.run.active).toBe(true);

    const [insert] = harness.matching(/INSERT INTO ci\.pipeline_runs/);

    expect(insert).toBeDefined();
    // desired_state starts at 'running': the control channel's default is "go".
    expect(insert.sql).toContain("'running'");
    expect(insert.params[0]).toBe(USER);
    expect(insert.params[1]).toBe('reprocess');
    expect(JSON.parse(insert.params[2] as string)).toEqual({ trigger: 'ui' });
  });

  it('treats a unique violation on pipeline_runs_active_uniq as "a run is already going"', async () => {
    // The whole point: the index makes a concurrent run a DATABASE error so two
    // workers can never race over one user's rows. The service must read that as
    // an answer, not an exception — an operator double-clicking "reprocess"
    // wants to know which run is going, not to see a 500.
    const existing = runRow({ status: 'running', shard_count: 3, shards_by_status: { running: 3 } });

    const harness = makeHarness((statement) => {
      if (/INSERT INTO ci\.pipeline_runs/.test(statement.sql)) {
        throw activeRunConflict();
      }

      return [existing];
    });

    const result = await harness.service.startRun(CTX, { kind: 'reprocess' });

    expect(result.created).toBe(false);
    expect(result.run.id).toBe(RUN_ID);
    expect(result.run.status).toBe('running');
    expect(result.run.shardCount).toBe(3);
    expect(result.run.shardsByStatus).toEqual({ running: 3 });

    // Exactly one insert attempt: the existing run was readable, so there is
    // nothing to retry.
    expect(harness.matching(/INSERT INTO ci\.pipeline_runs/)).toHaveLength(1);
  });

  it('reads the conflict from driverError when TypeORM wraps the driver failure', async () => {
    const harness = makeHarness((statement) => {
      if (/INSERT INTO ci\.pipeline_runs/.test(statement.sql)) {
        throw Object.assign(new Error('QueryFailedError'), {
          driverError: { code: '23505', constraint: 'pipeline_runs_active_uniq' },
        });
      }

      return [runRow()];
    });

    await expect(harness.service.startRun(CTX, { kind: 'import' })).resolves.toMatchObject({
      created: false,
    });
  });

  it('accepts a 23505 whose constraint name did not survive the driver', async () => {
    // Some poolers do not propagate the constraint field. A 23505 on this table
    // can only be the active-run index (the PK defaults to gen_uuid_v7), so an
    // absent name is read as the conflict rather than as an unknown failure.
    const harness = makeHarness((statement) => {
      if (/INSERT INTO ci\.pipeline_runs/.test(statement.sql)) {
        throw activeRunConflict(undefined);
      }

      return [runRow()];
    });

    await expect(harness.service.startRun(CTX, { kind: 'import' })).resolves.toMatchObject({
      created: false,
    });
  });

  it('rethrows a unique violation on some OTHER constraint', async () => {
    // "Some unique constraint broke" reported as "a run is already going" is a
    // lie that would survive every test but this one.
    const harness = makeHarness((statement) => {
      if (/INSERT INTO ci\.pipeline_runs/.test(statement.sql)) {
        throw activeRunConflict('some_other_uniq');
      }

      return [runRow()];
    });

    await expect(harness.service.startRun(CTX, { kind: 'import' })).rejects.toThrow(
      'duplicate key value violates unique constraint',
    );
  });

  it('rethrows a non-unique failure untouched', async () => {
    const harness = makeHarness((statement) => {
      if (/INSERT INTO ci\.pipeline_runs/.test(statement.sql)) {
        throw Object.assign(new Error('deadlock detected'), { code: '40P01' });
      }

      return [];
    });

    await expect(harness.service.startRun(CTX, { kind: 'import' })).rejects.toThrow('deadlock detected');
  });

  it('retries the insert once when the blocking run finishes mid-flight', async () => {
    // The narrow race: our insert loses to a run that is finalized before we can
    // read it back. Retrying once turns that into a successful start rather than
    // a spurious conflict.
    let inserts = 0;

    const harness = makeHarness((statement) => {
      if (/INSERT INTO ci\.pipeline_runs/.test(statement.sql)) {
        inserts += 1;

        if (inserts === 1) {
          throw activeRunConflict();
        }

        return [runRow()];
      }

      // The active-run read finds nothing: the blocker just finished.
      return [];
    });

    const result = await harness.service.startRun(CTX, { kind: 'import' });

    expect(result.created).toBe(true);
    expect(inserts).toBe(2);
  });

  it('gives up with a conflict when the blocking run is never readable', async () => {
    const harness = makeHarness((statement) => {
      if (/INSERT INTO ci\.pipeline_runs/.test(statement.sql)) {
        throw activeRunConflict();
      }

      return [];
    });

    await expect(harness.service.startRun(CTX, { kind: 'import' })).rejects.toBeInstanceOf(ConflictException);

    // Bounded: two attempts, not a spin.
    expect(harness.matching(/INSERT INTO ci\.pipeline_runs/)).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// finishRun — the column that unwedges the user
// ---------------------------------------------------------------------------

describe('PipelineRunService.finishRun', () => {
  it.each([
    ['completed', 'the ordinary ending'],
    ['failed', 'the unhappy ending'],
    ['cancelled', 'the ending most likely to be special-cased'],
  ])('stamps finished_at for status %s (%s)', async (status) => {
    // `finished_at IS NULL` is the ENTIRE predicate of pipeline_runs_active_uniq.
    // A terminal run that keeps a NULL there blocks its user from ever starting
    // another one — no error, no log line, no way out but SQL.
    const harness = makeHarness(() => [runRow({ status, finished_at: new Date('2026-08-09T11:00:00Z') })]);

    const run = await harness.service.finishRun(RUN_ID, status);

    expect(run?.finishedAt).toEqual(new Date('2026-08-09T11:00:00Z'));
    expect(run?.active).toBe(false);

    const [update] = harness.matching(/UPDATE ci\.pipeline_runs/);

    // Unconditional, and not predicated on the status: nothing in this statement
    // can decide NOT to finalize.
    expect(update.sql).toMatch(/finished_at\s*=\s*COALESCE\(finished_at, now\(\)\)/i);
    expect(update.sql).not.toMatch(/WHERE .*finished_at IS NULL/i);
    expect(update.params[1]).toBe(status);
  });

  it('keeps the first finalization timestamp when called twice', async () => {
    // COALESCE, not `now()`: a retried control tick must not extend the run's
    // measured duration, and must not re-open a window where the row looks
    // freshly finished.
    const harness = makeHarness(() => [runRow({ finished_at: new Date('2026-08-09T11:00:00Z') })]);

    await harness.service.finishRun(RUN_ID, 'cancelled');

    expect(harness.matching(/UPDATE ci\.pipeline_runs/)[0].sql).toContain('COALESCE(finished_at, now())');
  });

  it('merges detail rather than replacing it', async () => {
    const harness = makeHarness(() => [runRow({ finished_at: new Date() })]);

    await harness.service.finishRun(RUN_ID, 'completed', { processed: 12 });

    const [update] = harness.matching(/UPDATE ci\.pipeline_runs/);

    expect(update.sql).toContain('detail = detail || $3::jsonb');
    expect(JSON.parse(update.params[2] as string)).toEqual({ processed: 12 });
  });

  it('returns null for a run that does not exist', async () => {
    const harness = makeHarness(() => []);

    await expect(harness.service.finishRun(RUN_ID, 'completed')).resolves.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// setDesiredState — the control channel, and only the control channel
// ---------------------------------------------------------------------------

describe('PipelineRunService.setDesiredState', () => {
  it.each(['paused', 'running', 'cancelled'] as const)('writes desired_state = %s', async (desired) => {
    const harness = makeHarness(() => [runRow({ desired_state: desired })]);

    const run = await harness.service.setDesiredState(CTX, RUN_ID, desired);

    expect(run.desiredState).toBe(desired);

    const [update] = harness.matching(/UPDATE ci\.pipeline_runs/);

    expect(update.params).toEqual([USER, RUN_ID, desired]);
  });

  it('never writes status', async () => {
    // desired_state is what the operator WANTS; status is what the workers
    // REPORT. Writing both from a request would report an observation nobody
    // made — the pause would read as applied the instant the request returned,
    // while a worker was still mid-batch.
    const harness = makeHarness(() => [runRow({ desired_state: 'paused' })]);

    await harness.service.setDesiredState(CTX, RUN_ID, 'paused');

    const [update] = harness.matching(/UPDATE ci\.pipeline_runs/);

    expect(update.sql).not.toMatch(/SET[\s\S]*\bstatus\s*=/i);
    expect(update.sql).not.toMatch(/finished_at\s*=/i);
  });

  it('is user-scoped and refuses a finalized run in the statement itself', async () => {
    const harness = makeHarness(() => [runRow()]);

    await harness.service.setDesiredState(CTX, RUN_ID, 'paused');

    const [update] = harness.matching(/UPDATE ci\.pipeline_runs/);

    expect(update.sql).toContain('user_id = $1::uuid');
    expect(update.sql).toContain('finished_at IS NULL');
    // Cancel is one-way while a run is active.
    expect(update.sql).toContain("(desired_state <> 'cancelled' OR $3 = 'cancelled')");
  });

  it('404s a run that does not exist or belongs to someone else', async () => {
    const harness = makeHarness(() => []);

    await expect(harness.service.setDesiredState(CTX, RUN_ID, 'paused')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('409s a run that has already finished', async () => {
    const finished = runRow({ finished_at: new Date('2026-08-09T11:00:00Z'), status: 'completed' });

    const harness = makeHarness((statement) => (statement.sql.startsWith('UPDATE') ? [] : [finished]));

    await expect(harness.service.setDesiredState(CTX, RUN_ID, 'paused')).rejects.toThrow(/no longer accepts/);
  });

  it('409s an attempt to resume a cancelled run', async () => {
    const cancelled = runRow({ desired_state: 'cancelled' });

    const harness = makeHarness((statement) => (statement.sql.startsWith('UPDATE') ? [] : [cancelled]));

    await expect(harness.service.setDesiredState(CTX, RUN_ID, 'running')).rejects.toThrow(
      /cancelled run cannot be resumed/,
    );
  });

  it('is idempotent for cancel → cancel', async () => {
    // The statement's guard allows cancel over cancel, so a retried request (or
    // a second click) returns the run rather than erroring.
    const harness = makeHarness(() => [runRow({ desired_state: 'cancelled' })]);

    await expect(harness.service.setDesiredState(CTX, RUN_ID, 'cancelled')).resolves.toMatchObject({
      desiredState: 'cancelled',
    });
  });
});

// ---------------------------------------------------------------------------
// Run reads
// ---------------------------------------------------------------------------

describe('PipelineRunService.listRuns', () => {
  it('scopes to the user, orders newest first and clamps the page', async () => {
    const harness = makeHarness(() => [runRow()]);

    await harness.service.listRuns(CTX, { limit: 10_000, offset: 5 });

    const [select] = harness.statements;

    expect(select.sql).toContain('r.user_id = $1::uuid');
    expect(select.sql).toContain('ORDER BY r.started_at DESC, r.id DESC');
    expect(select.params[2]).toBe(200);
    expect(select.params[3]).toBe(5);
  });

  it('passes activeOnly through as the finished_at filter', async () => {
    const harness = makeHarness(() => []);

    await harness.service.listRuns(CTX, { activeOnly: true });

    // `$2` is "include finished runs", so activeOnly inverts it.
    expect(harness.statements[0].params[1]).toBe(false);

    const other = makeHarness(() => []);

    await other.service.listRuns(CTX);

    expect(other.statements[0].params[1]).toBe(true);
  });

  it('reports a run with no shards as zero rather than as absent', async () => {
    // jsonb_object_agg over zero rows is NULL, not {}. The shape must not change
    // just because the runner has not planned the run yet.
    const harness = makeHarness(() => [runRow({ shard_count: 0, shards_by_status: null })]);

    const [run] = await harness.service.listRuns(CTX);

    expect(run.shardCount).toBe(0);
    expect(run.shardsByStatus).toEqual({});
  });

  it('passes an unknown shard status through instead of dropping it', async () => {
    // ci.pipeline_shards.status has no CHECK; its vocabulary belongs to the
    // runner. Fixed buckets here would lose rows, and a progress view that loses
    // rows reads better than reality.
    const harness = makeHarness(() => [
      runRow({ shard_count: 4, shards_by_status: { running: '1', leased: '3' } }),
    ]);

    const [run] = await harness.service.listRuns(CTX);

    expect(run.shardsByStatus).toEqual({ running: 1, leased: 3 });
  });
});

describe('PipelineRunService.getRun', () => {
  const shardRow = (overrides: Record<string, unknown> = {}) => ({
    id: '00000000-0000-7000-8000-0000000000e1',
    stage: 'enrich.geocode',
    shard_key: 'events',
    cursor: '00000000-0000-7000-8000-0000000000f1',
    status: 'running',
    lease_owner: 'worker-1',
    lease_expires_at: new Date('2026-08-09T10:10:00Z'),
    lease_expired: false,
    ...overrides,
  });

  it('returns the run with its shards and their cursors', async () => {
    const harness = makeHarness((statement) =>
      /pipeline_shards s/.test(statement.sql) ? [shardRow()] : [runRow()],
    );

    const detail = await harness.service.getRun(CTX, RUN_ID);

    expect(detail.id).toBe(RUN_ID);
    expect(detail.shardsTruncated).toBe(false);
    expect(detail.shards).toEqual([
      {
        id: '00000000-0000-7000-8000-0000000000e1',
        stage: 'enrich.geocode',
        shardKey: 'events',
        cursor: '00000000-0000-7000-8000-0000000000f1',
        status: 'running',
        leaseOwner: 'worker-1',
        leaseExpiresAt: new Date('2026-08-09T10:10:00Z'),
        leaseExpired: false,
      },
    ]);
  });

  it('computes lease expiry in SQL, against the database clock', async () => {
    const harness = makeHarness((statement) =>
      /pipeline_shards s/.test(statement.sql) ? [shardRow({ lease_expired: true })] : [runRow()],
    );

    const detail = await harness.service.getRun(CTX, RUN_ID);

    expect(detail.shards[0].leaseExpired).toBe(true);
    expect(harness.matching(/pipeline_shards s/)[0].sql).toContain('s.lease_expires_at < now()');
  });

  it('flags truncation instead of silently returning a short list', async () => {
    const many = Array.from({ length: MAX_SHARDS_PER_RUN + 1 }, (_, index) =>
      shardRow({ id: `00000000-0000-7000-8000-${String(index).padStart(12, '0')}` }),
    );

    const harness = makeHarness((statement) => (/pipeline_shards s/.test(statement.sql) ? many : [runRow()]));

    const detail = await harness.service.getRun(CTX, RUN_ID);

    expect(detail.shards).toHaveLength(MAX_SHARDS_PER_RUN);
    expect(detail.shardsTruncated).toBe(true);
    // Asked for one more than the ceiling, which is how a full page is
    // distinguishable from a page that lands exactly on it.
    expect(harness.matching(/pipeline_shards s/)[0].params[1]).toBe(MAX_SHARDS_PER_RUN + 1);
  });

  it("404s another user's run rather than leaking it", async () => {
    const harness = makeHarness(() => []);

    await expect(harness.service.getRun({ userId: OTHER_USER }, RUN_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );

    expect(harness.statements[0].params[0]).toBe(OTHER_USER);
    expect(harness.statements[0].sql).toContain('r.user_id = $1::uuid');
  });
});

// ---------------------------------------------------------------------------
// stageState — "is my import finished?"
// ---------------------------------------------------------------------------

describe('PipelineRunService.stageState', () => {
  it('reports every declared stage, zero-filled, in one round trip', async () => {
    const harness = makeHarness(() => []);

    const stages = await harness.service.stageState(CTX);

    // A stage with no ledger rows must appear at 0. An absent stage reads as
    // "not applicable"; the truth is "never run", which is the opposite answer
    // to the question this endpoint exists for.
    expect(stages.map((stage) => stage.stage)).toEqual([...STAGE_ID_LIST]);
    expect(stages.every((stage) => stage.total === 0 && stage.coverage === 0)).toBe(true);
    expect(harness.statements).toHaveLength(1);
  });

  it('carries the current version per stage into the query, and reports it', async () => {
    const harness = makeHarness(() => []);

    const stages = await harness.service.stageState(CTX);

    const [select] = harness.statements;

    expect(select.params[0]).toBe(USER);
    expect(select.params[1]).toEqual([...STAGE_ID_LIST]);
    expect(select.params[2]).toEqual(STAGE_ID_LIST.map((stage) => stageVersion(stage)));

    for (const stage of stages) {
      expect(stage.stageVersion).toBe(stageVersion(stage.stage));
    }
  });

  it('is user-scoped', async () => {
    // Unlike PipelineStateService.coverage(), which asks the same question
    // appliance-wide and takes no user parameter.
    const harness = makeHarness(() => []);

    await harness.service.stageState(CTX);

    expect(harness.statements[0].sql).toContain('p.user_id = $1::uuid');
  });

  it('buckets each ledger status and derives coverage from done + skipped', async () => {
    const stageId = STAGE_ID_LIST[0];

    const harness = makeHarness(() => [
      { stage: stageId, status: 'done', count: '6', stale: '1' },
      { stage: stageId, status: 'skipped', count: '2', stale: '0' },
      { stage: stageId, status: 'failed', count: '1', stale: '0' },
      { stage: stageId, status: 'quarantined', count: '1', stale: '0' },
    ]);

    const [coverage] = await harness.service.stageState(CTX);

    expect(coverage).toMatchObject({
      stage: stageId,
      total: 10,
      done: 6,
      skipped: 2,
      failed: 1,
      quarantined: 1,
      stale: 1,
      coverage: 0.8,
    });
  });

  it('counts an unrecognised status into total, so coverage can only read LOW', async () => {
    const stageId = STAGE_ID_LIST[0];

    const harness = makeHarness(() => [
      { stage: stageId, status: 'done', count: '1', stale: '0' },
      { stage: stageId, status: 'invented', count: '1', stale: '0' },
    ]);

    const [coverage] = await harness.service.stageState(CTX);

    expect(coverage.total).toBe(2);
    expect(coverage.coverage).toBe(0.5);
    expect(harness.logger.warn).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Dead letters
// ---------------------------------------------------------------------------

describe('PipelineRunService.listDeadLetters', () => {
  const letterRow = (overrides: Record<string, unknown> = {}) => ({
    id: LETTER_ID,
    queue: 'pipeline-enrich',
    event_name: 'pipeline.slice',
    stage: 'enrich.geocode',
    entity_type: 'event',
    entity_id: null,
    user_id: USER,
    payload: { ids: ['a'], userId: USER },
    error: 'boom',
    failed_at: new Date('2026-08-09T09:00:00Z'),
    replayed_at: null,
    ...overrides,
  });

  it('orders newest first and binds the queue and stage filters as parameters', async () => {
    const harness = makeHarness(() => [letterRow()]);

    await harness.service.listDeadLetters(CTX, { queue: 'pipeline-embed', stage: 'index.embed' });

    const [select] = harness.statements;

    expect(select.sql).toContain('ORDER BY d.failed_at DESC, d.id DESC');
    expect(select.params[1]).toBe('pipeline-embed');
    expect(select.params[2]).toBe('index.embed');
  });

  it('includes letters with no attributable user and excludes other users', async () => {
    // NULL user_id means "not attributable" — maintenance sweeps, telemetry, a
    // payload too malformed to read a user out of. Those are frequently the most
    // important rows in the table, and hiding them would make the appliance's
    // own failures invisible on the one screen built to show failures.
    const harness = makeHarness(() => [letterRow({ user_id: null })]);

    const letters = await harness.service.listDeadLetters(CTX);

    expect(letters[0].userId).toBeNull();
    expect(harness.statements[0].sql).toContain('(d.user_id = $1::uuid OR d.user_id IS NULL)');
  });

  it('treats an absent `replayed` filter as "both"', async () => {
    const harness = makeHarness(() => []);

    await harness.service.listDeadLetters(CTX);

    expect(harness.statements[0].params[3]).toBeNull();

    const unreplayed = makeHarness(() => []);

    await unreplayed.service.listDeadLetters(CTX, { replayed: false });

    expect(unreplayed.statements[0].params[3]).toBe(false);
  });

  it('clamps the page, because every row carries a verbatim payload', async () => {
    const harness = makeHarness(() => []);

    await harness.service.listDeadLetters(CTX, { limit: 5000 });

    expect(harness.statements[0].params[4]).toBe(200);
  });

  it('returns the payload untouched', async () => {
    const payload = { ids: ['x'], nested: { deep: [1, 2, 3] } };
    const harness = makeHarness(() => [letterRow({ payload })]);

    const [letter] = await harness.service.listDeadLetters(CTX);

    expect(letter.payload).toEqual(payload);
  });
});

describe('PipelineRunService.replayDeadLetter', () => {
  const claimRow = (overrides: Record<string, unknown> = {}) => ({
    id: LETTER_ID,
    queue: 'pipeline-enrich',
    event_name: 'pipeline.slice',
    payload: { stage: 'enrich.geocode', ids: ['a', 'b'], userId: USER },
    replayed_at: new Date('2026-08-09T12:00:00Z'),
    ...overrides,
  });

  it('re-emits the payload verbatim onto the queue the job died on', async () => {
    // Payload fidelity is the entire reason the reaper stores `j.data`
    // untouched. This is the method that cashes it in.
    const payload = { stage: 'enrich.geocode', ids: ['a', 'b'], userId: USER, weird: { keys: true } };
    const harness = makeHarness(() => [claimRow({ payload })], ['job-9']);

    const result = await harness.service.replayDeadLetter(CTX, LETTER_ID);

    expect(harness.send).toHaveBeenCalledWith('pipeline.slice', payload, {
      queue: 'pipeline-enrich',
      priority: BACKFILL_JOB_PRIORITY,
    });
    expect(result.jobIds).toEqual(['job-9']);
    expect(result.queue).toBe('pipeline-enrich');
  });

  it('routes a reaped letter by listener registration, never back onto the dead-letter queue', async () => {
    // pg-boss's `dead-letter` queue has no worker. Naming it would enqueue the
    // job where nothing will ever pick it up — a replay that reports success and
    // does nothing.
    const harness = makeHarness(() => [claimRow({ queue: DEAD_LETTER_QUEUE })]);

    const result = await harness.service.replayDeadLetter(CTX, LETTER_ID);

    expect(harness.send).toHaveBeenCalledWith('pipeline.slice', expect.any(Object), {
      priority: BACKFILL_JOB_PRIORITY,
    });
    expect(result.queue).toBeNull();
  });

  it('claims replayed_at before emitting, and only while it is still NULL', async () => {
    const harness = makeHarness(() => [claimRow()]);

    await harness.service.replayDeadLetter(CTX, LETTER_ID);

    const [claim] = harness.matching(/UPDATE ci\.pipeline_dead_letters/);

    expect(claim.sql).toContain('SET replayed_at = now()');
    expect(claim.sql).toContain('replayed_at IS NULL');
    expect(claim.params).toEqual([USER, LETTER_ID]);
  });

  it('409s a letter that was already replayed, and emits nothing', async () => {
    // replayed_at is the idempotency flag that keeps "replay all" from looping.
    const harness = makeHarness((statement) =>
      statement.sql.startsWith('UPDATE') ? [] : [{ replayed_at: new Date('2026-08-09T08:00:00Z') }],
    );

    await expect(harness.service.replayDeadLetter(CTX, LETTER_ID)).rejects.toBeInstanceOf(ConflictException);
    expect(harness.send).not.toHaveBeenCalled();
  });

  it('404s a letter that does not exist or belongs to another user', async () => {
    const harness = makeHarness(() => []);

    await expect(harness.service.replayDeadLetter(CTX, LETTER_ID)).rejects.toBeInstanceOf(NotFoundException);
    expect(harness.send).not.toHaveBeenCalled();
  });

  it('refuses a letter with no event name, and releases the claim', async () => {
    // The reaper records 'unknown' for a job whose payload carries no `name` —
    // one inserted by something other than EventService. There is nothing to
    // re-emit it as, and stamping it replayed would quietly retire the row.
    const harness = makeHarness(() => [claimRow({ event_name: 'unknown' })]);

    await expect(harness.service.replayDeadLetter(CTX, LETTER_ID)).rejects.toBeInstanceOf(
      BadRequestException,
    );

    const releases = harness.matching(/SET replayed_at = NULL/);

    expect(releases).toHaveLength(1);
    expect(harness.send).not.toHaveBeenCalled();
  });

  it('releases the claim when the emit throws', async () => {
    // A letter marked replayed that was never re-emitted is worse than one never
    // touched: the payload is often the only surviving copy of the record, and
    // the flag is what removes it from the replay queue.
    const harness = makeHarness(() => [claimRow()]);

    harness.send.mockRejectedValueOnce(new Error('pg-boss is down'));

    await expect(harness.service.replayDeadLetter(CTX, LETTER_ID)).rejects.toThrow('pg-boss is down');

    expect(harness.matching(/SET replayed_at = NULL/)).toHaveLength(1);
  });

  it('treats an empty send() result as a failed replay and releases the claim', async () => {
    // `send()` does not throw for an unknown queue or an event with no
    // listener — it warns and returns []. Swallowing that would leave the letter
    // reading as replayed with nothing enqueued.
    const harness = makeHarness(() => [claimRow()], []);

    await expect(harness.service.replayDeadLetter(CTX, LETTER_ID)).rejects.toBeInstanceOf(ConflictException);

    expect(harness.matching(/SET replayed_at = NULL/)).toHaveLength(1);
  });

  it('does not mask the original error when the release itself fails', async () => {
    const harness = makeHarness((statement) => {
      if (/SET replayed_at = NULL/.test(statement.sql)) {
        throw new Error('release failed');
      }

      return [claimRow()];
    });

    harness.send.mockRejectedValueOnce(new Error('pg-boss is down'));

    await expect(harness.service.replayDeadLetter(CTX, LETTER_ID)).rejects.toThrow('pg-boss is down');
    expect(harness.logger.error).toHaveBeenCalled();
  });
});
