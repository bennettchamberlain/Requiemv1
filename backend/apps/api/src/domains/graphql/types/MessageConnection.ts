import { Field, ObjectType } from '@nestjs/graphql';

import { Connection } from './Connection';
import { MessageEdge } from './MessageEdge';

@ObjectType()
export class MessageConnection extends Connection {
  @Field(() => [MessageEdge])
  edges!: MessageEdge[];
}
