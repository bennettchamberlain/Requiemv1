import { Injectable, UnauthorizedException } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { RequestContext } from '@ci/common/context';

import { DEAD_LETTER_QUEUE } from '../constants';
import { PgBossArchiveEntity } from '../entities/PgBossArchiveEntity';
import { PgBossJobEntity } from '../entities/PgBossJobEntity';
import { PgBossQueueEntity } from '../entities/PgBossQueueEntity';
import { PgBossScheduleEntity } from '../entities/PgBossScheduleEntity';

/** Why a job failed, lifted out of `pgboss.job.output`. */
export interface JobFailureDto {
  readonly message: string;
  readonly stack?: string;
  readonly failedAt?: string;
}

/**
 * One job, as the dashboard is allowed to see it.
 *
 * This deliberately does NOT carry `data` or `output` verbatim. A job payload is
 * user content — `graph.person.created` carries name, email, phone and bio;
 * `search.embed.entity` carries the entity's searchable text — and the dashboard
 * endpoint is guarded only by "some user is authenticated", with no owner
 * predicate on the rows it returns. Serialising the payloads therefore handed
 * any signed-in user the most recent 25 jobs of whoever happened to generate
 * them, which is the one invariant the rest of this codebase enforces
 * everywhere.
 *
 * The projection below is what the UI actually reads — the event name, the smart
 * rotation work type, and a failure's message/stack — so nothing on screen is
 * lost. `payloadBytes` keeps the one genuinely useful property of the raw blob
 * (spotting a job carrying a megabyte of data) without disclosing it.
 */
export interface JobRecordDto {
  readonly id: string;
  readonly queue: string;
  readonly state: string;
  readonly priority: number;
  readonly retryLimit: number;
  readonly retryCount: number;
  readonly retryDelay: number;
  readonly retryBackoff: boolean;
  readonly createdOn: string;
  readonly startAfter: string;
  readonly startedOn?: string;
  readonly completedOn?: string;
  readonly deadLetter?: string | null;
  readonly policy?: string | null;
  /** The event name this job dispatches on (`data->>'name'`). */
  readonly event: string | null;
  /** `smart.rotation.work` payloads only — which kind of rotation work this is. */
  readonly workType: string | null;
  /** Size of the withheld payload, so an oversized job is still visible as one. */
  readonly payloadBytes: number;
  readonly failure: JobFailureDto | null;
}

export interface ArchivedJobRecordDto extends JobRecordDto {
  readonly archivedOn: string;
}

export interface JobScheduleDto {
  readonly name: string;
  readonly cron: string;
  readonly timezone?: string | null;
  readonly createdOn: string;
  readonly updatedOn: string;
  readonly data: Record<string, unknown> | null;
  readonly options: Record<string, unknown> | null;
}

/**
 * A recurring job as this codebase actually schedules them.
 *
 * The `schedules` field above reads `pgboss.schedule`, and that table is empty
 * on every appliance ever shipped: nothing calls `boss.schedule()`, because all
 * recurring work is declared with the NestJS `@Cron` decorator instead. So the
 * dashboard's "Schedules — Recurring system jobs" column has never had a row to
 * show, while ~34 real schedules ran invisibly beside it.
 *
 * These come from Nest's own `SchedulerRegistry`, which is the live registry the
 * scheduler fires from — so what the dashboard lists is exactly what is
 * registered in THIS process, including the `role` gating that keeps
 * worker-only crons out of the web process.
 */
export interface CronScheduleDto {
  /** Registration key — `ClassName.methodName` unless the cron was named. */
  readonly name: string;
  /** The cron expression as registered. */
  readonly cron: string;
  readonly timezone?: string | null;
  /** Whether the scheduler currently has this job started. */
  readonly running: boolean;
  /** Next fire time, ISO-8601, or null if the job is stopped. */
  readonly nextRunAt: string | null;
  /** Previous fire time, ISO-8601, or null if it has not run yet this boot. */
  readonly lastRunAt: string | null;
}

export interface JobQueueDto {
  readonly name: string;
  readonly policy?: string | null;
  /**
   * Null when the queue never set its own — pg-boss resolves retries as
   * COALESCE(job, queue, constructor default), so a NULL here means "inherits
   * the client default", not "no retries". Typed nullable because it genuinely
   * is: declaring it `number` made the UI print the string "null".
   */
  readonly retryLimit: number | null;
  readonly retryDelay: number | null;
  readonly retryBackoff: boolean | null;
  readonly expireInSeconds?: number | null;
  readonly retentionMinutes?: number | null;
  readonly deadLetter?: string | null;
  readonly createdOn: string;
  readonly updatedOn?: string;
}

export interface JobDistributionDto {
  readonly jobName: string;
  readonly count: number;
}

export interface JobQueueDistributionDto {
  readonly queue: string;
  readonly count: number;
}

export interface SmartRotationWorkDistributionDto {
  readonly workType: string;
  readonly count: number;
}

export interface JobDashboardDto {
  readonly summary: {
    /** Queued work waiting to run. EXCLUDES dead letters (see `deadLettered`). */
    readonly pending: number;
    readonly active: number;
    /** Failed once and waiting on its retry delay — still live work. */
    readonly retry: number;
    readonly completed: number;
    readonly failed: number;
    readonly cancelled: number;
    /**
     * Jobs that exhausted their retries and were copied to the dead-letter
     * queue. Counted separately because pg-boss inserts them in state
     * `created`, so a naive "pending" count reports them as a live backlog —
     * while the same jobs are ALSO counted under `failed` on their own queue.
     */
    readonly deadLettered: number;
    readonly scheduled: number;
  };
  /** Lifetime completed/failed jobs grouped by handler (from archive). */
  readonly archiveDistribution: readonly JobDistributionDto[];
  /** Currently pending/in-flight jobs grouped by handler. */
  readonly activeDistribution: readonly JobDistributionDto[];
  /** Active jobs grouped by queue name. */
  readonly queueDistribution: readonly JobQueueDistributionDto[];
  /** Smart rotation meta-jobs broken down by workType in payload. */
  readonly smartRotationDistribution: readonly SmartRotationWorkDistributionDto[];
  readonly jobs: readonly JobRecordDto[];
  readonly archive: readonly ArchivedJobRecordDto[];
  /** pg-boss's own schedules. Always empty here — see {@link CronScheduleDto}. */
  readonly schedules: readonly JobScheduleDto[];
  /** The recurring jobs this appliance actually runs, from Nest's scheduler. */
  readonly crons: readonly CronScheduleDto[];
  readonly queues: readonly JobQueueDto[];
}

@Injectable()
export class JobMonitorService {
  private readonly recentLimit = 25;

  constructor(
    @InjectRepository(PgBossJobEntity)
    private readonly jobRepository: Repository<PgBossJobEntity>,
    @InjectRepository(PgBossArchiveEntity)
    private readonly archiveRepository: Repository<PgBossArchiveEntity>,
    @InjectRepository(PgBossScheduleEntity)
    private readonly scheduleRepository: Repository<PgBossScheduleEntity>,
    @InjectRepository(PgBossQueueEntity)
    private readonly queueRepository: Repository<PgBossQueueEntity>,
    private readonly schedulerRegistry: SchedulerRegistry,
  ) {}

  async getDashboard(context: RequestContext): Promise<JobDashboardDto> {
    if (!context.userId) {
      throw new UnauthorizedException('A user context is required.');
    }

    const [
      jobs,
      archive,
      schedules,
      queues,
      summary,
      archiveDistribution,
      activeDistribution,
      queueDistribution,
      smartRotationDistribution,
    ] = await Promise.all([
      this.jobRepository.find({
        order: { createdOn: 'DESC' },
        take: this.recentLimit,
      }),
      this.archiveRepository.find({
        order: { archivedOn: 'DESC' },
        take: this.recentLimit,
      }),
      this.scheduleRepository.find({ order: { name: 'ASC' } }),
      this.queueRepository.find({ order: { name: 'ASC' } }),
      this.getSummary(),
      this.getArchiveDistribution(),
      this.getActiveDistribution(),
      this.getQueueDistribution(),
      this.getSmartRotationDistribution(),
    ]);

    return {
      crons: this.getCronSchedules(),
      summary,
      archiveDistribution,
      activeDistribution,
      queueDistribution,
      smartRotationDistribution,
      jobs: jobs.map((job) => this.toJobRecord(job)),
      archive: archive.map((job) => this.toArchivedJobRecord(job)),
      schedules: schedules.map((schedule) => this.toScheduleDto(schedule)),
      queues: queues.map((queue) => this.toQueueDto(queue)),
    } satisfies JobDashboardDto;
  }

  /**
   * The headline counters.
   *
   * Two grouped scans, not seven `COUNT(*)`s. `pgboss.job` is partitioned by
   * queue name, so every count over it is an Append of a sequential scan across
   * every partition; the previous implementation paid that five times over
   * (created/active/completed/failed) plus two full scans of `pgboss.archive`,
   * on a 15-second poll, per open dashboard tab. `pgboss.archive` is created as
   * `CREATE TABLE archive (LIKE job)` and carries only an index on
   * `archived_on`, so a `WHERE state = …` count there is always a full scan —
   * measured at 16 ms over 88k rows and growing linearly. Grouping collapses
   * each table to a single pass.
   *
   * The dead-letter queue is excluded from `pending` on purpose: pg-boss inserts
   * a dead-lettered job in state `created`, which is indistinguishable by state
   * alone from work that is waiting to run. Counting it as pending reported
   * 1,191 dead jobs as a live backlog on a real appliance — while the SAME jobs
   * were also counted under `failed` on their original queue. They get their own
   * counter instead.
   */
  private async getSummary(): Promise<JobDashboardDto['summary']> {
    const [jobRows, archiveRows] = await Promise.all([
      this.jobRepository
        .createQueryBuilder('job')
        .select('job.state', 'state')
        .addSelect(`COUNT(*) FILTER (WHERE job.name = :deadLetter)::int`, 'deadLettered')
        .addSelect('COUNT(*)::int', 'count')
        .setParameter('deadLetter', DEAD_LETTER_QUEUE)
        .groupBy('job.state')
        .getRawMany<{ state: string; count: number; deadLettered: number }>(),
      this.archiveRepository
        .createQueryBuilder('archive')
        .select('archive.state', 'state')
        .addSelect('COUNT(*)::int', 'count')
        .groupBy('archive.state')
        .getRawMany<{ state: string; count: number }>(),
    ]);

    const job = (state: string) => Number(jobRows.find((row) => row.state === state)?.count ?? 0);
    const archived = (state: string) => Number(archiveRows.find((row) => row.state === state)?.count ?? 0);

    // Dead letters live in state `created`, so subtract them from pending
    // rather than filtering the whole query — one pass still answers both.
    const deadLettered = jobRows.reduce((total, row) => total + Number(row.deadLettered ?? 0), 0);

    return {
      pending: Math.max(job('created') - deadLettered, 0),
      active: job('active'),
      retry: job('retry'),
      completed: job('completed') + archived('completed'),
      failed: job('failed') + archived('failed'),
      cancelled: job('cancelled') + archived('cancelled'),
      deadLettered,
      scheduled: await this.scheduleRepository.count(),
    };
  }

  /**
   * The recurring jobs registered with Nest's scheduler in THIS process.
   *
   * Synchronous and in-memory — the registry is the same map the scheduler
   * fires from, so this costs nothing and cannot be stale. `nextDate()` /
   * `lastDate()` come from the underlying `cron` job; both are defensive here
   * because a stopped job has no next date, and a job that has not fired since
   * boot has no last date.
   */
  private getCronSchedules(): CronScheduleDto[] {
    const schedules: CronScheduleDto[] = [];

    for (const [name, job] of this.schedulerRegistry.getCronJobs()) {
      let nextRunAt: string | null = null;
      let lastRunAt: string | null = null;

      try {
        nextRunAt = job.nextDate()?.toISO() ?? null;
      } catch {
        // A stopped job throws rather than returning nothing. Not an error —
        // the dashboard just shows no next run for it.
      }

      try {
        lastRunAt = job.lastDate()?.toISOString() ?? null;
      } catch {
        // Never fired since boot.
      }

      schedules.push({
        name,
        cron: String(job.cronTime?.source ?? ''),
        timezone: job.cronTime?.timeZone ?? null,
        running: Boolean(job.isActive),
        nextRunAt,
        lastRunAt,
      });
    }

    return schedules.sort((a, b) => a.name.localeCompare(b.name));
  }

  private jobHandlerGroupExpression(entityAlias: 'job' | 'archive'): string {
    const dataRef = `${entityAlias}.data`;
    const nameRef = `${entityAlias}.name`;

    return `CASE WHEN ${dataRef}->>'name' = 'smart.rotation.work' THEN CONCAT('smart.rotation.work · ', COALESCE(${dataRef}->>'workType', 'unknown')) ELSE COALESCE(${dataRef}->>'name', ${nameRef}) END`;
  }

  private async getArchiveDistribution(): Promise<JobDistributionDto[]> {
    const groupExpr = this.jobHandlerGroupExpression('archive');
    const rows = await this.archiveRepository
      .createQueryBuilder('archive')
      .select(groupExpr, 'jobName')
      .addSelect('COUNT(*)::int', 'count')
      .groupBy(groupExpr)
      .orderBy('count', 'DESC')
      .limit(15)
      .getRawMany<{ jobName: string | null; count: number }>();

    return this.mapDistributionRows(rows);
  }

  /**
   * Live work by handler. Excludes the dead-letter queue — its rows are in state
   * `created`, so without the filter the chart of "what the appliance is working
   * on" is topped by jobs that already gave up.
   */
  private async getActiveDistribution(): Promise<JobDistributionDto[]> {
    const groupExpr = this.jobHandlerGroupExpression('job');
    const rows = await this.jobRepository
      .createQueryBuilder('job')
      .select(groupExpr, 'jobName')
      .addSelect('COUNT(*)::int', 'count')
      .where('job.state IN (:...states)', { states: ['created', 'active', 'retry'] })
      .andWhere('job.name != :deadLetter', { deadLetter: DEAD_LETTER_QUEUE })
      .groupBy(groupExpr)
      .orderBy('count', 'DESC')
      .limit(15)
      .getRawMany<{ jobName: string | null; count: number }>();

    return this.mapDistributionRows(rows);
  }

  /** Live work by queue. Excludes the dead-letter queue, for the reason above. */
  private async getQueueDistribution(): Promise<JobQueueDistributionDto[]> {
    const rows = await this.jobRepository
      .createQueryBuilder('job')
      .select('job.name', 'queue')
      .addSelect('COUNT(*)::int', 'count')
      .where('job.state IN (:...states)', { states: ['created', 'active', 'retry'] })
      .andWhere('job.name != :deadLetter', { deadLetter: DEAD_LETTER_QUEUE })
      .groupBy('job.name')
      .orderBy('count', 'DESC')
      .limit(10)
      .getRawMany<{ queue: string | null; count: number }>();

    return rows
      .map((row) => ({
        queue: row.queue ?? 'unknown',
        count: Number(row.count) || 0,
      }))
      .filter((item) => item.count > 0);
  }

  private async getSmartRotationDistribution(): Promise<SmartRotationWorkDistributionDto[]> {
    const rows = await this.jobRepository
      .createQueryBuilder('job')
      .select("COALESCE(job.data->>'workType', 'unknown')", 'workType')
      .addSelect('COUNT(*)::int', 'count')
      .where('job.state IN (:...states)', { states: ['created', 'active', 'retry'] })
      .andWhere("job.data->>'name' = :eventName", { eventName: 'smart.rotation.work' })
      .groupBy("COALESCE(job.data->>'workType', 'unknown')")
      .orderBy('count', 'DESC')
      .getRawMany<{ workType: string | null; count: number }>();

    return rows
      .map((row) => ({
        workType: row.workType ?? 'unknown',
        count: Number(row.count) || 0,
      }))
      .filter((item) => item.count > 0);
  }

  private mapDistributionRows(rows: Array<{ jobName: string | null; count: number }>): JobDistributionDto[] {
    return rows
      .map((row) => ({
        jobName: row.jobName ?? 'unknown',
        count: Number(row.count) || 0,
      }))
      .filter((item) => item.count > 0);
  }

  private toJobRecord(job: PgBossJobEntity | PgBossArchiveEntity): JobRecordDto {
    return {
      id: job.id,
      queue: job.name,
      state: job.state,
      priority: job.priority,
      retryLimit: job.retryLimit,
      retryCount: job.retryCount,
      retryDelay: job.retryDelay,
      retryBackoff: job.retryBackoff,
      createdOn: job.createdOn.toISOString(),
      startAfter: job.startAfter.toISOString(),
      startedOn: job.startedOn ? job.startedOn.toISOString() : undefined,
      completedOn: job.completedOn ? job.completedOn.toISOString() : undefined,
      deadLetter: job.deadLetter,
      policy: job.policy,
      ...this.projectPayload(job.data),
      failure: this.toFailure(job.output),
    };
  }

  /**
   * The non-sensitive shape of a job payload: what it is, not what it contains.
   * See {@link JobRecordDto} for why the payload itself does not leave here.
   */
  private projectPayload(
    data: Record<string, unknown> | null | undefined,
  ): Pick<JobRecordDto, 'event' | 'workType' | 'payloadBytes'> {
    if (!data || typeof data !== 'object') {
      return { event: null, workType: null, payloadBytes: 0 };
    }

    return {
      event: typeof data['name'] === 'string' ? data['name'] : null,
      workType: typeof data['workType'] === 'string' ? data['workType'] : null,
      payloadBytes: this.byteLength(data),
    };
  }

  /**
   * Lift a failure out of `output`.
   *
   * `output` is an untyped jsonb column: the worker writes
   * `{ message, stack, failedAt }` on failure, but deferred completions write
   * deliberate SUCCESS payloads there too, and those can carry user data. Only
   * the three known failure fields are copied out, and only when a message is
   * actually present — so a success payload projects to `null` rather than
   * leaking through this path.
   */
  private toFailure(output: Record<string, unknown> | null | undefined): JobFailureDto | null {
    if (!output || typeof output !== 'object') {
      return null;
    }

    const message = typeof output['message'] === 'string' ? output['message'].trim() : '';

    if (!message) {
      return null;
    }

    return {
      message,
      stack: typeof output['stack'] === 'string' ? output['stack'] : undefined,
      failedAt: typeof output['failedAt'] === 'string' ? output['failedAt'] : undefined,
    };
  }

  private byteLength(data: Record<string, unknown>): number {
    try {
      return Buffer.byteLength(JSON.stringify(data) ?? '', 'utf8');
    } catch {
      // Circular or otherwise unserialisable — the size is not worth throwing a
      // 500 over on a monitoring endpoint.
      return 0;
    }
  }

  private toArchivedJobRecord(job: PgBossArchiveEntity): ArchivedJobRecordDto {
    return {
      ...this.toJobRecord(job),
      archivedOn: job.archivedOn.toISOString(),
    };
  }

  private toScheduleDto(schedule: PgBossScheduleEntity): JobScheduleDto {
    return {
      name: schedule.name,
      cron: schedule.cron,
      timezone: schedule.timezone,
      createdOn: schedule.createdOn.toISOString(),
      updatedOn: schedule.updatedOn.toISOString(),
      data: schedule.data ?? null,
      options: schedule.options ?? null,
    };
  }

  private toQueueDto(queue: PgBossQueueEntity): JobQueueDto {
    return {
      name: queue.name,
      policy: queue.policy,
      retryLimit: queue.retryLimit,
      retryDelay: queue.retryDelay,
      retryBackoff: queue.retryBackoff,
      expireInSeconds: queue.expireInSeconds,
      retentionMinutes: queue.retentionMinutes,
      deadLetter: queue.deadLetter,
      createdOn: queue.createdOn.toISOString(),
      updatedOn: queue.updatedOn ? queue.updatedOn.toISOString() : undefined,
    };
  }
}
