import { Field, ID, InputType } from '@nestjs/graphql';

@InputType()
export class UpdateQuestionInput {
  @Field(() => ID)
  id!: string;

  @Field()
  text!: string;

  @Field()
  category!: string;
}
