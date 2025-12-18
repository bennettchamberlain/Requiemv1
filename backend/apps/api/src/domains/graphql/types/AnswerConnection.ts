import { Field, Int, ObjectType } from '@nestjs/graphql';

import { Connection } from './Connection';
import { AnswerEdge } from './AnswerEdge';
import { PageInfo } from './PageInfo';

@ObjectType({ implements: () => [Connection] })
export class AnswerConnection implements Connection {
  @Field(() => [AnswerEdge])
  edges!: AnswerEdge[];

  @Field(() => PageInfo)
  pageInfo!: PageInfo;

  @Field(() => Int)
  totalCount!: number;
}
