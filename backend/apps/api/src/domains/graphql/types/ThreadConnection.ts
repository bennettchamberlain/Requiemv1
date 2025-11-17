import { Field, ObjectType } from '@nestjs/graphql';

import { Connection } from './Connection';
import { ThreadEdge } from './ThreadEdge';

@ObjectType()
export class ThreadConnection extends Connection {
  @Field(() => [ThreadEdge])
  edges!: ThreadEdge[];
}
