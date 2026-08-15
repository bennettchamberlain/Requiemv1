import { Entity, PrimaryColumn, CreateDateColumn, Index } from 'typeorm';

/**
 * "Do `dependsOnId` before `taskId`."
 *
 * Not a ci.relationships row: tasks are not ci.entities, so the entity FKs
 * would dangle (relationships' FKs to entities were dropped in 20260127185821).
 */
@Entity({ schema: 'ci', name: 'task_dependencies' })
@Index('idx_task_dependencies_depends_on', ['dependsOnId'])
export class TaskDependencyEntity {
  @PrimaryColumn({ type: 'uuid', name: 'task_id' })
  taskId!: string;

  @PrimaryColumn({ type: 'uuid', name: 'depends_on_id' })
  dependsOnId!: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  static toEgressType(entity: TaskDependencyEntity): TaskDependency {
    return {
      taskId: entity.taskId,
      dependsOnId: entity.dependsOnId,
      createdAt: entity.createdAt,
    };
  }
}

export type TaskDependency = Readonly<TaskDependencyEntity>;
