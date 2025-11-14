import { Field, ObjectType, ID } from '@nestjs/graphql';

@ObjectType()
export class MessageType {
  @Field(() => ID)
  id!: string;

  @Field(() => ID)
  threadId!: string | null;

  @Field(() => String)
  content!: string;

  @Field(() => String, { nullable: true })
  role!: string | null;
}
