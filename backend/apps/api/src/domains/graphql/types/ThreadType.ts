import { Field, ID, ObjectType } from '@nestjs/graphql';

import { type Thread } from '@ci/domains/conversations';

import { GlobalUID } from './GlobalUID';
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

  static fromEntity(thread: Thread): ThreadType {
    return {
      id: GlobalUID.toGUID('thread', thread.id),
      name: thread.name,
      model: thread.model,
      description: thread.description,
    };
  }
}
