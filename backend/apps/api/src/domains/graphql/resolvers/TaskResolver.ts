import { ForbiddenException, UseGuards } from '@nestjs/common';
import { Args, ID, Int, Mutation, Parent, Query, ResolveField, Resolver } from '@nestjs/graphql';

import { Context, type RequestContext, toServiceContext } from '@ci/common/context';
import { FeatureService } from '@ci/common/feature';
import { JwtOrApiKeyAuthGuard } from '@ci/common/guards';
import { TaskService, type TaskStatus } from '@ci/domains/planning';

import { CreateTaskInput } from '../types/CreateTaskInput';
import { CreateTaskPayload } from '../types/CreateTaskPayload';
import { DeleteByIdInput } from '../types/DeleteByIdInput';
import { DeleteByIdPayload } from '../types/DeleteByIdPayload';
import { GlobalUID } from '../types/GlobalUID';
import { PaginationArgs } from '../types/PaginationArgs';
import { ResolveTaskPendingChangePayload } from '../types/ResolveTaskPendingChangePayload';
import { TaskConnection } from '../types/TaskConnection';
import { TaskEdge } from '../types/TaskEdge';
import { TaskPendingChangeType } from '../types/TaskPendingChangeType';
import { TaskStatusEnum, TaskType } from '../types/TaskType';
import { UpdateTaskInput } from '../types/UpdateTaskInput';
import { UpdateTaskPayload } from '../types/UpdateTaskPayload';
import { Paginator } from '../utils/Paginator';

@UseGuards(JwtOrApiKeyAuthGuard)
@Resolver(() => TaskType)
export class TaskResolver {
  constructor(
    private readonly taskService: TaskService,
    private readonly featureService: FeatureService,
  ) {}

  /**
   * `planning.enabled` is the backend gate for ci.tasks. `planning.page` only
   * hides the Plan route; with this off the GraphQL surface must not read or
   * write tasks either.
   */
  private async isPlanningEnabled(): Promise<boolean> {
    return this.featureService.isFeatureEnabled('planning.enabled');
  }

  private async assertPlanningEnabled(): Promise<void> {
    if (!(await this.isPlanningEnabled())) {
      throw new ForbiddenException('The planning surface is disabled');
    }
  }

  @ResolveField(() => [TaskType])
  async children(
    @Context() context: RequestContext,
    @Parent() parent: TaskType,
  ): Promise<TaskType[]> {
    if (!(await this.isPlanningEnabled())) {
      return [];
    }

    const serviceContext = toServiceContext(context);
    const parentId = GlobalUID.parse('task', parent.id);
    const children = await this.taskService.findChildren(serviceContext, parentId);

    return children.map((task) => TaskType.toType(task));
  }

  @Mutation(() => CreateTaskPayload)
  async createTask(
    @Context() context: RequestContext,
    @Args('input') input: CreateTaskInput,
  ): Promise<CreateTaskPayload> {
    await this.assertPlanningEnabled();
    const serviceContext = toServiceContext(context);
    const task = await this.taskService.create(serviceContext, {
      title: input.title,
      description: input.description,
      notes: input.notes,
      status: input.status as TaskStatus | undefined,
      priority: input.priority,
      parentId: input.parentId ? GlobalUID.parse('task', input.parentId) : undefined,
      dueAt: input.dueAt,
      taskTime: input.taskTime,
      scheduledFor: input.scheduledFor,
      deferUntil: input.deferUntil,
      estimatedMinutes: input.estimatedMinutes,
    });

    if (task == null) {
      return { success: false };
    }

    return { success: true, task: TaskType.toType(task) };
  }

  @Mutation(() => UpdateTaskPayload)
  async updateTask(
    @Context() context: RequestContext,
    @Args('input') input: UpdateTaskInput,
  ): Promise<UpdateTaskPayload> {
    await this.assertPlanningEnabled();
    const serviceContext = toServiceContext(context);
    const id = GlobalUID.parse('task', input.id);
    const task = await this.taskService.update(serviceContext, id, {
      title: input.title,
      description: input.description,
      notes: input.notes,
      status: input.status as TaskStatus | undefined,
      priority: input.priority,
      parentId: input.parentId ? GlobalUID.parse('task', input.parentId) : undefined,
      dueAt: input.dueAt,
      taskTime: input.taskTime,
      scheduledFor: input.scheduledFor,
      deferUntil: input.deferUntil,
      estimatedMinutes: input.estimatedMinutes,
      actualMinutes: input.actualMinutes,
    });

    if (task == null) {
      return { success: false };
    }

    return { success: true, task: TaskType.toType(task) };
  }

  @Mutation(() => DeleteByIdPayload)
  async deleteTask(
    @Context() context: RequestContext,
    @Args('input') input: DeleteByIdInput,
  ): Promise<DeleteByIdPayload> {
    await this.assertPlanningEnabled();
    const serviceContext = toServiceContext(context);
    const id = GlobalUID.parse('task', input.id);
    const success = await this.taskService.remove(serviceContext, id);

    if (!success) {
      return { success: false };
    }

    return { success, deletedId: input.id };
  }

  @Mutation(() => TaskType, {
    nullable: true,
    description: 'Mark a task done. Idempotent — the original completion instant is preserved.',
  })
  async completeTask(
    @Context() context: RequestContext,
    @Args('id', { type: () => ID }) gid: string,
    @Args('actualMinutes', { type: () => Int, nullable: true }) actualMinutes?: number,
  ): Promise<TaskType | null> {
    if (!(await this.isPlanningEnabled())) {
      return null;
    }

    const serviceContext = toServiceContext(context);
    const task = await this.taskService.complete(serviceContext, GlobalUID.parse('task', gid), actualMinutes);

    return task ? TaskType.toType(task) : null;
  }

  @Mutation(() => TaskType, { nullable: true, description: 'Move a completed task back to open.' })
  async reopenTask(
    @Context() context: RequestContext,
    @Args('id', { type: () => ID }) gid: string,
  ): Promise<TaskType | null> {
    if (!(await this.isPlanningEnabled())) {
      return null;
    }

    const serviceContext = toServiceContext(context);
    const task = await this.taskService.reopen(serviceContext, GlobalUID.parse('task', gid));

    return task ? TaskType.toType(task) : null;
  }

  @Mutation(() => TaskType, {
    nullable: true,
    description: 'Accept a trust-dial proposed task into the open backlog.',
  })
  async acceptProposedTask(
    @Context() context: RequestContext,
    @Args('id', { type: () => ID }) gid: string,
  ): Promise<TaskType | null> {
    if (!(await this.isPlanningEnabled())) {
      return null;
    }

    const serviceContext = toServiceContext(context);
    const task = await this.taskService.acceptProposed(serviceContext, GlobalUID.parse('task', gid));

    return task ? TaskType.toType(task) : null;
  }

  @Mutation(() => TaskType, {
    nullable: true,
    description: 'Decline a proposed task (archives it).',
  })
  async declineProposedTask(
    @Context() context: RequestContext,
    @Args('id', { type: () => ID }) gid: string,
  ): Promise<TaskType | null> {
    if (!(await this.isPlanningEnabled())) {
      return null;
    }

    const serviceContext = toServiceContext(context);
    const task = await this.taskService.declineProposed(serviceContext, GlobalUID.parse('task', gid));

    return task ? TaskType.toType(task) : null;
  }

  @Mutation(() => ResolveTaskPendingChangePayload, {
    description: 'Apply a pending automation change (mutate / complete / event revise).',
  })
  async acceptTaskPendingChange(
    @Context() context: RequestContext,
    @Args('id', { type: () => ID }) gid: string,
  ): Promise<ResolveTaskPendingChangePayload> {
    await this.assertPlanningEnabled();
    const serviceContext = toServiceContext(context);
    const { task, change } = await this.taskService.acceptPendingChange(
      serviceContext,
      GlobalUID.parse('taskPendingChange', gid),
    );

    return {
      success: change != null,
      task: task ? TaskType.toType(task) : null,
      change: change ? TaskPendingChangeType.toType(change) : null,
    };
  }

  @Mutation(() => ResolveTaskPendingChangePayload, {
    description: 'Dismiss a pending automation change without applying it.',
  })
  async declineTaskPendingChange(
    @Context() context: RequestContext,
    @Args('id', { type: () => ID }) gid: string,
  ): Promise<ResolveTaskPendingChangePayload> {
    await this.assertPlanningEnabled();
    const serviceContext = toServiceContext(context);
    const change = await this.taskService.declinePendingChange(
      serviceContext,
      GlobalUID.parse('taskPendingChange', gid),
    );

    return {
      success: change != null,
      task: null,
      change: change ? TaskPendingChangeType.toType(change) : null,
    };
  }

  @Mutation(() => TaskType, {
    nullable: true,
    description: 'Push a task to a later user-local date (`YYYY-MM-DD`) and count the push.',
  })
  async deferTask(
    @Context() context: RequestContext,
    @Args('id', { type: () => ID }) gid: string,
    @Args('until') until: string,
  ): Promise<TaskType | null> {
    if (!(await this.isPlanningEnabled())) {
      return null;
    }

    const serviceContext = toServiceContext(context);
    const task = await this.taskService.defer(serviceContext, GlobalUID.parse('task', gid), until);

    return task ? TaskType.toType(task) : null;
  }

  @Query(() => TaskConnection)
  async tasks(
    @Context() context: RequestContext,
    @Args() pagination: PaginationArgs,
    @Args('status', { type: () => [TaskStatusEnum], nullable: true }) status?: TaskStatusEnum[],
    @Args('scheduledFor', {
      nullable: true,
      description: 'User-local calendar date, `YYYY-MM-DD`.',
    })
    scheduledFor?: string,
    @Args('parentId', {
      type: () => ID,
      nullable: true,
      description: 'Only direct children of this task. Pass null (omit) for no parent filter.',
    })
    parentId?: string | null,
  ): Promise<TaskConnection> {
    if (!(await this.isPlanningEnabled())) {
      return {
        edges: [],
        pageInfo: { hasNextPage: false, hasPreviousPage: false, startCursor: null, endCursor: null },
        totalCount: 0,
      };
    }

    const serviceContext = toServiceContext(context);
    const entities = await this.taskService.findAll(serviceContext, {
      status: status as TaskStatus[] | undefined,
      scheduledFor,
      parentId: parentId === undefined ? undefined : parentId ? GlobalUID.parse('task', parentId) : null,
    });

    const { slice, pageInfo, totalCount } = Paginator.paginate(entities, {
      ...pagination,
      getId: (entity) => GlobalUID.encode('task', entity.id),
    });

    const edges: TaskEdge[] = slice.map((entity) => {
      const node = TaskType.toType(entity);

      return { node, cursor: node.id };
    });

    return { edges, pageInfo, totalCount };
  }

  @Query(() => [TaskPendingChangeType], {
    description: 'Pending trust-dial confirmations for mutate/complete/revise.',
  })
  async taskPendingChanges(
    @Context() context: RequestContext,
    @Args('taskId', { type: () => ID, nullable: true }) taskId?: string,
  ): Promise<TaskPendingChangeType[]> {
    if (!(await this.isPlanningEnabled())) {
      return [];
    }

    const serviceContext = toServiceContext(context);
    const changes = await this.taskService.findPendingChanges(serviceContext, {
      taskId: taskId ? GlobalUID.parse('task', taskId) : undefined,
    });

    return changes.map((change) => TaskPendingChangeType.toType(change));
  }

  @Query(() => TaskType, { nullable: true })
  async task(
    @Context() context: RequestContext,
    @Args('id', { type: () => ID }) gid: string,
  ): Promise<TaskType | null> {
    if (!(await this.isPlanningEnabled())) {
      return null;
    }

    const serviceContext = toServiceContext(context);
    const task = await this.taskService.findById(serviceContext, GlobalUID.parse('task', gid));

    return task ? TaskType.toType(task) : null;
  }
}
