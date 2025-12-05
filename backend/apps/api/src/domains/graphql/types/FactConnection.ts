import { Field, Int, ObjectType } from '@nestjs/graphql';

import { Connection } from './Connection';
import { FactEdge } from './FactEdge';
import { PageInfo } from './PageInfo';

@ObjectType({ implements: () => [Connection] })
export class FactConnection implements Connection {
  @Field(() => [FactEdge])
  edges!: FactEdge[];

  @Field(() => PageInfo)
  pageInfo!: PageInfo;

  @Field(() => Int)
  totalCount!: number;
}
