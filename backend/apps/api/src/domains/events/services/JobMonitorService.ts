import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { RequestContext } from '@ci/common/context';

import { PgBossArchiveEntity } from '../entities/PgBossArchiveEntity';
import { PgBossJobEntity } from '../entities/PgBossJobEntity';
import { PgBossQueueEntity } from '../entities/PgBossQueueEntity';
import { PgBossScheduleEntity } from '../entities/PgBossScheduleEntity';

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
  readonly data: Record<string, unknown> | null;
  readonly output: Record<string, unknown> | null;
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

export interface JobQueueDto {
  readonly name: string;
  readonly policy?: string | null;
  readonly retryLimit: number;
  readonly retryDelay: number;
  readonly retryBackoff: boolean;
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
    readonly pending: number;
    readonly active: number;
    readonly completed: number;
    readonly failed: number;
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
  readonly schedules: readonly JobScheduleDto[];
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

  private async getSummary(): Promise<JobDashboardDto['summary']> {
    const [
      pendingCount,
      activeCount,
      completedJobCount,
      completedArchiveCount,
      failedActiveCount,
      failedArchiveCount,
      scheduledCount,
    ] = await Promise.all([
      this.jobRepository.count({ where: { state: 'created' } }),
      this.jobRepository.count({ where: { state: 'active' } }),
      this.jobRepository.count({ where: { state: 'completed' } }),
      this.archiveRepository.count({ where: { state: 'completed' } }),
      this.jobRepository.count({ where: { state: 'failed' } }),
      this.archiveRepository.count({ where: { state: 'failed' } }),
      this.scheduleRepository.count(),
    ]);

    return {
      pending: pendingCount,
      active: activeCount,
      completed: completedJobCount + completedArchiveCount,
      failed: failedActiveCount + failedArchiveCount,
      scheduled: scheduledCount,
    };
  }

  private async getArchiveDistribution(): Promise<JobDistributionDto[]> {
    const rows = await this.archiveRepository
      .createQueryBuilder('archive')
      .select("COALESCE(archive.data->>'name', archive.name)", 'jobName')
      .addSelect('COUNT(*)::int', 'count')
      .groupBy("COALESCE(archive.data->>'name', archive.name)")
      .orderBy('count', 'DESC')
      .limit(10)
      .getRawMany<{ jobName: string | null; count: number }>();

    return this.mapDistributionRows(rows);
  }

  private async getActiveDistribution(): Promise<JobDistributionDto[]> {
    const rows = await this.jobRepository
      .createQueryBuilder('job')
      .select("COALESCE(job.data->>'name', job.name)", 'jobName')
      .addSelect('COUNT(*)::int', 'count')
      .where('job.state IN (:...states)', { states: ['created', 'active', 'retry'] })
      .groupBy("COALESCE(job.data->>'name', job.name)")
      .orderBy('count', 'DESC')
      .limit(10)
      .getRawMany<{ jobName: string | null; count: number }>();

    return this.mapDistributionRows(rows);
  }

  private async getQueueDistribution(): Promise<JobQueueDistributionDto[]> {
    const rows = await this.jobRepository
      .createQueryBuilder('job')
      .select('job.name', 'queue')
      .addSelect('COUNT(*)::int', 'count')
      .where('job.state IN (:...states)', { states: ['created', 'active', 'retry'] })
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
      data: job.data ?? null,
      output: job.output ?? null,
    };
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
