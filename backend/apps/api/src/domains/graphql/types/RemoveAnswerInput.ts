import { Field, InputType } from '@nestjs/graphql';

@InputType()
export class RemoveAnswerInput {
  @Field()
  id!: string;
}
