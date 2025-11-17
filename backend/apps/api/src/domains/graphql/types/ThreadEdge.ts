import { Field, ObjectType } from '@nestjs/graphql';

import { ThreadType } from './ThreadType';

@ObjectType()
export class ThreadEdge {
  @Field(() => String)
  cursor!: string;

  @Field(() => ThreadType)
  node!: ThreadType;
}
