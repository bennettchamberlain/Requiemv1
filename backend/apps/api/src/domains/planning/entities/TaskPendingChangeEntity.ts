import { Entity, PrimaryColumn, Column, CreateDateColumn, Index } from 'typeorm';

export const TASK_PENDING_CHANGE_KINDS = ['mutate', 'complete', 'event_revise'] as const;
export type TaskPendingChangeKind = (typeof TASK_PENDING_CHANGE_KINDS)[number];

export const TASK_PENDING_CHANGE_STATUSES = ['pending', 'accepted', 'declined'] as const;
export type TaskPendingChangeStatus = (typeof TASK_PENDING_CHANGE_STATUSES)[number];

/**
 * Trust-dial review queue for mutations automation wants to apply to an
 * existing task (append/revise/reparent/close) or a linked planned event.
 * New work uses `ci.tasks.status = 'proposed'` instead of this table.
 */
@Entity({ schema: 'ci', name: 'task_pending_changes' })
@Index('idx_task_pending_changes_user_pending', ['userId', 'createdAt'], {
  where: `"status" = 'pending'`,
})
export class TaskPendingChangeEntity {
  @PrimaryColumn({ type: 'uuid' })
  id!: string;

  @Column({ type: 'uuid', name: 'user_id' })
  userId!: string;

  @Column({ type: 'uuid', name: 'task_id' })
  taskId!: string;

  @Column({ type: 'text' })
  kind!: TaskPendingChangeKind;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  patch!: Record<string, unknown>;

  @Column({ type: 'text', nullable: true })
  rationale!: string | null;

  @Column({ type: 'real', nullable: true })
  confidence!: number | null;

  @Column({ type: 'text', default: 'pending' })
  status!: TaskPendingChangeStatus;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @Column({ type: 'timestamptz', name: 'resolved_at', nullable: true })
  resolvedAt!: Date | null;

  static toEgressType(entity: TaskPendingChangeEntity): TaskPendingChange {
    return {
      id: entity.id,
      userId: entity.userId,
      taskId: entity.taskId,
      kind: entity.kind,
      patch: entity.patch,
      rationale: entity.rationale,
      confidence: entity.confidence,
      status: entity.status,
      createdAt: entity.createdAt,
      resolvedAt: entity.resolvedAt,
    };
  }
}

export type TaskPendingChange = Readonly<TaskPendingChangeEntity>;
