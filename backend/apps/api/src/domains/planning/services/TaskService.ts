import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';

import { UserServiceContext } from '@ci/common/context';
import { LoggerService } from '@ci/common/logging';
import { EventService } from '@ci/domains/events';

import { type Task, TaskEntity } from '../entities/TaskEntity';
import { TaskCreatedEvent, TaskUpdatedEvent, TaskRemovedEvent } from '../events';
import type { CreateTaskDto, FindTasksOptions, UpdateTaskDto } from '../types';

/**
 * Owner-scoped CRUD for planning tasks.
 *
 * Every method takes `UserServiceContext`, never `ServiceContext`. That is
 * deliberate and is an invariant of the planning domain: `SYSTEM_USER` is not a
 * legitimate planning identity, so the
 * `...(context.userId !== SYSTEM_USER && { userId })` idiom used elsewhere in
 * the codebase must not appear here — it would silently widen a tenant-scoped
 * query to every user's tasks. Cron fan-out enqueuers resolve a real user id
 * before calling in.
 */
@Injectable()
export class TaskService {
  constructor(
    @InjectRepository(TaskEntity)
    private readonly taskRepository: Repository<TaskEntity>,
    private readonly eventService: EventService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(TaskService.name);
  }

  /**
   * `parent_id`'s FK targets `ci.tasks(id)` with no `user_id` component, so the
   * database alone will happily attach a task under another tenant's row.
   * `ON DELETE CASCADE` makes that more than a display glitch: the parent
   * owner deleting their own task would silently delete a subtask they never
   * had access to. Confirm the parent is one of the caller's own tasks first.
   */
  private async assertOwnsParent(context: UserServiceContext, parentId: string): Promise<void> {
    const parent = await this.taskRepository.findOne({
      where: { id: parentId, userId: context.userId },
      select: { id: true },
    });

    if (parent == null) {
      throw new NotFoundException(`Parent task ${parentId} not found`);
    }
  }

  async create(context: UserServiceContext, data: CreateTaskDto): Promise<Task | null> {
    if (data.parentId != null) {
      await this.assertOwnsParent(context, data.parentId);
    }

    const record = this.taskRepository.create({
      ...data,
      id: data.id || uuidv7(),
      userId: context.userId,
    });

    const entity = await this.taskRepository.save(record);

    await this.eventService.send(TaskCreatedEvent, { taskId: entity.id });

    return TaskEntity.toEgressType(entity);
  }

  async createMany(context: UserServiceContext, data: CreateTaskDto[]): Promise<Task[]> {
    const results = await Promise.all(data.map((item) => this.create(context, item)));

    return results.filter((task): task is Task => task != null);
  }

  async findById(context: UserServiceContext, id: string): Promise<Task | null> {
    const entity = await this.taskRepository.findOne({
      where: { id, userId: context.userId },
    });

    return entity ? TaskEntity.toEgressType(entity) : null;
  }

  async findByIds(context: UserServiceContext, ids: string[]): Promise<(Task | null)[]> {
    const results = await this.taskRepository.find({
      where: { id: In(ids), userId: context.userId },
    });

    const map = new Map(results.map((entity) => [entity.id, TaskEntity.toEgressType(entity)]));

    return ids.map((id) => map.get(id) ?? null);
  }

  /**
   * Open work first, then by soonest deadline. Tasks without a due date sort
   * last rather than first — `NULLS LAST` is explicit because Postgres defaults
   * to `NULLS FIRST` for ascending order.
   */
  async findAll(context: UserServiceContext, options: FindTasksOptions = {}): Promise<Task[]> {
    let query = this.taskRepository
      .createQueryBuilder('task')
      .where('task.user_id = :userId', { userId: context.userId });

    if (options.status?.length) {
      query = query.andWhere('task.status IN (:...status)', { status: options.status });
    }

    if (options.scheduledFor) {
      query = query.andWhere('task.scheduled_for = :scheduledFor', {
        scheduledFor: options.scheduledFor,
      });
    }

    if (options.parentId !== undefined) {
      query =
        options.parentId === null
          ? query.andWhere('task.parent_id IS NULL')
          : query.andWhere('task.parent_id = :parentId', { parentId: options.parentId });
    }

    query = query
      .orderBy('task.due_at', 'ASC', 'NULLS LAST')
      .addOrderBy('task.priority', 'ASC')
      .addOrderBy('task.created_at', 'DESC');

    if (options.limit) {
      query = query.limit(options.limit);
    }

    const results = await query.getMany();

    return results.map((entity) => TaskEntity.toEgressType(entity));
  }

  async update(context: UserServiceContext, id: string, data: UpdateTaskDto): Promise<Task | null> {
    const record = await this.taskRepository.findOne({
      where: { id, userId: context.userId },
    });

    if (record == null) {
      return null;
    }

    if (data.parentId != null) {
      await this.assertOwnsParent(context, data.parentId);
    }

    Object.assign(record, data);

    const entity = await this.taskRepository.save(record);

    await this.eventService.send(TaskUpdatedEvent, { taskId: entity.id });

    return TaskEntity.toEgressType(entity);
  }

  /**
   * Marks a task done and stamps `completedAt`. Idempotent: completing an
   * already-done task keeps the original completion instant rather than moving
   * it, so "when did I finish this?" stays answerable.
   */
  async complete(context: UserServiceContext, id: string, actualMinutes?: number): Promise<Task | null> {
    const record = await this.taskRepository.findOne({
      where: { id, userId: context.userId },
    });

    if (record == null) {
      return null;
    }

    record.status = 'done';
    record.completedAt = record.completedAt ?? new Date();

    if (actualMinutes != null) {
      record.actualMinutes = actualMinutes;
    }

    const entity = await this.taskRepository.save(record);

    await this.eventService.send(TaskUpdatedEvent, { taskId: entity.id });

    return TaskEntity.toEgressType(entity);
  }

  async reopen(context: UserServiceContext, id: string): Promise<Task | null> {
    const record = await this.taskRepository.findOne({
      where: { id, userId: context.userId },
    });

    if (record == null) {
      return null;
    }

    record.status = 'open';
    record.completedAt = null;

    const entity = await this.taskRepository.save(record);

    await this.eventService.send(TaskUpdatedEvent, { taskId: entity.id });

    return TaskEntity.toEgressType(entity);
  }

  /**
   * Pushes a task out to a later local date and counts the push. `deferCount`
   * is what later milestones use to notice a task nobody intends to do.
   */
  async defer(context: UserServiceContext, id: string, until: string): Promise<Task | null> {
    const record = await this.taskRepository.findOne({
      where: { id, userId: context.userId },
    });

    if (record == null) {
      return null;
    }

    record.deferUntil = until;
    record.deferCount += 1;

    const entity = await this.taskRepository.save(record);

    await this.eventService.send(TaskUpdatedEvent, { taskId: entity.id });

    return TaskEntity.toEgressType(entity);
  }

  async remove(context: UserServiceContext, id: string): Promise<boolean> {
    const result = await this.taskRepository.delete({ id, userId: context.userId });

    if (result.affected != null && result.affected > 0) {
      await this.eventService.send(TaskRemovedEvent, { taskId: id });

      return true;
    }

    return false;
  }
}
