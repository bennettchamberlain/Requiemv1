import { Field, InputType } from '@nestjs/graphql';

@InputType()
export class RemovePersonInput {
  @Field()
  id!: string;
}
