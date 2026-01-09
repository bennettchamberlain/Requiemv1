import { Field, ObjectType, ID } from '@nestjs/graphql';

import { MutationPayload } from './MutationPayload';

@ObjectType()
export class DeleteNotePayload extends MutationPayload {
  @Field(() => ID, { nullable: true })
  deletedId?: string;
}
