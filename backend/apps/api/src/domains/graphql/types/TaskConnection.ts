import { Field, Int, ObjectType } from '@nestjs/graphql';

import { Connection } from './Connection';
import { PageInfo } from './PageInfo';
import { TaskEdge } from './TaskEdge';

@ObjectType({ implements: () => [Connection] })
export class TaskConnection implements Connection {
  @Field(() => [TaskEdge])
  edges!: TaskEdge[];

  @Field(() => PageInfo)
  pageInfo!: PageInfo;

  @Field(() => Int)
  totalCount!: number;
}
