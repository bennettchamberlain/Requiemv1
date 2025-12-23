import { Field, Int, ObjectType } from '@nestjs/graphql';

import { ContentEdge } from './ContentEdge';
import { Connection } from './Connection';
import { PageInfo } from './PageInfo';

@ObjectType({ implements: () => [Connection] })
export class ContentConnection implements Connection {
  @Field(() => [ContentEdge])
  edges!: ContentEdge[];

  @Field(() => PageInfo)
  pageInfo!: PageInfo;

  @Field(() => Int)
  totalCount!: number;
}
