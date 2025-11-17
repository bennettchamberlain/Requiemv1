import { ArgsType, Field, ID, Int } from '@nestjs/graphql';

@ArgsType()
export class PaginationArgs {
  @Field(() => Int, { nullable: true, description: 'Number of items to return from the beginning' })
  first?: number;

  @Field(() => ID, { nullable: true, description: 'Cursor to start after' })
  after?: string;

  @Field(() => Int, { nullable: true, description: 'Number of items to return from the end' })
  last?: number;

  @Field(() => ID, { nullable: true, description: 'Cursor to start before' })
  before?: string;
}
