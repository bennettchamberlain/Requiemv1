import { Field, ID, ObjectType } from '@nestjs/graphql';
import { Thread } from '../../types';

@ObjectType({ description: 'thread' })
export class ThreadType {
  @Field(() => ID)
  id!: string;

  @Field(() => String, { nullable: true })
  name!: string | null;

  @Field(() => String, { nullable: true })
  model!: string | null;

  @Field(() => String, { nullable: true })
  description!: string | null;

  static fromThread(thread: Thread): ThreadType {
    const result = new this();

    return Object.assign(result, thread);
  }
}
