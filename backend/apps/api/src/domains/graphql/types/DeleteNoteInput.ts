import { Field, InputType } from '@nestjs/graphql';

@InputType()
export class DeleteNoteInput {
  @Field()
  id!: string;
}
