import { Field, ObjectType } from '@nestjs/graphql';

import { TaskPendingChangeType } from './TaskPendingChangeType';
import { TaskType } from './TaskType';

@ObjectType()
export class ResolveTaskPendingChangePayload {
  @Field(() => Boolean)
  success!: boolean;

  @Field(() => TaskType, { nullable: true })
  task!: TaskType | null;

  @Field(() => TaskPendingChangeType, { nullable: true })
  change!: TaskPendingChangeType | null;
}
