import { Field, ObjectType } from '@nestjs/graphql';

import { MessageEdge } from './MessageEdge';
import { PageInfo } from './PageInfo';

@ObjectType()
export class MessageConnection {
  @Field(() => [MessageEdge])
  edges!: MessageEdge[];

  @Field(() => PageInfo)
  pageInfo!: PageInfo;

  @Field(() => Number)
  totalCount!: number;
}
