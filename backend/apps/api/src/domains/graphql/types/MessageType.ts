import { Field, ObjectType, ID } from '@nestjs/graphql';

import { Node } from './Node';
@ObjectType({ implements: () => [Node] })
export class MessageType implements Node {
  @Field(() => ID)
  id!: string;

  @Field(() => ID)
  threadId!: string | null;

  @Field(() => String)
  content!: string;

  @Field(() => String, { nullable: true })
  role!: string | null;
}
