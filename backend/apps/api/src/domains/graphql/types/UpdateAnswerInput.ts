import { Field, ID, InputType } from '@nestjs/graphql';

@InputType()
export class UpdateAnswerInput {
  @Field(() => ID)
  id!: string;

  @Field()
  answer?: string;
}
