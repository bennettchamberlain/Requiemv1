import { Field, InputType } from '@nestjs/graphql';

@InputType()
export class RemoveQuestionInput {
  @Field()
  id!: string;
}
