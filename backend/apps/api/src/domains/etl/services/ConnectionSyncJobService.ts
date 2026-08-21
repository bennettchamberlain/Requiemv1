import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';

import { type ServiceContext, SYSTEM_USER, type UserServiceContext } from '@ci/common/context';
import { LoggerService } from '@ci/common/logging';

import { ConnectionSyncJobEntity } from '../entities/ConnectionSyncJobEntity';
import {
  type ConnectionSyncJob,
  type CreateConnectionSyncJobDto,
  type SearchConnectionSyncJobDto,
  type UpdateConnectionSyncJobDto,
} from '../types';

@Injectable()
export class ConnectionSyncJobService {
  constructor(
    @InjectRepository(ConnectionSyncJobEntity)
    private readonly connectionSyncJobRepository: Repository<ConnectionSyncJobEntity>,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(ConnectionSyncJobService.name);
  }

  async create(context: UserServiceContext, data: CreateConnectionSyncJobDto): Promise<ConnectionSyncJob> {
    const id = data.id ?? uuidv7();

    const SyncJob = this.connectionSyncJobRepository.create({
      id,
      userId: data.userId,
      connectionId: data.connectionId,
      jobId: data.jobId ?? null,
      endpointName: data.endpointName,
      status: data.status ?? 'pending',
      type: data.type,
      cursor: data.cursor || {},
      properties: data.properties ?? null,
    });

    const result = await this.connectionSyncJobRepository.save(SyncJob);

    return ConnectionSyncJobEntity.toEgressType(result);
  }

  async findAll(context: UserServiceContext): Promise<ConnectionSyncJob[]> {
    const result = await this.connectionSyncJobRepository.find({
      where: {
        userId: context.userId,
      },
      relations: ['user', 'connection'],
    });

    return result.map((entity) => ConnectionSyncJobEntity.toEgressType(entity));
  }

  async findById(context: ServiceContext, id: string): Promise<ConnectionSyncJob | null> {
    const result = await this.connectionSyncJobRepository.findOne({
      where: {
        id,
        ...(context.userId !== SYSTEM_USER && {
          userId: context.userId,
        }),
      },
      relations: ['user', 'connection'],
    });

    return result ? ConnectionSyncJobEntity.toEgressType(result) : null;
  }

  async findByIds(context: ServiceContext, ids: string[]): Promise<(ConnectionSyncJob | null)[]> {
    const result = await this.connectionSyncJobRepository.find({
      where: {
        id: In(ids),
        ...(context.userId !== SYSTEM_USER && {
          userId: context.userId,
        }),
      },
      relations: ['user', 'connection'],
    });

    const map = new Map(result.map((SyncJob) => [SyncJob.id, ConnectionSyncJobEntity.toEgressType(SyncJob)]));

    return ids.map((id) => map.get(id) ?? null);
  }

  async findByConnectionId(
    context: ServiceContext,
    connectionId: string,
    endpointName?: string,
    type?: string,
  ): Promise<ConnectionSyncJob[]> {
    const result = await this.connectionSyncJobRepository.find({
      where: {
        connectionId,
        ...(endpointName != null && { endpointName }),
        ...(type != null && { type }),
        ...(context.userId !== SYSTEM_USER && {
          userId: context.userId,
        }),
      },
      relations: ['user', 'connection'],
      order: {
        createdAt: 'DESC',
      },
    });

    return result.map((entity) => ConnectionSyncJobEntity.toEgressType(entity));
  }

  async findByJobId(context: ServiceContext, jobId: string): Promise<ConnectionSyncJob[]> {
    const result = await this.connectionSyncJobRepository.find({
      where: {
        jobId,
        ...(context.userId !== SYSTEM_USER && {
          userId: context.userId,
        }),
      },
      relations: ['user', 'connection'],
      order: {
        createdAt: 'DESC',
      },
    });

    return result.map((entity) => ConnectionSyncJobEntity.toEgressType(entity));
  }

  async update(
    context: ServiceContext,
    id: string,
    data: UpdateConnectionSyncJobDto,
  ): Promise<ConnectionSyncJob | null> {
    const updateData: Partial<ConnectionSyncJobEntity> = {};

    if (data.jobId !== undefined) {
      updateData.jobId = data.jobId;
    }

    if (data.endpointName !== undefined) {
      updateData.endpointName = data.endpointName;
    }

    if (data.status !== undefined) {
      updateData.status = data.status;
    }

    if (data.data !== undefined) {
      updateData.data = data.data;
    }

    if (data.type !== undefined) {
      updateData.type = data.type;
    }

    if (data.cursor !== undefined) {
      updateData.cursor = data.cursor;
    }

    if (data.nextCursor !== undefined) {
      updateData.nextCursor = data.nextCursor;
    }

    if (data.properties !== undefined) {
      updateData.properties = data.properties;
    }

    if (data.error !== undefined) {
      updateData.error = data.error;
    }

    if (data.completedAt !== undefined) {
      updateData.completedAt = data.completedAt;
    }

    if (data.lastTransformed !== undefined) {
      updateData.lastTransformed = data.lastTransformed;
    }

    const SyncJob = await this.connectionSyncJobRepository.findOne({
      where: {
        id,
        ...(context.userId !== SYSTEM_USER && {
          userId: context.userId,
        }),
      },
    });

    if (SyncJob) {
      Object.assign(SyncJob, updateData);
      await this.connectionSyncJobRepository.save(SyncJob);
    } else {
      return null;
    }

    return this.findById(context, id);
  }

  async delete(context: ServiceContext, id: string): Promise<boolean> {
    const SyncJob = await this.connectionSyncJobRepository.findOne({
      where: {
        id,
        ...(context.userId !== SYSTEM_USER && {
          userId: context.userId,
        }),
      },
    });

    if (!SyncJob) {
      return false;
    }

    await this.connectionSyncJobRepository.delete({
      id,
      ...(context.userId !== SYSTEM_USER && {
        userId: context.userId,
      }),
    });

    return true;
  }

  /**
   * Atomically transitions one job from `pending` to `in_progress`, returning
   * whether this call won the claim.
   *
   * `handleSyncJobExecuteEvent` used to read `status` and then, in a separate
   * call, write `in_progress` — two concurrently-dequeued redeliveries of the
   * same job (pg-boss's `singletonKey` only refuses a second PENDING send; it
   * says nothing about a job already dequeued once and delivered again) could
   * both read `pending` before either committed `in_progress`, and both run
   * the sync. Folding the read and the write into one statement means only
   * one caller's UPDATE can match the row.
   */
  async claimPending(context: ServiceContext, id: string): Promise<boolean> {
    const scoped = context.userId !== SYSTEM_USER;

    return this.wonClaim(
      `UPDATE ci_etl.connection_sync_jobs
          SET status = 'in_progress', updated_at = now()
        WHERE id = $1::uuid AND status = 'pending'${scoped ? ' AND user_id = $2::uuid' : ''}
        RETURNING id`,
      scoped ? [id, context.userId] : [id],
    );
  }

  /**
   * Atomically claims one job for transformation, returning whether this call
   * won the claim.
   *
   * `lastTransformed` alone only marks completion, so a transform still
   * running past the next `executeTransformJobs` tick was re-enqueued and run
   * again alongside itself — see `SyncOrchestrator.handleSyncJobTransformEvent`.
   * The claim goes stale (and is re-claimable) after an hour, the same window
   * `orchestrateSyncJobs` already uses for a stalled sync job, so a crash
   * mid-transform is retried rather than stuck forever.
   */
  async claimTransform(context: ServiceContext, id: string): Promise<boolean> {
    const scoped = context.userId !== SYSTEM_USER;

    return this.wonClaim(
      `UPDATE ci_etl.connection_sync_jobs
          SET transform_claimed_at = now(), updated_at = now()
        WHERE id = $1::uuid
          AND last_transformed IS NULL
          AND (transform_claimed_at IS NULL OR transform_claimed_at < now() - interval '1 hour')
          ${scoped ? 'AND user_id = $2::uuid' : ''}
        RETURNING id`,
      scoped ? [id, context.userId] : [id],
    );
  }

  /**
   * Runs a `UPDATE ... RETURNING id` claim and reports whether it matched a row.
   *
   * TypeORM's Postgres driver special-cases UPDATE/DELETE and resolves
   * `query()` to the pair `[rows, rowCount]` rather than to the RETURNING rows
   * (`driver/postgres/PostgresQueryRunner.ts`), unlike a SELECT, which resolves
   * to the rows on their own. So a claim that matched nothing arrives as
   * `[[], 0]` — whose own `.length` is 2. Treating that pair AS the rows makes
   * every claim "win" and the whole atomic claim inert; `personalization/
   * placement.ts` shipped the identical bug for the same reason.
   */
  private async wonClaim(sql: string, params: unknown[]): Promise<boolean> {
    const [rows] = (await this.connectionSyncJobRepository.manager.query(sql, params)) as [
      Array<{ id: string }>,
      number,
    ];

    return rows.length > 0;
  }

  async markAsCompleted(
    context: ServiceContext,
    id: string,
    status: 'success' | 'failed',
    error?: Record<string, unknown>,
  ): Promise<ConnectionSyncJob | null> {
    return this.update(context, id, {
      status,
      completedAt: new Date(),
      ...(error && { error }),
    });
  }

  async search(
    context: ServiceContext,
    query: SearchConnectionSyncJobDto,
  ): Promise<ConnectionSyncJobEntity[]> {
    let executable = this.connectionSyncJobRepository.createQueryBuilder('syncJob');

    if (context.userId !== SYSTEM_USER) {
      executable = executable.where('user_id = :userId', { userId: context.userId });
    }

    if (query.connectionId) {
      executable = executable.andWhere('connection_id = :connectionId', { connectionId: query.connectionId });
    }

    if (query.jobId) {
      executable = executable.andWhere('job_id = :jobId', { jobId: query.jobId });
    }

    if (query.endpointName) {
      executable = executable.andWhere('endpoint_name = :endpointName', { endpointName: query.endpointName });
    }

    if (query.status) {
      executable = executable.andWhere('status = :status', { status: query.status });
    }

    if (query.type) {
      executable = executable.andWhere('type = :type', { type: query.type });
    }

    if (query.properties) {
      for (const [key, val] of Object.entries(query.properties)) {
        executable = executable.andWhere(`item.properties->>'${key}' = :${key}`, { [key]: val });
      }
    }

    if (query.lastTransformed === null) {
      executable = executable.andWhere('last_transformed IS NULL');
    }

    if (query.lastTransformed != null) {
      executable = executable.andWhere('last_transformed >= :lastTransformed', {
        lastTransformed: query.lastTransformed,
      });
    }

    if (query.orderBy != null) {
      const [field, direction] = query.orderBy.split(':');
      if (direction !== 'DESC' && direction !== 'ASC') {
        this.logger.warn('Invalid orderBy direction in ConnectionSyncJobService.search', {
          query,
          direction,
        });
      } else {
        executable = executable.orderBy(field, direction);
      }
    }

    return executable.getMany();
  }
}
