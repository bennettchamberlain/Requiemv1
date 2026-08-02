import { Field, ObjectType } from '@nestjs/graphql';

import { Edge } from './Edge';
import { TaskType } from './TaskType';

@ObjectType({ implements: () => [Edge] })
export class TaskEdge implements Edge {
  @Field(() => String)
  cursor!: string;

  @Field(() => TaskType)
  node!: TaskType;
}
