import { Field, ID, ObjectType } from '@nestjs/graphql';
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
}
