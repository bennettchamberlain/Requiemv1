import { Field, ID, ObjectType } from '@nestjs/graphql';

import { Node } from './Node';

@ObjectType({ description: 'thread', implements: () => [Node] })
export class ThreadType implements Node {
  @Field(() => ID)
  id!: string;

  @Field(() => String, { nullable: true })
  name!: string | null;

  @Field(() => String, { nullable: true })
  model!: string | null;

  @Field(() => String, { nullable: true })
  description!: string | null;
}
