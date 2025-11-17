import { Field, Int, ObjectType } from '@nestjs/graphql';

import { PageInfo } from './PageInfo';

@ObjectType({ isAbstract: true })
export abstract class Connection {
  @Field(() => PageInfo)
  pageInfo!: PageInfo;

  @Field(() => Int)
  totalCount!: number;
}
