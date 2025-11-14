import { Field, ObjectType } from '@nestjs/graphql';

import { MessageType } from './MessageType';

@ObjectType()
export class MessageEdge {
  @Field(() => String)
  cursor!: string;

  @Field(() => MessageType)
  node!: MessageType;
}
