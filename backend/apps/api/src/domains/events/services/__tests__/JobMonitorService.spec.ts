import { UnauthorizedException } from '@nestjs/common';
import type { SchedulerRegistry } from '@nestjs/schedule';
import type { Repository } from 'typeorm';

import type { PgBossArchiveEntity } from '../../entities/PgBossArchiveEntity';
import type { PgBossJobEntity } from '../../entities/PgBossJobEntity';
import type { PgBossQueueEntity } from '../../entities/PgBossQueueEntity';
import type { PgBossScheduleEntity } from '../../entities/PgBossScheduleEntity';
import { JobMonitorService } from '../JobMonitorService';

/**
 * The dashboard's read model. Until now it had no tests at all, and the two
 * things that were wrong with it were both invisible from the outside — the
 * numbers looked plausible, they were just counting the wrong rows.
 *
 * The state counts are asserted against grouped rows shaped exactly like the
 * ones a live appliance returns (queue names and magnitudes taken from a real
 * `GROUP BY state` against pgboss), because the bug being pinned is arithmetic
 * over those groups, not SQL.
 */

type RawRow = Record<string, unknown>;

interface StubQueryBuilder {
  /** Every WHERE/andWHERE clause the service asked for, in order. */
  wheres: string[];
  select: jest.Mock;
  addSelect: jest.Mock;
  setParameter: jest.Mock;
  where: jest.Mock;
  andWhere: jest.Mock;
  groupBy: jest.Mock;
  orderBy: jest.Mock;
  limit: jest.Mock;
  getRawMany: jest.Mock;
}

/** A query builder stub that records its WHERE clauses and returns fixed rows. */
function stubQueryBuilder(rows: RawRow[]): StubQueryBuilder {
  const wheres: string[] = [];

  const builder: StubQueryBuilder = {
    wheres,
    select: jest.fn(() => builder),
    addSelect: jest.fn(() => builder),
    setParameter: jest.fn(() => builder),
    where: jest.fn((clause: string) => {
      wheres.push(clause);

      return builder;
    }),
    andWhere: jest.fn((clause: string) => {
      wheres.push(clause);

      return builder;
    }),
    groupBy: jest.fn(() => builder),
    orderBy: jest.fn(() => builder),
    limit: jest.fn(() => builder),
    getRawMany: jest.fn(async () => rows),
  };

  return builder;
}

function stubRepository(options: { rows?: RawRow[]; entities?: unknown[]; count?: number } = {}) {
  const builders: StubQueryBuilder[] = [];

  return {
    builders,
    find: jest.fn(async () => options.entities ?? []),
    count: jest.fn(async () => options.count ?? 0),
    createQueryBuilder: jest.fn(() => {
      const builder = stubQueryBuilder(options.rows ?? []);

      builders.push(builder);

      return builder;
    }),
  };
}

function makeService(options: {
  jobStateRows?: RawRow[];
  archiveStateRows?: RawRow[];
  cronJobs?: Map<string, unknown>;
}) {
  // getSummary asks the job repo for grouped state rows; the distribution
  // queries reuse the same repo, so the stub returns the same rows to all of
  // them. Only the summary's arithmetic is under test here.
  const jobRepository = stubRepository({ rows: options.jobStateRows ?? [] });
  const archiveRepository = stubRepository({ rows: options.archiveStateRows ?? [] });
  const scheduleRepository = stubRepository({ count: 0 });
  const queueRepository = stubRepository();

  const schedulerRegistry = {
    getCronJobs: () => options.cronJobs ?? new Map(),
  } as unknown as SchedulerRegistry;

  const service = new JobMonitorService(
    jobRepository as unknown as Repository<PgBossJobEntity>,
    archiveRepository as unknown as Repository<PgBossArchiveEntity>,
    scheduleRepository as unknown as Repository<PgBossScheduleEntity>,
    queueRepository as unknown as Repository<PgBossQueueEntity>,
    schedulerRegistry,
  );

  return { service, jobRepository, archiveRepository };
}

const context = { userId: 'user-1' };

describe('JobMonitorService.getDashboard', () => {
  it('refuses to report anything without a user context', async () => {
    const { service } = makeService({});

    await expect(service.getDashboard({})).rejects.toBeInstanceOf(UnauthorizedException);
  });

  /**
   * The defect this pins: pg-boss inserts a dead-lettered job into the
   * `dead-letter` queue in state `created` — byte-identical, by state, to work
   * that is waiting to run. Counting `state = 'created'` across every queue
   * therefore reported jobs that had already exhausted their retries as a live
   * backlog, WHILE the same jobs were also counted under `failed` on the queue
   * they came from. Measured on a live appliance: 1,191 of a reported 13,907
   * "pending" jobs were dead, and the "failed" tile showed the same 1,191.
   */
  it('excludes dead letters from pending and counts them separately', async () => {
    const { service } = makeService({
      jobStateRows: [
        { state: 'created', count: 13907, deadLettered: 1191 },
        { state: 'active', count: 12, deadLettered: 0 },
        { state: 'retry', count: 3, deadLettered: 0 },
        { state: 'failed', count: 821, deadLettered: 0 },
        { state: 'completed', count: 26837, deadLettered: 0 },
      ],
      archiveStateRows: [
        { state: 'completed', count: 88298 },
        { state: 'failed', count: 370 },
      ],
    });

    const { summary } = await service.getDashboard(context);

    // 13907 created - 1191 dead-lettered = the work actually waiting to run.
    expect(summary.pending).toBe(12716);
    expect(summary.deadLettered).toBe(1191);
    expect(summary.active).toBe(12);
    expect(summary.retry).toBe(3);
    expect(summary.completed).toBe(26837 + 88298);
    expect(summary.failed).toBe(821 + 370);
  });

  it('reports zero rather than a negative when every created job is dead-lettered', async () => {
    const { service } = makeService({
      jobStateRows: [{ state: 'created', count: 40, deadLettered: 40 }],
    });

    const { summary } = await service.getDashboard(context);

    expect(summary.pending).toBe(0);
    expect(summary.deadLettered).toBe(40);
  });

  it('reports zeroes for states absent from the grouped rows', async () => {
    const { service } = makeService({ jobStateRows: [{ state: 'active', count: 2, deadLettered: 0 }] });

    const { summary } = await service.getDashboard(context);

    expect(summary).toMatchObject({
      pending: 0,
      active: 2,
      retry: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
      deadLettered: 0,
    });
  });

  /**
   * The same exclusion has to hold for the charts, or "what is the appliance
   * working on?" is topped by jobs that already gave up. Asserted on the WHERE
   * clauses because the stub returns rows regardless of the filter.
   */
  it('filters the dead-letter queue out of the live-work distributions', async () => {
    const { service, jobRepository } = makeService({ jobStateRows: [] });

    await service.getDashboard(context);

    const clauses = jobRepository.builders.flatMap((builder) => builder.wheres);
    const deadLetterExclusions = clauses.filter((clause) => clause.includes('!= :deadLetter'));

    // Both the by-handler and the by-queue distribution must exclude it.
    expect(deadLetterExclusions).toHaveLength(2);
  });

  /**
   * `pgboss.schedule` is empty on every appliance — nothing calls
   * `boss.schedule()`. The recurring jobs that DO run are NestJS `@Cron`
   * methods, and until this they were absent from the dashboard entirely.
   */
  it('reports the recurring jobs from the live scheduler registry', async () => {
    const nextRun = { toISO: () => '2026-08-17T01:00:00.000Z' };
    const lastRun = new Date('2026-08-17T00:00:00.000Z');

    const cronJobs = new Map<string, unknown>([
      [
        'PipelineTickCron.tick',
        {
          cronTime: { source: '0 */2 * * * *', timeZone: 'UTC' },
          isActive: true,
          nextDate: () => nextRun,
          lastDate: () => lastRun,
        },
      ],
      [
        'ActivityRollupCron.rollup',
        {
          cronTime: { source: '0 0 * * * *' },
          isActive: false,
          // A stopped job throws rather than returning a next date.
          nextDate: () => {
            throw new Error('job is stopped');
          },
          lastDate: () => null,
        },
      ],
    ]);

    const { service } = makeService({ cronJobs });

    const { crons } = await service.getDashboard(context);

    expect(crons).toEqual([
      {
        name: 'ActivityRollupCron.rollup',
        cron: '0 0 * * * *',
        timezone: null,
        running: false,
        nextRunAt: null,
        lastRunAt: null,
      },
      {
        name: 'PipelineTickCron.tick',
        cron: '0 */2 * * * *',
        timezone: 'UTC',
        running: true,
        nextRunAt: '2026-08-17T01:00:00.000Z',
        lastRunAt: '2026-08-17T00:00:00.000Z',
      },
    ]);
  });
});
