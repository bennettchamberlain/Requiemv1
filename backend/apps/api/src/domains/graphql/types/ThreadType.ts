import { Field, ID, ObjectType } from '@nestjs/graphql';

import { type Thread } from '@ci/domains/conversations';

import { GlobalUID } from './GlobalUID';
import { Node } from './Node';

@ObjectType({ description: 'thread', implements: () => [Node] })
export class ThreadType implements Node {
  __typename = ThreadType.name;

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
      __typename: ThreadType.name,
      id: GlobalUID.toGUID('thread', thread.id),
      name: thread.name,
      model: thread.model,
      description: thread.description,
    };
  }
}
