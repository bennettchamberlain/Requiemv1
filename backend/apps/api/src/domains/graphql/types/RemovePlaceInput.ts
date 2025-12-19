import { Field, InputType } from '@nestjs/graphql';

@InputType()
export class RemovePlaceInput {
  @Field()
  id!: string;
}
