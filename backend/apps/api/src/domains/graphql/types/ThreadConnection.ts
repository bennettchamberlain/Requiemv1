import { Field, ObjectType } from '@nestjs/graphql';

import { PageInfo } from './PageInfo';
import { ThreadEdge } from './ThreadEdge';

@ObjectType()
export class ThreadConnection {
  @Field(() => [ThreadEdge])
  edges!: ThreadEdge[];

  @Field(() => PageInfo)
  pageInfo!: PageInfo;

  @Field(() => Number)
  totalCount!: number;
}
